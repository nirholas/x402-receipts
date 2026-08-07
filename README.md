# x402-receipts

**Receipts and accounting for agent spending.** Turn a bare settlement id — a Base transaction hash *or* a Solana transaction signature — into a signed receipt an accountant will accept, and export the whole book as CSV.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![x402](https://img.shields.io/badge/x402-payments-0052ff.svg)](https://x402.org)
[![rails: Base + Solana](https://img.shields.io/badge/rails-Base%20%2B%20Solana-14f195.svg)](#two-chains-one-lookup)

```bash
npm install x402-receipts
```

## The problem

An x402 payment succeeds and your agent gets this back:

```
X-PAYMENT-RESPONSE: { "success": true, "network": "base-sepolia", "transaction": "0x33b7dd08…" }
```

That is not a receipt. It has no amount, no counterparty, no timestamp, and no idea what was bought. At month end you have a few thousand of them across two chains and a finance function that would like a CSV.

This service resolves each identifier against the chain, extracts the token movements, lets you attach what only the agent knows (which resource, which run, which category), and hands the whole ledger back in both formats.

## Why x402 for this

Bookkeeping is where per-request payment gets uncomfortable: a subscription is one line on a statement, ten thousand micropayments is a reconciliation problem. Charging $0.001 per lookup and $0.01 per export keeps the tool's own economics honest — you pay for the calls you make, and the receipts for *those* calls land in the same ledger.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-receipts && cd x402-receipts
npm install
cp .env.example .env      # already filled in with working defaults
npm run dev
```

```bash
curl -s localhost:4033/summary | jq                          # free: what's in the book
curl -s "localhost:4033/receipt/0x33b7dd08…" | jq .accepts   # 402, both rails
npm run client                                               # pay, resolve, export
```

## API

| Route | Price | What you get back |
|---|---|---|
| `GET /receipt/:tx` | **$0.001** | Enriched, HMAC-signed receipt: payer, payee, amount, asset, block time, network fee, every token transfer, your metadata |
| `GET /export` | **$0.01** | The full ledger as **CSV and JSON in one response**, with per-rail and per-merchant totals plus a tamper digest |
| `POST /annotate/:tx` | free* | Attach `resource` / `merchant` / `label` / `category` to a resolved receipt |
| `GET /summary` | free | Totals without the rows — decide whether the export is worth buying |
| `POST /verify` | free | Signature check on any receipt or export |
| `GET /health` | free | Liveness, rails, resolvers, ledger size |

<sub>*requires `X-Admin-Key`.</sub>

The export returns both formats deliberately. CSV is what accounting software imports; JSON is what the next agent parses. Making you pay twice for the same rows would be a worse product.

## Two chains, one lookup

**The identifier's shape picks the chain.** No flag, no guessing:

```bash
# Base: 0x + 64 hex
curl "localhost:4033/receipt/0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2"

# Solana: base58 signature
curl "localhost:4033/receipt/qMvBwBSdfWTAPyDZi1BDk3Nu68HEVAsz9aMexw3XT7rLobYmpLSg1BBW9Bgvpt1e7A8NUjcuSjAZ5aoYF8cARjj"
```

Both come back in the same shape. Getting there takes genuinely different work:

- **Base** — read the transaction receipt and decode every `Transfer(address,address,uint256)` log. The event tells you sender, recipient and amount directly.
- **Solana** — there is no transfer event. The reliable method is to diff `preTokenBalances` against `postTokenBalances` per (owner, mint): negative deltas are senders, positive ones are receivers. This survives `transfer`, `transferChecked`, CPI wrappers and multi-hop routes alike, where instruction parsing does not.

One Solana subtlety worth knowing: on x402 payments the **fee payer is the facilitator's sponsor**, not the buyer — that's what lets a buyer pay with USDC and no SOL. Read `payer` from the transfer, never the fee payer.

Both rails read through **public, keyless RPC** by default. Set `BASE_RPC_URL` / `SOLANA_RPC_URL` to a dedicated provider before you depend on it — the public endpoints are rate-limited.

## Use it as a library

```ts
import { resolveTransaction, ReceiptLedger, toCsv } from "x402-receipts";

const ledger = new ReceiptLedger({ file: "data/receipts.json" });

const receipt = await resolveTransaction("0x33b7dd08…");     // Base
const solana  = await resolveTransaction("qMvBwBSd…");       // Solana

ledger.record(receipt, { resource: "https://api.example.com/report", category: "data" });
ledger.record(solana,  { resource: "https://api.example.com/report", category: "data" });

ledger.summary();
// { count: 2, totalUsd: 0.02, byRail: { evm: {…}, solana: {…} }, byMerchant: { "api.example.com": {…} } }

toCsv(ledger.list({ since: "2026-08-01" }));
```

| export | what it is |
|---|---|
| `resolveTransaction(id, opts?)` | Resolve on either rail. Throws `UnrecognizedIdentifierError` / `TransactionNotFoundError`. |
| `detectRail(id)` | `"evm"` or `"solana"`, from the identifier's shape. |
| `ReceiptLedger` | `record`, `annotate`, `get`, `list(filter)`, `summary(filter)`, `digest(filter)`. Atomic JSON persistence. |
| `toCsv(records)` / `CSV_COLUMNS` | RFC 4180 CSV with a stable column order. |
| `KNOWN_ASSETS` | USDC contracts and mints across all four networks. |
| `paywall(routePrices, { service })` | The dual-rail x402 middleware, reusable in your own server. |
| `sign` / `verify` / `signed` | HMAC-SHA256 over canonical JSON. |

## How x402 works here

```
  agent                    x402-receipts                  chain RPC / facilitator
    │  GET /receipt/0x33b7…      │                              │
    │ ──────────────────────────▶│                              │
    │  402 { accepts: [base, solana] }                           │
    │ ◀──────────────────────────│                              │
    │  sign chosen rail          │                              │
    │  GET + X-PAYMENT           │                              │
    │ ──────────────────────────▶│ verify + settle ────────────▶│
    │                            │ resolve tx on Base/Solana ──▶│
    │  200 { receipt: {payload, signature} } + X-PAYMENT-RESPONSE│
    │ ◀──────────────────────────│                              │
```

Pleasingly circular: the `transaction` in your `X-PAYMENT-RESPONSE` is exactly what you'd feed back into `GET /receipt/:tx`.

## Real backend / API keys

**No API keys anywhere, and no fixtures anywhere.** Every receipt in this repo comes from a live chain read:

| env | effect |
|---|---|
| *(unset)* | Public Base RPC (via viem) and `api.mainnet-beta.solana.com`. Real data, rate-limited. |
| `BASE_RPC_URL` | Your own Base endpoint — Alchemy, QuickNode, whatever. |
| `SOLANA_RPC_URL` | Your own Solana endpoint — Helius, Triton, etc. |

`ADMIN_KEY` guards `/annotate`; `SIGNING_SECRET` signs receipts and exports. Both have dev defaults and both must be set before you expose the service.

## For AI agents

- **`skill.md`** — the agent-facing contract: routes, prices, receipt schema, error codes.
- **`/.well-known/x402`** — machine-readable manifest, served by the app and committed at `public/.well-known/x402`.
- **`openapi.json`** — OpenAPI 3.1 including the 402 response and `PaymentRequirements`.
- **MCP** — `examples/mcp-tool.md` exposes `resolve_receipt` and `export_ledger` as Claude tools, so the model can answer "what did I spend last week?".
- **Discovery** — list your deployment on [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).

## Docs

Full docs: **https://nirholas.github.io/x402-receipts/** — [tutorial](https://nirholas.github.io/x402-receipts/tutorial), [API reference](https://nirholas.github.io/x402-receipts/api), [for agents](https://nirholas.github.io/x402-receipts/agents).

## Support

Questions, bugs, integrations: **nichxbt@gmail.com**

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
