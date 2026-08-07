# Skill: x402-receipts

## What this service does

An x402 payment leaves you holding a bare identifier — a Base transaction hash, or a Solana transaction signature — and nothing else. `x402-receipts` resolves either one against public chain RPC and returns an **enriched, HMAC-signed receipt**: who paid, who was paid, how much of which token, at what block time, what the network fee was, plus whatever request metadata you attach. Every lookup is kept in a ledger, and `GET /export` hands the whole book back as CSV *and* JSON in a single response.

**Payment: USDC on Base or Solana — your client picks the rail.** Every 402 lists both. Note the two independent things going on: the rail you *pay* on, and the chain a receipt is *looked up* on. They don't have to match.

## Base URL

```
<BASE_URL>          # e.g. http://localhost:4033, or your deployment
```

## Endpoints

### GET /receipt/:tx — $0.001

Resolve one transaction. **The identifier's shape picks the chain**: `0x` + 64 hex → Base; a base58 signature (86–88 chars) → Solana.

**Query params** (all optional)

| param | meaning |
|---|---|
| `network` | `base` \| `base-sepolia` \| `solana` \| `solana-devnet`. Overrides shape detection and the server default. |
| `resource` | The x402 resource this payment bought, e.g. `https://api.example.com/report` |
| `merchant` | Merchant host. Derived from `resource` when omitted. |
| `label` | Free-form: which agent, which run, which task |
| `category` | Accounting category, e.g. `data`, `compute`, `booking` |

**Response 200**

```jsonc
{
  "receipt": {
    "payload": {
      "transaction": "0x33b7dd08…",
      "rail": "evm",
      "network": "base",
      "status": "success",
      "timestamp": "2026-08-07T03:29:47.000Z",
      "payer": "0x8f2c…",
      "payee": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "amount": 0.01,
      "amountRaw": "10000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "symbol": "USDC",
      "feeNative": 0.000048,
      "block": 49642020,
      "explorerUrl": "https://basescan.org/tx/0x33b7dd08…",
      "transfers": [ { "from": "0x8f2c…", "to": "0x4025…", "amount": 0.01, "symbol": "USDC", "decimals": 6, "…": "…" } ],
      "metadata": { "resource": "https://api.example.com/report", "merchant": "api.example.com", "category": "data" },
      "resolvedAt": "…", "updatedAt": "…"
    },
    "signature": "7c1a…",
    "algorithm": "HMAC-SHA256"
  },
  "paidWith": { "rail": "evm", "network": "base-sepolia", "transaction": "0x…", "payer": "0x9a…" }
}
```

`payer`/`payee`/`amount` are the **primary leg** — the largest recognised-token transfer. `transfers` has everything, which matters for routed or multi-hop payments.

On Solana, `submitter` (in `transfers`' surrounding context) is the fee payer, which for x402 payments is the facilitator's sponsor, not the buyer. The buyer is the `from` of the USDC transfer. Read `payer`, not the fee payer.

### GET /export — $0.01

The whole ledger, filtered, in both formats at once.

**Query params**: `rail`, `network`, `payer`, `payee`, `merchant`, `category`, `since` (inclusive ISO), `until` (exclusive ISO).

```jsonc
{
  "export": {
    "payload": {
      "generatedAt": "2026-08-07T16:00:00.000Z",
      "filter": { "since": "2026-08-01" },
      "summary": {
        "count": 42, "totalUsd": 0.417, "failedCount": 1,
        "firstAt": "2026-08-01T…", "lastAt": "2026-08-07T…",
        "byRail":     { "evm": { "count": 30, "totalUsd": 0.31 }, "solana": { "count": 12, "totalUsd": 0.107 } },
        "byMerchant": { "api.example.com": { "count": 20, "totalUsd": 0.2 } }
      },
      "records": [ /* full ReceiptRecord objects */ ]
    },
    "signature": "b02f…", "algorithm": "HMAC-SHA256"
  },
  "csv": "timestamp,transaction,rail,network,status,payer,payee,amount,symbol,asset,feeNative,block,merchant,resource,category,label,explorerUrl\r\n…",
  "digest": "b02f…"
}
```

`totalUsd` sums successful **USDC** legs only — USDC is dollar-denominated, so no price oracle is involved. Other assets are counted in `count` but not summed.

### POST /annotate/:tx — free, requires `X-Admin-Key`

Body: any of `{ resource, merchant, label, category, … }`. Merges into the record's metadata and returns the re-signed receipt. **404** if the transaction hasn't been resolved yet — call `GET /receipt/:tx` first.

### GET /summary — free

Totals only, no rows: `{ summary, filter }`. Accepts `rail`, `merchant`, `since`, `until`. Use it to decide whether the $0.01 export is worth buying.

### POST /verify — free

`{ payload, signature }` → `{ valid: true|false }`. Works on receipts and exports alike.

### GET /health — free

`{ ok, service, rails, resolvers: { base, solana }, ledgerSize }`.

## Payment

- Protocol: **x402**, `scheme: "exact"`, `x402Version: 1`.
- Asset: **USDC** (6 decimals) on both rails.
- Rails in every 402 `accepts` array:
  - `network: "base-sepolia"` (or `base`), payTo `0x40252CFDF8B20Ed757D61ff157719F33Ec332402`, facilitator `https://x402.org/facilitator`.
  - `network: "solana"` (or `solana-devnet`), payTo `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`, facilitator `https://facilitator.payai.network`. `extra.feePayer` sponsors the SOL fee, so you need only USDC.
- Pay with `x402-fetch`, `@three-ws/x402-payment-modal`, or any x402 client.
- The 200 carries `X-PAYMENT-RESPONSE` (base64 JSON) with rail, network, transaction and payer — which is, pleasingly, exactly the identifier you'd feed back into `GET /receipt/:tx`.

## Error codes

| status | body `error` | meaning |
|---|---|---|
| 402 | `X-PAYMENT header is required` | Unpaid. Read `accepts`, pay, retry. |
| 402 | `invalid X-PAYMENT header: …` / `unsupported rail: …` | Malformed payload, or a network this endpoint doesn't take. |
| 402 | `payment rejected: …` / `settlement failed: …` | Facilitator refused or couldn't settle. Not charged. |
| 400 | `UNRECOGNIZED_IDENTIFIER` | Not a Base hash or a Solana signature. Pass `?network=`. |
| 400 | `BAD_REQUEST` | `/verify` without `payload` + `signature`. |
| 401 | `UNAUTHORIZED` | `/annotate` without a valid `X-Admin-Key`. |
| 404 | `TRANSACTION_NOT_FOUND` | Unconfirmed, wrong network, or outside the RPC's history window. |
| 404 | `RECEIPT_NOT_FOUND` | Annotating a transaction that was never resolved. |
| 500 | `no_payment_rail` | Server misconfigured: no valid payTo on either rail. |
| 502 | `RPC_ERROR` | Chain RPC failed (usually rate limiting on a public endpoint). |
| 502 | `facilitator_unreachable` / `settlement_error` | Facilitator down. Retry; not charged. |

## Discovery

- Manifest: `<BASE_URL>/.well-known/x402`
- Docs: https://nirholas.github.io/x402-receipts/
- Source: https://github.com/nirholas/x402-receipts
- Contact: nichxbt@gmail.com
