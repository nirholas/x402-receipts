# Tutorial — x402-receipts

Resolve a real Base transaction and a real Solana transaction, then buy the book.

---

## 1. Install

```bash
git clone https://github.com/nirholas/x402-receipts
cd x402-receipts
npm install
cp .env.example .env
```

Node 18+. Nothing needs configuring: chain reads go through public keyless RPC, and both payment rails ship with the suite's public receive addresses.

## 2. Run it

```bash
npm run dev
```

```
x402-receipts on http://localhost:4033

Payment rails (client picks one):
  evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402
  solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW

Chain resolvers (keyless public RPC by default):
  base    viem public endpoint
  solana  https://api.mainnet-beta.solana.com

Ledger: data/receipts.json (0 receipts)

Paid routes:
  GET /receipt/:tx     $0.001
  GET /export          $0.01
```

Two separate things live in that banner, and it's worth keeping them apart:

- **Payment rails** — how you pay *this service*.
- **Chain resolvers** — which chains it *reads* to build a receipt.

They're independent. You can pay on base-sepolia to resolve a Solana mainnet signature.

## 3. Look before you pay

```bash
curl -s localhost:4033/summary | jq
```

```jsonc
{ "summary": { "count": 0, "totalUsd": 0, "failedCount": 0,
               "firstAt": null, "lastAt": null, "byRail": {}, "byMerchant": {} },
  "filter": {} }
```

Free, so an agent can decide whether the $0.01 export is worth buying before it commits.

## 4. Your first 402

```bash
curl -s "localhost:4033/receipt/0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2" | jq .accepts
```

```jsonc
[
  { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
    "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "…": "…" },
  { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
    "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "…": "…" }
]
```

`1000` atomic units = $0.001.

## 5. Pay and resolve

