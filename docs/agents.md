# For AI agents — x402-receipts

The service that answers "what did I actually spend?" — across both chains, in a format finance accepts.

---

## 1. Discovery

| what | where | for |
|---|---|---|
| `skill.md` | [raw](https://raw.githubusercontent.com/nirholas/x402-receipts/main/skill.md) | Routes, prices, receipt schema, error codes |
| `/.well-known/x402` | `<BASE_URL>/.well-known/x402` | Machine-readable manifest with input/output schemas and both rails |
| `openapi.json` | repo root | OpenAPI 3.1 including the 402 response |

```bash
curl -s <BASE_URL>/summary | jq   # free: is the export worth buying?
```

## 2. Paying — either rail

Every 402 lists both rails; pick whichever your wallet holds.

```jsonc
{
  "x402Version": 1,
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKup…" } }
  ]
}
```

On Solana, `extra.feePayer` is the facilitator's sponsor: it pays the SOL network fee, so you need **only USDC, no SOL**.

**Keep the rail you pay on separate from the chain you query.** They are unrelated. Paying on base-sepolia to resolve a Solana mainnet signature is normal and correct.

## 3. The loop worth building

This is the whole point — close the loop on every paid call you make:

```ts
import { decodeXPaymentResponse } from "x402-fetch";

const res = await payFetch(url);                                    // any x402 call
const settlement = decodeXPaymentResponse(res.headers.get("x-payment-response")!);

// The settlement's `transaction` is exactly what /receipt/:tx takes.
const receipt = await payFetch(
  `${RECEIPTS}/receipt/${settlement.transaction}` +
  `?resource=${encodeURIComponent(url)}&category=data&label=${runId}`,
).then(r => r.json());
```

Do that once per purchase and the ledger builds itself, on both chains, with the context only you knew — which resource, which run, which category. At month end `GET /export` is a single call.

## 4. What the receipt gives you

| field | why you care |
|---|---|
| `payer` / `payee` | Who actually moved money. On Solana this is **not** the fee payer. |
| `amount` + `symbol` | The real charge, not the advertised price. Worth checking they match. |
| `status` | `failed` transactions still cost gas and still appear. Reconcile them. |
| `timestamp` | Block time, for period boundaries |
| `feeNative` | ETH or SOL burned — the hidden cost of a "$0.001" call |
| `transfers` | Every leg, for routed or multi-hop payments |
| `explorerUrl` | Hand a human a link when they ask |

The receipt is HMAC-signed, so a supervisor can check it without trusting you:

```bash
curl -s -X POST <BASE_URL>/verify -H 'content-type: application/json' \
  -d '{"payload":{…},"signature":"7c1a…"}'   # → { "valid": true }
```

## 5. Reading the export

`totalUsd` sums successful **USDC** legs only. Other assets are counted in `count` but not summed — no price oracle is involved, and guessing a token price into an expense report is worse than leaving it out. If your spending isn't all USDC, reconcile the non-USDC rows yourself from `transfers`.

`byRail` and `byMerchant` are the two breakdowns that answer real questions: *which chain is this costing me on*, and *who is taking the money*.

## 6. Failure modes to handle

| situation | what to do |
|---|---|
| `404 TRANSACTION_NOT_FOUND` right after paying | The transaction isn't confirmed yet. Wait a few seconds and retry. |
| `404` on an old Solana signature | Public RPC only serves recent history. Resolve promptly; let the ledger be the archive. |
| `400 UNRECOGNIZED_IDENTIFIER` | You passed something that isn't a hash or a signature. Add `?network=`. |
| `502 RPC_ERROR` | Public RPC rate limit. Back off; the operator should set a dedicated endpoint. |

## 7. MCP integration

[`examples/mcp-tool.md`](https://github.com/nirholas/x402-receipts/blob/main/examples/mcp-tool.md) exposes `resolve_receipt`, `export_ledger` and the free `spend_summary` as Claude tools — enough for a model to answer "what did I spend on data last week, and on which chain?".

## 8. Getting listed

- **[x402scan.com](https://x402scan.com)** — point it at your `/.well-known/x402`.
- **x402 Bazaar** — the protocol's own resource directory; same manifest format.
- **[agentic.market](https://agentic.market)** — agent-facing marketplace listing.

---

[Tutorial](./tutorial.md) · [API reference](./api.md) · Contact: nichxbt@gmail.com
