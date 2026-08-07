import "dotenv/config";
import express from "express";
import { readFileSync } from "node:fs";
import { activeRails, mountSolanaCheckout, paymentReceipt, paywall, usingSuiteDefaultPayTo } from "./payments.js";
import {
  resolveTransaction,
  TransactionNotFoundError,
  UnrecognizedIdentifierError,
  type ResolveOptions,
} from "./chain.js";
import { ReceiptLedger, toCsv, type ReceiptFilter, type RequestMetadata } from "./ledger.js";
import { signed, verify } from "./sign.js";
import { ROUTE_SCHEMAS } from "./schemas.js";

/**
 * x402-receipts — receipts and accounting for agent spending.
 *
 *   GET  /receipt/:tx    $0.001  → enriched, signed receipt for a Base tx hash
 *                                  OR a Solana transaction signature
 *   GET  /export         $0.01   → the full ledger as CSV *and* JSON, plus totals
 *   POST /annotate/:tx   free*   → attach resource/merchant/label metadata
 *   GET  /summary        free    → totals only, no rows
 *   POST /verify         free    → verify a signed receipt or export
 *
 * An x402 settlement gives an agent a bare transaction id. This turns that into
 * something an accountant will accept: who paid whom, how much, when, for what.
 */

const port = Number(process.env.PORT || 4033);
const adminKey = process.env.ADMIN_KEY || "dev-admin-key";

const ledger = new ReceiptLedger({ file: process.env.LEDGER_FILE || "data/receipts.json" });

const app = express();
app.use(express.json());

const PRICES: Record<string, string> = {
  "GET /receipt/:tx": "$0.001",
  "GET /export": "$0.01",
};

// `schemas` publishes each paid route's request/response contract inside the 402
// challenge (`accepts[].outputSchema`), so an agent that hits the paywall knows
// how to call the route and what it will get back without reading the OpenAPI
// document first. Generated from openapi.json — see src/schemas.ts.
app.use(paywall(PRICES, { service: "x402-receipts", schemas: ROUTE_SCHEMAS }));

/**
 * Resolve one transaction on either rail. The identifier's own shape decides
 * which chain to ask — a 0x-prefixed 32-byte hash is Base, a base58 signature
 * is Solana — so an agent can hand over whatever its x402 client reported
 * without tracking which rail it paid on.
 */
app.get("/receipt/:tx", async (req, res) => {
  const identifier = req.params.tx;
  const options: ResolveOptions = { network: asString(req.query.network) };
  const metadata: RequestMetadata = clean({
    resource: asString(req.query.resource),
    merchant: asString(req.query.merchant),
    label: asString(req.query.label),
    category: asString(req.query.category),
  });

  try {
    const chainReceipt = await resolveTransaction(identifier, options);
    const record = ledger.record(chainReceipt, metadata);
    res.json({
      receipt: signed(record),
      paidWith: paymentReceipt(res),
    });
  } catch (err) {
    if (err instanceof UnrecognizedIdentifierError) {
      res.status(400).json({ error: "UNRECOGNIZED_IDENTIFIER", message: err.message, hint: "Pass ?network=base|base-sepolia|solana|solana-devnet" });
      return;
    }
    if (err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "TRANSACTION_NOT_FOUND", message: err.message, transaction: err.transaction, network: err.network });
      return;
    }
    res.status(502).json({ error: "RPC_ERROR", message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * The full book, in both formats, in the response body. CSV because that is
 * what accounting software eats; JSON because that is what the next agent
 * eats. Shipping only one of them would mean paying twice.
 */
app.get("/export", (req, res) => {
  const filter: ReceiptFilter = clean({
    rail: asRail(req.query.rail),
    network: asString(req.query.network),
    payer: asString(req.query.payer),
    payee: asString(req.query.payee),
    merchant: asString(req.query.merchant),
    category: asString(req.query.category),
    since: asString(req.query.since),
    until: asString(req.query.until),
  });

  const records = ledger.list(filter);
  const summary = ledger.summary(filter);
  const exported = {
    generatedAt: new Date().toISOString(),
    filter,
    summary,
    columns: undefined as unknown,
    records,
  };
  delete exported.columns;

  res.json({
    export: signed(exported),
    csv: toCsv(records),
    digest: ledger.digest(filter),
    paidWith: paymentReceipt(res),
  });
});

/** Attach what the chain can't know: which resource this payment bought. */
app.post("/annotate/:tx", (req, res) => {
  if (req.header("X-Admin-Key") !== adminKey) {
    res.status(401).json({ error: "UNAUTHORIZED", hint: "Send X-Admin-Key header (ADMIN_KEY env)" });
    return;
  }
  const record = ledger.annotate(req.params.tx, (req.body ?? {}) as RequestMetadata);
  if (!record) {
    res.status(404).json({
      error: "RECEIPT_NOT_FOUND",
      hint: "Resolve the transaction first with GET /receipt/:tx",
      transaction: req.params.tx,
    });
    return;
  }
  res.json({ receipt: signed(record) });
});

/** Free: totals without the rows, so an agent can decide whether to buy the export. */
app.get("/summary", (req, res) => {
  const filter: ReceiptFilter = clean({
    rail: asRail(req.query.rail),
    merchant: asString(req.query.merchant),
    since: asString(req.query.since),
    until: asString(req.query.until),
  });
  res.json({ summary: ledger.summary(filter), filter });
});

app.post("/verify", (req, res) => {
  const { payload, signature } = (req.body ?? {}) as { payload?: unknown; signature?: string };
  if (payload === undefined || !signature) {
    res.status(400).json({ error: "BAD_REQUEST", hint: "POST { payload, signature }" });
    return;
  }
  res.json({ valid: verify(payload, signature) });
});

app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json").send(readFileSync("public/.well-known/x402", "utf8"));
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-receipts",
    rails: activeRails(),
    resolvers: {
      base: process.env.BASE_RPC_URL ?? "public Base RPC (viem default)",
      solana: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    },
    ledgerSize: ledger.list().length,
  });
});

app.use(express.static("public"));

await mountSolanaCheckout(app);

app.listen(port, () => {
  console.log(`\nx402-receipts on http://localhost:${port}`);
  console.log("\nPayment rails (client picks one):");
  for (const rail of activeRails()) {
    console.log(`  ${rail.rail.padEnd(7)} ${rail.network.padEnd(14)} USDC → ${rail.payTo}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log("  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself");
  }
  console.log("\nChain resolvers (keyless public RPC by default):");
  console.log(`  base    ${process.env.BASE_RPC_URL ?? "viem public endpoint"}`);
  console.log(`  solana  ${process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"}`);
  console.log(`\nLedger: ${process.env.LEDGER_FILE || "data/receipts.json"} (${ledger.list().length} receipts)`);
  console.log("\nPaid routes:");
  for (const [route, price] of Object.entries(PRICES)) console.log(`  ${route.padEnd(20)} ${price}`);
  console.log("\nFree routes:\n  POST /annotate/:tx (X-Admin-Key)\n  GET /summary\n  POST /verify\n  GET /.well-known/x402\n  GET /health\n");
});

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRail(value: unknown): "evm" | "solana" | undefined {
  return value === "evm" || value === "solana" ? value : undefined;
}

/** Drop undefined keys so filters and metadata stay clean in the signed output. */
function clean<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as T;
}