Fund a Base Sepolia wallet at [faucet.circle.com](https://faucet.circle.com):

```bash
PRIVATE_KEY=0xyourTestKey npm run client
```

The example resolves a Base transaction, then a Solana one, then buys the export.

**Base** — decoded from the `Transfer` logs in the transaction receipt:

```jsonc
{
  "transaction": "0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2",
  "rail": "evm", "network": "base", "status": "success",
  "payer": "0x8f2c…", "payee": "0x062009cdda92e553193eb71ca0a5eef0fb09b18f",
  "amount": 3.26, "symbol": "USDC",
  "timestamp": "2026-08-07T03:29:47.000Z"
}
```

**Solana** — same shape, from pre/post token balance deltas:

```jsonc
{
  "transaction": "qMvBwBSdfWTAPyDZi1BDk3Nu68HEVAsz9aMexw3XT7rLobYmpLSg1BBW9Bgvpt1e7A8NUjcuSjAZ5aoYF8cARjj",
  "rail": "solana", "network": "solana", "status": "success",
  "payer": "8R5qdXKMn2KcfHBy9rEpi43KScHewqvRAcpFyqoL3wap",
  "payee": "FGQoLafigpyVb7mLa6pvsDDpDaEE3JetrzQoAggTo3n7",
  "amount": 10.737967, "symbol": "USDC",
  "timestamp": "2026-08-07T03:29:44.000Z"
}
```

Note what you did **not** have to do: tell it which chain. `0x` + 64 hex is a Base hash; an 86–88 character base58 string is a Solana signature. Pass `?network=` only to disambiguate or to force a testnet.

## 6. Attach what the chain can't know

The chain knows an address received 0.01 USDC. It does not know that was your `/report` call for run 8812. Add that at resolve time:

```bash
curl -s "localhost:4033/receipt/0x33b7…?resource=https%3A%2F%2Fapi.example.com%2Freport&category=data&label=run-8812" \
  -H "X-PAYMENT: $X_PAYMENT" | jq .receipt.payload.metadata
# { "resource": "https://api.example.com/report", "merchant": "api.example.com",
#   "category": "data", "label": "run-8812" }
```

`merchant` is derived from `resource` when you don't supply it. Or annotate later, free:

```bash
curl -s -X POST localhost:4033/annotate/0x33b7… \
  -H 'X-Admin-Key: dev-admin-key' -H 'content-type: application/json' \
  -d '{"category":"data","label":"run-8812"}' | jq .receipt.payload.metadata
```

## 7. Buy the book

```bash
curl -s "localhost:4033/export?since=2026-08-01" -H "X-PAYMENT: $X_PAYMENT" | jq '{summary: .export.payload.summary, csvHead: (.csv | split("\r\n")[0:2])}'
```

```jsonc
{
  "summary": {
    "count": 2, "totalUsd": 13.997967, "failedCount": 0,
    "byRail": { "evm": { "count": 1, "totalUsd": 3.26 },
                "solana": { "count": 1, "totalUsd": 10.737967 } },
    "byMerchant": { "api.example.com": { "count": 2, "totalUsd": 13.997967 } }
  },
  "csvHead": [
    "timestamp,transaction,rail,network,status,payer,payee,amount,symbol,asset,feeNative,block,merchant,resource,category,label,explorerUrl",
    "2026-08-07T03:29:47.000Z,0x33b7dd08…,evm,base,success,0x8f2c…,0x0620…,3.26,USDC,…"
  ]
}
```

Filters: `rail`, `network`, `payer`, `payee`, `merchant`, `category`, `since` (inclusive), `until` (exclusive).

`totalUsd` sums successful **USDC** legs only. USDC is dollar-denominated so no price oracle is involved; other assets are counted but not summed, because guessing a WETH price into an expense report is worse than leaving it out.

## 8. Prove it wasn't edited

Exports and receipts are HMAC-signed over canonical JSON:

```bash
curl -s -X POST localhost:4033/verify -H 'content-type: application/json' \
  -d "$(curl -s localhost:4033/export -H "X-PAYMENT: $X_PAYMENT" | jq -c .export)"
# { "valid": true }
```

Change one digit in `records` and it comes back `false`. That's what lets finance accept a book produced by an agent without trusting the agent.

## 9. As a library

```ts
import { resolveTransaction, ReceiptLedger, toCsv } from "x402-receipts";

const ledger = new ReceiptLedger({ file: "data/receipts.json" });

// After every paid call your agent makes:
const receipt = decodeXPaymentResponse(res.headers.get("x-payment-response")!);
const resolved = await resolveTransaction(receipt.transaction);
ledger.record(resolved, { resource: url, category: "data", label: runId });

// At month end:
await fs.writeFile("august.csv", toCsv(ledger.list({ since: "2026-08-01", until: "2026-09-01" })));
```

`resolveTransaction` throws `UnrecognizedIdentifierError` for anything that isn't a Base hash or Solana signature, and `TransactionNotFoundError` when the chain doesn't have it — usually because it's unconfirmed, on a different network, or older than the RPC's history window.

## 10. Going to production

```bash
NETWORK=base
SOLANA_NETWORK=mainnet-beta
FACILITATOR_URL=https://facilitator.payai.network
SOLANA_FACILITATOR_URL=https://facilitator.payai.network
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
PAY_TO_ADDRESS=0xYourRealWallet
SOLANA_PAY_TO_ADDRESS=YourRealSolanaWallet
ADMIN_KEY=$(openssl rand -hex 32)
SIGNING_SECRET=$(openssl rand -hex 32)
```

Checklist:

- **Use dedicated RPC.** The public endpoints will rate-limit you, and a 502 on a paid route is a bad look. This is the one thing you should actually pay for.
- **Set `SIGNING_SECRET`.** Otherwise exports are signed with a public dev key and anyone can forge a book.
- **Set `ADMIN_KEY`.** `/annotate` can rewrite metadata on any receipt.
- **Persist `data/receipts.json`** on a volume — it *is* the ledger.
- **Mind the history window.** Public Solana RPC only serves recent transactions; resolve receipts promptly rather than at month end, and let the ledger be your archive.

---

Next: [API reference](./api.md) · [For AI agents](./agents.md)
