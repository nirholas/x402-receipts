# Raw curl walkthrough — 402 → pay → 200

Against `npm run dev` on `localhost:4033`.

## 1. Free first

```bash
curl -s localhost:4033/summary | jq
# { "summary": { "count": 0, "totalUsd": 0, "failedCount": 0,
#                "firstAt": null, "lastAt": null, "byRail": {}, "byMerchant": {} },
#   "filter": {} }

curl -s localhost:4033/health | jq '{rails: [.rails[].network], resolvers, ledgerSize}'
```

## 2. Ask without paying

```bash
curl -i -s "localhost:4033/receipt/0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2?network=base"
```

```http
HTTP/1.1 402 Payment Required
Access-Control-Expose-Headers: x-payment-response
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "resource": "http://localhost:4033/receipt/0x33b7dd08…",
      "description": "x402-receipts: GET /receipt/:tx",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "resource": "http://localhost:4033/receipt/0x33b7dd08…",
      "description": "x402-receipts: GET /receipt/:tx",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", "amount": "1000" }
    }
  ]
}
```

Just the rails:

```bash
curl -s "localhost:4033/receipt/0x33b7dd08…" \
  | jq -r '.accepts[] | "\(.network)\t$\(.maxAmountRequired|tonumber/1000000)\t\(.payTo)"'
```

## 3. Pay

Signing needs a wallet, so produce the header with an x402 client (`npm run client`, or see [`agent-client.ts`](./agent-client.ts)):

```bash
curl -s "localhost:4033/receipt/0x33b7dd081487769518a62d6da79f1e9f2872c02253b0981ac6317fc0c51c65e2?network=base" \
  -H "X-PAYMENT: $X_PAYMENT" | jq .receipt.payload
```

```jsonc
{
  "transaction": "0x33b7dd08…", "rail": "evm", "network": "base", "status": "success",
  "timestamp": "2026-08-07T03:29:47.000Z",
  "payer": "0x8f2c…", "payee": "0x062009cdda92e553193eb71ca0a5eef0fb09b18f",
  "amount": 3.26, "symbol": "USDC", "feeNative": 0.00004801524, "block": 49642020,
  "explorerUrl": "https://basescan.org/tx/0x33b7dd08…",
  "transfers": [ … ], "metadata": {}, "resolvedAt": "…", "updatedAt": "…"
}
```

## 4. Same endpoint, Solana

No `?network=` needed — the base58 shape is enough:

```bash
curl -s "localhost:4033/receipt/qMvBwBSdfWTAPyDZi1BDk3Nu68HEVAsz9aMexw3XT7rLobYmpLSg1BBW9Bgvpt1e7A8NUjcuSjAZ5aoYF8cARjj" \
  -H "X-PAYMENT: $X_PAYMENT" | jq '.receipt.payload | {rail, network, payer, payee, amount, symbol}'
```

```jsonc
{
  "rail": "solana", "network": "solana",
  "payer": "8R5qdXKMn2KcfHBy9rEpi43KScHewqvRAcpFyqoL3wap",
  "payee": "FGQoLafigpyVb7mLa6pvsDDpDaEE3JetrzQoAggTo3n7",
  "amount": 10.737967, "symbol": "USDC"
}
```

## 5. Attach context

At resolve time:

```bash
curl -s "localhost:4033/receipt/0x33b7dd08…?resource=https%3A%2F%2Fapi.example.com%2Freport&category=data&label=run-8812" \
  -H "X-PAYMENT: $X_PAYMENT" | jq .receipt.payload.metadata
# { "resource": "https://api.example.com/report", "merchant": "api.example.com",
#   "category": "data", "label": "run-8812" }
```

Or later, free:

```bash
curl -s -X POST localhost:4033/annotate/0x33b7dd08… \
  -H 'X-Admin-Key: dev-admin-key' -H 'content-type: application/json' \
  -d '{"category":"data","label":"run-8812"}' | jq .receipt.payload.metadata
```

## 6. Buy the book

```bash
curl -s "localhost:4033/export?since=2026-08-01" -H "X-PAYMENT: $X_PAYMENT" \
  | jq '{summary: .export.payload.summary, csv: (.csv | split("\r\n")[0:3])}'
```

Straight to a file for accounting:

```bash
curl -s "localhost:4033/export?category=data" -H "X-PAYMENT: $X_PAYMENT" \
  | jq -r .csv > august-data.csv
```

Filters compose: `?rail=solana&merchant=api.example.com&since=2026-08-01&until=2026-09-01`.

## 7. Verify the book

```bash
curl -s -X POST localhost:4033/verify -H 'content-type: application/json' \
  -d "$(curl -s localhost:4033/export -H "X-PAYMENT: $X_PAYMENT" | jq -c .export)"
# { "valid": true }
```

Edit one digit of `records` and it returns `false`.

## 8. Errors you'll actually hit

```bash
# Not a hash or a signature
curl -s "localhost:4033/receipt/hello" -H "X-PAYMENT: $X_PAYMENT" | jq
# { "error": "UNRECOGNIZED_IDENTIFIER", "hint": "Pass ?network=base|base-sepolia|solana|solana-devnet" }

# Real shape, no such transaction
curl -s "localhost:4033/receipt/0x9999999999999999999999999999999999999999999999999999999999999999?network=base" \
  -H "X-PAYMENT: $X_PAYMENT" | jq -r .error
# TRANSACTION_NOT_FOUND

# Annotating something never resolved
curl -s -X POST localhost:4033/annotate/0xdead… -H 'X-Admin-Key: dev-admin-key' \
  -H 'content-type: application/json' -d '{}' | jq -r .error
# RECEIPT_NOT_FOUND

# Public RPC rate limit → 502 { "error": "RPC_ERROR" }
# Facilitator down      → 502 { "error": "facilitator_unreachable" }  (not charged)
```
