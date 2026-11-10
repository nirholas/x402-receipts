---
name: resolve-x402-receipts
description: Run the x402-receipts HTTP service to turn a Base transaction hash or Solana signature into an enriched, HMAC-signed receipt, and export the lookup ledger as CSV and JSON. Use when an agent needs accounting records for its x402 spending and can pay per lookup in USDC over x402.
---

# x402-receipts

x402-receipts resolves a transaction against public chain RPC and returns a signed receipt (payer, payee, amount, token, block time, network fee, plus metadata you attach). Every lookup is kept in a ledger that `/export` returns as CSV and JSON. The identifier's shape picks the chain: `0x` plus 64 hex is Base, a base58 signature (86 to 88 chars) is Solana.

Paying is irreversible. Before any paid call, show the user the route, price, network and payTo address from the 402 response, and wait for an explicit yes.

## Run the service

From a clone (Node 18+):

```bash
git clone https://github.com/nirholas/x402-receipts
cd x402-receipts && npm install
npm run dev        # tsx src/server.ts, listens on :4033 (PORT overrides)
```

Environment (see `.env.example`): `BASE_RPC_URL` (default public Base RPC), `SOLANA_RPC_URL` (default `https://api.mainnet-beta.solana.com`; public endpoints are rate limited), `LEDGER_FILE` (default `data/receipts.json`), `ADMIN_KEY` (guards `/annotate`, change the example value), `SIGNING_SECRET` (HMAC key, set your own or exports are forgeable). Payment settings: `PAY_TO_ADDRESS` (Base receive address), `SOLANA_PAY_TO_ADDRESS`, `NETWORK` (`base-sepolia` default, or `base`), `SOLANA_NETWORK`, `FACILITATOR_URL`, `PUBLIC_BASE_URL`. Set your own pay-to addresses to be paid yourself. `npm run build` then `npm start` runs the compiled server.

## Routes

| Route | Price | Params |
|---|---|---|
| `GET /receipt/:tx` | $0.001 | optional `network` (`base`, `base-sepolia`, `solana`, `solana-devnet`), `resource`, `merchant`, `label`, `category` |
| `GET /export` | $0.01 | optional filters `rail`, `network`, `payer`, `payee`, `merchant`, `category`, `since` (inclusive ISO), `until` (exclusive ISO); returns CSV and JSON together |
| `POST /annotate/:tx` | free, `X-Admin-Key` header | merge `resource`, `merchant`, `label`, `category` into a resolved record; 404 until `/receipt/:tx` has resolved it |
| `GET /summary` | free | totals only, accepts `rail`, `merchant`, `since`, `until`; use it to decide whether the export is worth buying |
| `POST /verify` | free | `{payload, signature}` returns `{valid}` for receipts and exports |
| `GET /health` | free | status, resolvers, `ledgerSize` |

## Paying

An unpaid request to a paid route returns 402 with an `accepts` array listing both rails (USDC on Base or Solana). Sign the entry your wallet supports and retry with the base64 `X-PAYMENT` header. The settlement receipt is in the `X-PAYMENT-RESPONSE` header. The reference client is `examples/agent-client.ts` (`npm run client`), which uses `x402-fetch` with `PRIVATE_KEY` for a Base Sepolia wallet and `BASE_URL` (default `http://localhost:4033`).

The rail you pay on and the chain a receipt is looked up on are independent. On Solana the fee payer is the facilitator's sponsor, so read `payer`, not the submitter. `totalUsd` sums successful USDC legs only.

## Example

```bash
curl -i "localhost:4033/receipt/0x<64 hex>?label=research-run-7&category=data"   # 402, pay, signed receipt
curl "localhost:4033/summary?since=2026-01-01T00:00:00Z"                          # free
curl -i "localhost:4033/export?category=data"                                     # $0.01, CSV and JSON
```
