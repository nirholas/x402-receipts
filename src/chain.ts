/**
 * On-chain resolution for both x402 rails.
 *
 * An x402 settlement receipt gives you a bare identifier — a Base transaction
 * hash or a Solana transaction signature — and nothing else. This module turns
 * that identifier into an accounting record: who paid, who was paid, how much
 * USDC, in which token, at what time, and whether it actually succeeded.
 *
 * Both rails are read through **public, keyless RPC endpoints**, so this works
 * out of the box:
 *   - Base / Base Sepolia via viem (`https://mainnet.base.org`, `https://sepolia.base.org`)
 *   - Solana mainnet / devnet via `@solana/web3.js`
 *
 * Point `BASE_RPC_URL` / `SOLANA_RPC_URL` at a dedicated provider before you
 * depend on this for anything: the public endpoints are rate-limited.
 */

/** Known stablecoin contracts/mints, so amounts can be reported in human units. */
export const KNOWN_ASSETS: Record<string, { symbol: string; decimals: number; network: string }> = {
  // Base mainnet
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6, network: "base" },
  // Base Sepolia
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e": { symbol: "USDC", decimals: 6, network: "base-sepolia" },
  // Solana mainnet
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6, network: "solana" },
  // Solana devnet
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": { symbol: "USDC", decimals: 6, network: "solana-devnet" },
};

/** `Transfer(address,address,uint256)` — the ERC-20 event every USDC payment emits. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type Rail = "evm" | "solana";

/** One token movement inside a transaction. */
export interface TokenTransfer {
  from: string;
  to: string;
  /** Human amount, e.g. `0.01`. */
  amount: number;
  /** Raw integer amount as a string, in the token's smallest unit. */
  amountRaw: string;
  asset: string;
  symbol: string;
  decimals: number;
}

/** What a resolved transaction looks like, identically on both rails. */
export interface ChainReceipt {
  rail: Rail;
  network: string;
  /** Base transaction hash, or Solana transaction signature. */
  transaction: string;
  status: "success" | "failed";
  /** Block number (EVM) or slot (Solana). */
  block: number | null;
  /** ISO-8601 block time. Null when the chain doesn't report one. */
  timestamp: string | null;
  /** The account that submitted (and, on EVM, paid gas for) the transaction. */
  submitter: string | null;
  /** Every token movement the transaction produced. */
  transfers: TokenTransfer[];
  /** Network fee in the chain's native unit (ETH / SOL). */
  feeNative: number | null;
  explorerUrl: string;
}

export class TransactionNotFoundError extends Error {
  constructor(
    public readonly transaction: string,
    public readonly network: string,
  ) {
    super(
      `Transaction ${transaction} not found on ${network}. ` +
        `It may be unconfirmed, on a different network, or outside the RPC's history window.`,
    );
    this.name = "TransactionNotFoundError";
  }
}

export class UnrecognizedIdentifierError extends Error {
  constructor(public readonly identifier: string) {
    super(
      `Cannot tell which chain "${identifier}" belongs to. ` +
        `Expected a 0x-prefixed 32-byte hash (Base) or a base58 signature (Solana). ` +
        `Pass ?network= to disambiguate.`,
    );
    this.name = "UnrecognizedIdentifierError";
  }
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Work out which rail an identifier belongs to from its shape alone.
 * Base transaction hashes are 0x + 64 hex; Solana signatures are 64 raw bytes
 * rendered in base58, which lands in the 86–88 character range.
 */
export function detectRail(identifier: string): Rail {
  const id = identifier.trim();
  if (EVM_HASH.test(id)) return "evm";
  if (BASE58.test(id)) return "solana";
  throw new UnrecognizedIdentifierError(identifier);
}

export interface ResolveOptions {
  /** Force a network instead of using the configured default for the rail. */
  network?: string;
  baseRpcUrl?: string;
  solanaRpcUrl?: string;
}

/** Resolve a transaction on whichever rail its identifier belongs to. */
export async function resolveTransaction(identifier: string, options: ResolveOptions = {}): Promise<ChainReceipt> {
  const rail = options.network?.startsWith("solana")
    ? "solana"
    : options.network
      ? "evm"
      : detectRail(identifier);
  return rail === "solana" ? resolveSolana(identifier, options) : resolveEvm(identifier, options);
}

// ── EVM ─────────────────────────────────────────────────────────────────────

function evmNetwork(options: ResolveOptions): "base" | "base-sepolia" {
  if (options.network === "base" || options.network === "base-sepolia") return options.network;
  return process.env.NETWORK === "base" ? "base" : "base-sepolia";
}

async function resolveEvm(hash: string, options: ResolveOptions): Promise<ChainReceipt> {
  const { createPublicClient, http, formatUnits, formatEther } = await import("viem");
  const chains = await import("viem/chains");

  const network = evmNetwork(options);
  const chain = network === "base" ? chains.base : chains.baseSepolia;
  const rpcUrl = options.baseRpcUrl ?? process.env.BASE_RPC_URL;
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null);
  if (!receipt) throw new TransactionNotFoundError(hash, network);

  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);

  // Decode every ERC-20 Transfer log. `topics[1]`/`topics[2]` are the indexed
  // from/to addresses, left-padded to 32 bytes; `data` is the uint256 amount.
  const transfers: TokenTransfer[] = [];
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    const asset = log.address.toLowerCase();
    const known = KNOWN_ASSETS[asset];
    const decimals = known?.decimals ?? 18;
    const raw = BigInt(log.data === "0x" ? "0x0" : log.data);
    transfers.push({
      from: `0x${log.topics[1]!.slice(26)}`,
      to: `0x${log.topics[2]!.slice(26)}`,
      amount: Number(formatUnits(raw, decimals)),
      amountRaw: raw.toString(),
      asset: log.address,
      symbol: known?.symbol ?? "UNKNOWN",
      decimals,
    });
  }

  return {
    rail: "evm",
    network,
    transaction: hash,
    status: receipt.status === "success" ? "success" : "failed",
    block: Number(receipt.blockNumber),
    timestamp: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null,
    submitter: receipt.from,
    transfers,
    feeNative: Number(formatEther(receipt.gasUsed * receipt.effectiveGasPrice)),
    explorerUrl:
      network === "base" ? `https://basescan.org/tx/${hash}` : `https://sepolia.basescan.org/tx/${hash}`,
  };
}

