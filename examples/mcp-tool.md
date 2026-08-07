# Expose x402-receipts as an MCP tool

Gives a model three things: resolve one payment, export the book, and — free — check the totals first.

## Install

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod
```

## The server

`mcp-receipts.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE_URL = process.env.RECEIPTS_URL ?? "http://localhost:4033";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const pay = wrapFetchWithPayment(fetch, account, 100_000n);   // ≤ $0.10 per call

const server = new McpServer({ name: "x402-receipts", version: "0.1.0" });

server.tool(
  "spend_summary",
  "Ledger totals — count, USD total, per-rail and per-merchant breakdowns. FREE. " +
    "Call this before export_ledger to see whether the $0.01 export is worth it.",
  {
    rail: z.enum(["evm", "solana"]).optional(),
    merchant: z.string().optional(),
    since: z.string().optional().describe("ISO date, inclusive"),
    until: z.string().optional().describe("ISO date, exclusive"),
  },
  async (filter) => {
    const qs = new URLSearchParams(clean(filter)).toString();
    const res = await fetch(`${BASE_URL}/summary?${qs}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "resolve_receipt",
  "Resolve a Base transaction hash OR a Solana transaction signature into a full receipt " +
    "($0.001 USDC): payer, payee, amount, asset, block time, network fee, every transfer. " +
    "The identifier's shape picks the chain — do not guess a network unless the user names one.",
  {
    transaction: z.string().describe("0x-prefixed 32-byte hash (Base) or base58 signature (Solana)"),
    network: z.enum(["base", "base-sepolia", "solana", "solana-devnet"]).optional(),
    resource: z.string().optional().describe("The URL this payment bought"),
    category: z.string().optional().describe("Accounting category, e.g. data, compute, booking"),
    label: z.string().optional().describe("Which agent/run this belongs to"),
  },
  async ({ transaction, ...rest }) => {
    const qs = new URLSearchParams(clean(rest)).toString();
    const res = await pay(`${BASE_URL}/receipt/${encodeURIComponent(transaction)}?${qs}`);
    const body = await res.text();
    const receiptHeader = res.headers.get("x-payment-response");
    return {
      content: [
        { type: "text", text: body },
        ...(receiptHeader
          ? [{ type: "text" as const, text: `paid: ${JSON.stringify(decodeXPaymentResponse(receiptHeader))}` }]
          : []),
      ],
      isError: !res.ok,
    };
  },
);

server.tool(
  "export_ledger",
  "The full receipt ledger as CSV and JSON in one response ($0.01 USDC), with per-rail and " +
    "per-merchant totals. Use the filters — exporting everything and summarising in context " +
    "wastes tokens on rows nobody asked about.",
  {
    rail: z.enum(["evm", "solana"]).optional(),
    merchant: z.string().optional(),
    category: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  },
  async (filter) => {
    const qs = new URLSearchParams(clean(filter)).toString();
    const res = await pay(`${BASE_URL}/export?${qs}`);
    const body = (await res.json()) as { export: { payload: { summary: unknown } }; csv: string };
    return {
      content: [
        { type: "text", text: JSON.stringify(body.export.payload.summary, null, 2) },
        { type: "text", text: body.csv },
      ],
      isError: !res.ok,
    };
  },
);

await server.connect(new StdioServerTransport());

function clean(o: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  );
}
```

## Claude Desktop config

```json
{
  "mcpServers": {
    "x402-receipts": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-receipts.ts"],
      "env": {
        "PRIVATE_KEY": "0xYourAgentWalletKey",
        "RECEIPTS_URL": "http://localhost:4033"
      }
    }
  }
}
```

## The loop worth automating

The real win isn't a model calling these by hand — it's wiring `resolve_receipt` into whatever already pays:

```ts
const res = await payFetch(url);
const settlement = decodeXPaymentResponse(res.headers.get("x-payment-response")!);
await pay(`${BASE_URL}/receipt/${settlement.transaction}?resource=${encodeURIComponent(url)}&label=${runId}`);
```

One extra call per purchase, and the ledger builds itself with context the chain never sees.

## Notes that matter in practice

- **Free tools stay free.** `spend_summary` hits an unpaid route; don't route it through `pay`.
- **Filter before exporting.** A model that exports twelve months and summarises in context burns tokens on rows nobody asked for. `since`/`until`/`merchant` exist for this.
- **Don't let the model invent a network.** Shape detection is more reliable than a guess. Only pass `network` when the user names one.
- **Cap the wallet.** The third argument to `wrapFetchWithPayment` is the per-call ceiling in atomic USDC.
- **Surface `status: "failed"`.** Failed transactions still cost gas and still belong in the books; a model that filters them out is hiding money.
