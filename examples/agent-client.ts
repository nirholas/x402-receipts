/**
 * The full x402 flow, then both paid routes, on real on-chain data.
 *
 *   PRIVATE_KEY=0x… npx tsx examples/agent-client.ts
 *
 * Without PRIVATE_KEY the script stops at the 402 and prints the challenge —
 * still the interesting half, since it shows both rails on offer.
 */
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4033";

// Two real mainnet transactions, one per chain. Swap in your own — or better,
// the `transaction` from an X-PAYMENT-RESPONSE you received earlier.
const BASE_TX =
  process.env.BASE_TX ?? "0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2";
const SOLANA_TX =
  process.env.SOLANA_TX ??
  "qMvBwBSdfWTAPyDZi1BDk3Nu68HEVAsz9aMexw3XT7rLobYmpLSg1BBW9Bgvpt1e7A8NUjcuSjAZ5aoYF8cARjj";

// ── 1. Free: what's already in the book? ────────────────────────────────────
const summary = await fetch(`${BASE_URL}/summary`).then((r) => r.json());
console.log("Ledger summary (free):", JSON.stringify(summary.summary));

// ── 2. Unpaid request: see what the service accepts ─────────────────────────
const challenge = await fetch(`${BASE_URL}/receipt/${BASE_TX}?network=base`);
if (challenge.status !== 402) {
  console.error(`Expected 402, got ${challenge.status}. Is the server running?`);
  process.exit(1);
}

const { accepts } = (await challenge.json()) as {
  accepts: { network: string; maxAmountRequired: string; payTo: string }[];
};

console.log("\n402 Payment Required — this service accepts:");
for (const accept of accepts) {
  console.log(
    `  ${accept.network.padEnd(14)} $${(Number(accept.maxAmountRequired) / 1e6).toFixed(4)} USDC → ${accept.payTo}`,
  );
}

if (!process.env.PRIVATE_KEY) {
  console.log("\nSet PRIVATE_KEY (a funded base-sepolia wallet) to pay and resolve real receipts.");
  process.exit(0);
}

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const pay = wrapFetchWithPayment(fetch, account);

// ── 3. Resolve a Base transaction ───────────────────────────────────────────
// Note what's happening: we pay on base-sepolia to look up a transaction on
// base mainnet. The rail you pay on and the chain you query are independent.
const evmRes = await pay(
  `${BASE_URL}/receipt/${BASE_TX}?network=base&resource=${encodeURIComponent("https://api.example.com/report")}&category=data`,
);
const evmBody = (await evmRes.json()) as { receipt: { payload: Record<string, unknown> } };

console.log(`\n${evmRes.status} — Base receipt`);
const receiptHeader = evmRes.headers.get("x-payment-response");
if (receiptHeader) console.log("X-PAYMENT-RESPONSE:", decodeXPaymentResponse(receiptHeader));
console.log(
  JSON.stringify(
    pick(evmBody.receipt.payload, ["transaction", "rail", "network", "status", "payer", "payee", "amount", "symbol", "timestamp"]),
    null,
    2,
  ),
);

// ── 4. Resolve a Solana transaction ─────────────────────────────────────────
// Same endpoint, same response shape. The identifier's base58 form is enough
// to route the lookup to Solana — no flag needed.
const svmRes = await pay(
  `${BASE_URL}/receipt/${SOLANA_TX}?resource=${encodeURIComponent("https://api.example.com/report")}&category=data`,
);
const svmBody = (await svmRes.json()) as { receipt: { payload: Record<string, unknown> } };

console.log(`\n${svmRes.status} — Solana receipt`);
console.log(
  JSON.stringify(
    pick(svmBody.receipt.payload, ["transaction", "rail", "network", "status", "payer", "payee", "amount", "symbol", "timestamp"]),
    null,
    2,
  ),
);

// ── 5. Buy the book ─────────────────────────────────────────────────────────
const exportRes = await pay(`${BASE_URL}/export`);
const exported = (await exportRes.json()) as {
  export: { payload: { summary: Record<string, unknown> }; signature: string };
  csv: string;
};

console.log(`\n${exportRes.status} — ledger export`);
console.log("Summary:", JSON.stringify(exported.export.payload.summary, null, 2));
console.log("\nCSV (first two lines):");
console.log(exported.csv.split("\r\n").slice(0, 2).join("\n"));

// The export is signed, so it can be handed to finance without them trusting
// the agent that produced it.
const valid = await fetch(`${BASE_URL}/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(exported.export),
}).then((r) => r.json());
console.log("\nExport signature valid:", valid.valid);

function pick<T extends Record<string, unknown>>(object: T, keys: string[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => k in object).map((k) => [k, object[k]])) as Partial<T>;
}

// ── Paying on Solana instead ────────────────────────────────────────────────
//
// The same 402 also offers `network: "solana"`. A Solana client picks that
// entry, builds an SPL USDC transferChecked to `payTo` (the facilitator's
// `extra.feePayer` sponsors the SOL fee, so no SOL is needed), signs it, and
// sends the base64 x402 payload in `X-PAYMENT`:
//
//   import { prepareSolanaCheckout, encodeX402Payment }
//     from "@three-ws/x402-payment-modal/server";
//
//   const accept = accepts.find(a => a.network.startsWith("solana"))!;
//   const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: wallet.publicKey.toBase58() });
//   const signedTx = await wallet.signTransaction(tx_base64);
//   const { x_payment } = encodeX402Payment({ accept, signedTxBase64: signedTx, resourceUrl });
//   await fetch(resourceUrl, { headers: { "X-PAYMENT": x_payment } });
//
// Or, with x402-fetch, pass a multi-network signer and let it choose:
//
//   import { createSigner } from "x402-fetch";
//   const pay = wrapFetchWithPayment(fetch, {
//     evm: await createSigner("base-sepolia", process.env.EVM_KEY!),
//     svm: await createSigner("solana", process.env.SOLANA_KEY!),
//   });
