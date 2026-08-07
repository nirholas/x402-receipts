# API reference — x402-receipts

Two surfaces: the **HTTP API** and the **library**. Both resolve Base transaction hashes and Solana transaction signatures through the same code.

- Machine-readable: [`openapi.json`](https://github.com/nirholas/x402-receipts/blob/main/openapi.json) · [`/.well-known/x402`](https://github.com/nirholas/x402-receipts/blob/main/public/.well-known/x402)
- Agent-facing summary: [`skill.md`](https://github.com/nirholas/x402-receipts/blob/main/skill.md)

---

## HTTP API

Base URL: `http://localhost:4033` in dev.

### `GET /receipt/:tx` — $0.001

Resolve one transaction. **The identifier's shape picks the chain**: `0x` + 64 hex → Base; base58, 86–88 chars → Solana.

**Query params** (all optional)

| param | meaning |
|---|---|
| `network` | `base` \| `base-sepolia` \| `solana` \| `solana-devnet`. Overrides shape detection. |
| `resource` | The x402 resource this payment bought |
| `merchant` | Merchant host. Derived from `resource` when omitted. |
| `label` | Free-form: which agent, which run |
| `category` | Accounting category |

**200**

```jsonc
{
  "receipt": {
    "payload": {
      "transaction": "0x33b7dd08…", "rail": "evm", "network": "base", "status": "success",
      "timestamp": "2026-08-07T03:29:47.000Z",
      "payer": "0x8f2c…", "payee": "0x0620…",
      "amount": 3.26, "amountRaw": "3260000", "symbol": "USDC",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "feeNative": 0.000048, "block": 49642020,
      "explorerUrl": "https://basescan.org/tx/0x33b7dd08…",
      "transfers": [ { "from": "0x8f2c…", "to": "0x0620…", "amount": 3.26, "amountRaw": "3260000",
                       "asset": "0x8335…", "symbol": "USDC", "decimals": 6 } ],
      "metadata": { "resource": "https://api.example.com/report", "merchant": "api.example.com", "category": "data" },
      "resolvedAt": "…", "updatedAt": "…"
    },
    "signature": "7c1a…", "algorithm": "HMAC-SHA256"
  },
  "paidWith": { "rail": "evm", "network": "base-sepolia", "transaction": "0x…", "payer": "0x9a…" }
}
```

`payer` / `payee` / `amount` are the **primary leg**: the largest recognised-token transfer. `transfers` carries everything, which is what you want for routed or multi-hop payments.

Errors: **400** `UNRECOGNIZED_IDENTIFIER` (not a hash or a signature — pass `?network=`), **404** `TRANSACTION_NOT_FOUND` (unconfirmed, wrong network, or past the RPC's history window), **502** `RPC_ERROR`.

### `GET /export` — $0.01

**Query params**: `rail`, `network`, `payer`, `payee`, `merchant`, `category`, `since` (inclusive ISO), `until` (exclusive ISO).

```jsonc
{
  "export": {
    "payload": {
      "generatedAt": "2026-08-07T16:00:00.000Z",
      "filter": { "since": "2026-08-01" },
      "summary": {
        "count": 42, "totalUsd": 0.417, "failedCount": 1,
        "firstAt": "…", "lastAt": "…",
        "byRail": { "evm": { "count": 30, "totalUsd": 0.31 }, "solana": { "count": 12, "totalUsd": 0.107 } },
        "byMerchant": { "api.example.com": { "count": 20, "totalUsd": 0.2 } }
      },
      "records": [ /* full ReceiptRecord objects */ ]
    },
    "signature": "b02f…", "algorithm": "HMAC-SHA256"
  },
  "csv": "timestamp,transaction,rail,…\r\n…",
  "digest": "b02f…",
  "paidWith": { … }
}
```

CSV columns, in a fixed order so diffs stay readable:

```
timestamp, transaction, rail, network, status, payer, payee, amount, symbol,
asset, feeNative, block, merchant, resource, category, label, explorerUrl
```

RFC 4180: CRLF line endings, quotes doubled inside quoted cells.

### `POST /annotate/:tx` — free, `X-Admin-Key`

Body: `{ resource?, merchant?, label?, category?, … }` — merged into existing metadata. Returns the re-signed receipt. **404** `RECEIPT_NOT_FOUND` if the transaction was never resolved.

### `GET /summary` — free

`{ summary, filter }`. Accepts `rail`, `merchant`, `since`, `until`.

### `POST /verify` — free

`{ payload, signature }` → `{ valid: boolean }`. Works on receipts and exports.

### `GET /health` — free

`{ ok, service, rails, resolvers: { base, solana }, ledgerSize }`.

### Error cases

| status | body | when |
|---|---|---|
| 402 | `{ x402Version, error, accepts[] }` | No/invalid/unsupported payment |
| 400 | `UNRECOGNIZED_IDENTIFIER` / `BAD_REQUEST` | Bad identifier, or `/verify` missing fields |
| 401 | `UNAUTHORIZED` | `/annotate` without a valid `X-Admin-Key` |
| 404 | `TRANSACTION_NOT_FOUND` / `RECEIPT_NOT_FOUND` | Chain doesn't have it / never resolved |
| 500 | `no_payment_rail` | No valid payTo on either rail |
| 502 | `RPC_ERROR` / `facilitator_unreachable` | Upstream down; not charged |

---

## Library API

```ts
import {
  resolveTransaction, detectRail, KNOWN_ASSETS,
  ReceiptLedger, toCsv, CSV_COLUMNS,
  paywall, paymentReceipt, sign, verify, signed,
  TransactionNotFoundError, UnrecognizedIdentifierError,
} from "x402-receipts";
```

### `resolveTransaction(identifier, options?)`

```ts
const receipt: ChainReceipt = await resolveTransaction("0x33b7dd08…", { network: "base" });
```

| option | default | notes |
|---|---|---|
| `network` | `NETWORK` / `SOLANA_NETWORK` env | Forces a chain, overriding shape detection |
| `baseRpcUrl` | `BASE_RPC_URL`, else viem's public endpoint | |
| `solanaRpcUrl` | `SOLANA_RPC_URL`, else the public cluster | |

```ts
interface ChainReceipt {
  rail: "evm" | "solana";
  network: string;
  transaction: string;
  status: "success" | "failed";
  block: number | null;          // block number (EVM) or slot (Solana)
  timestamp: string | null;
  submitter: string | null;      // EVM: sender. Solana: FEE PAYER (the facilitator's sponsor)
  transfers: TokenTransfer[];
  feeNative: number | null;      // ETH or SOL
  explorerUrl: string;
}
```

> On Solana, `submitter` is the fee payer — for x402 payments that's the facilitator's sponsor, not the buyer. The buyer is the `from` of the USDC transfer.

### `detectRail(identifier)`

`"evm"` for `0x` + 64 hex, `"solana"` for base58 64–90 chars, otherwise throws `UnrecognizedIdentifierError`.

### `ReceiptLedger`

```ts
const ledger = new ReceiptLedger({ file: "data/receipts.json" });  // or { ephemeral: true }
```

| method | returns | notes |
|---|---|---|
| `record(chainReceipt, metadata?)` | `ReceiptRecord` | Idempotent by transaction; keeps existing metadata |
| `annotate(tx, metadata)` | `ReceiptRecord \| undefined` | Merges metadata |
| `get(tx)` | `ReceiptRecord \| undefined` | |
| `list(filter?)` | `ReceiptRecord[]` | Newest first |
| `summary(filter?)` | `LedgerSummary` | Totals, per-rail and per-merchant |
| `digest(filter?)` | `string` | HMAC over the filtered set |

`ReceiptFilter`: `{ rail?, network?, payer?, payee?, merchant?, category?, since?, until? }`. Address comparisons are case-insensitive; `since` is inclusive and `until` exclusive.

Writes are atomic (temp file + rename). A corrupt ledger file is ignored rather than fatal at boot.

### `toCsv(records)` / `CSV_COLUMNS`

RFC 4180 CSV in the fixed column order above.

### `KNOWN_ASSETS`

USDC contracts and mints for `base`, `base-sepolia`, `solana` and `solana-devnet`, keyed by address/mint. Unknown assets still appear in `transfers` with `symbol: "UNKNOWN"` and are excluded from `totalUsd`.

### `paywall(routePrices, { service, baseUrl? })`

The dual-rail x402 middleware, exported for reuse. Paths support `:param`, `*` and `**`.

### Signing

```ts
sign(payload, secret?)              // hex HMAC-SHA256 over canonical JSON
verify(payload, signature, secret?) // constant-time
signed(payload)                     // { payload, signature, algorithm }
```

`SIGNING_SECRET`, with a public dev default.

---

[Tutorial](./tutorial.md) · [For AI agents](./agents.md)