// ── Solana ──────────────────────────────────────────────────────────────────

function solanaNetwork(options: ResolveOptions): "solana" | "solana-devnet" {
  if (options.network === "solana" || options.network === "solana-devnet") return options.network;
  return process.env.SOLANA_NETWORK === "devnet" ? "solana-devnet" : "solana";
}

interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number; uiAmount: number | null };
}

async function resolveSolana(signature: string, options: ResolveOptions): Promise<ChainReceipt> {
  const { Connection } = await import("@solana/web3.js");

  const network = solanaNetwork(options);
  const rpcUrl =
    options.solanaRpcUrl ??
    process.env.SOLANA_RPC_URL ??
    (network === "solana-devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");

  const connection = new Connection(rpcUrl, "confirmed");
  const tx = await connection
    .getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    .catch(() => null);
  if (!tx) throw new TransactionNotFoundError(signature, network);

  const meta = tx.meta;
  const pre = (meta?.preTokenBalances ?? []) as unknown as ParsedTokenBalance[];
  const post = (meta?.postTokenBalances ?? []) as unknown as ParsedTokenBalance[];

  // Solana has no Transfer event. The reliable way to read what moved is to
  // diff the pre/post token balances per (account, mint): negative deltas are
  // senders, positive ones are receivers. This survives transferChecked,
  // transfer, CPI wrappers and multi-hop routes alike.
  const deltas = new Map<string, { mint: string; owner: string; decimals: number; delta: bigint }>();
  const note = (balances: ParsedTokenBalance[], sign: 1n | -1n) => {
    for (const balance of balances) {
      const owner = balance.owner ?? `account#${balance.accountIndex}`;
      const key = `${owner}:${balance.mint}`;
      const current = deltas.get(key) ?? {
        mint: balance.mint,
        owner,
        decimals: balance.uiTokenAmount.decimals,
        delta: 0n,
      };
      current.delta += sign * BigInt(balance.uiTokenAmount.amount || "0");
      deltas.set(key, current);
    }
  };
  note(post, 1n);
  note(pre, -1n);

  const senders = [...deltas.values()].filter((d) => d.delta < 0n);
  const receivers = [...deltas.values()].filter((d) => d.delta > 0n);

  const transfers: TokenTransfer[] = [];
  for (const receiver of receivers) {
    const sender = senders.find((s) => s.mint === receiver.mint);
    const known = KNOWN_ASSETS[receiver.mint];
    const raw = receiver.delta;
    transfers.push({
      from: sender?.owner ?? "unknown",
      to: receiver.owner,
      amount: Number(raw) / 10 ** receiver.decimals,
      amountRaw: raw.toString(),
      asset: receiver.mint,
      symbol: known?.symbol ?? "UNKNOWN",
      decimals: receiver.decimals,
    });
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const cluster = network === "solana-devnet" ? "?cluster=devnet" : "";

  return {
    rail: "solana",
    network,
    transaction: signature,
    status: meta?.err ? "failed" : "success",
    block: tx.slot ?? null,
    timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    // The fee payer is always the first account key — on x402 Solana payments
    // that is the facilitator's sponsor, not the buyer. The buyer shows up as
    // the sender in `transfers`.
    submitter: accountKeys[0]?.pubkey?.toBase58() ?? null,
    transfers,
    feeNative: meta?.fee != null ? meta.fee / 1e9 : null,
    explorerUrl: `https://solscan.io/tx/${signature}${cluster}`,
  };
}
