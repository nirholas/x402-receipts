import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChainReceipt } from "./chain.js";
import { sign } from "./sign.js";

/**
 * ReceiptLedger — the accounting book.
 *
 * Two kinds of thing land here:
 *
 *  1. **Resolved receipts.** Every transaction this service looks up is cached
 *     and kept, so the ledger accumulates a spending history as a side effect
 *     of doing its job. Re-resolving the same hash is free and instant.
 *  2. **Annotations.** An agent knows things the chain does not: which resource
 *     it bought, under which run, on whose behalf. `annotate()` attaches that
 *     metadata to a transaction, which is what turns a transfer into a receipt
 *     you can put in front of an accountant.
 *
 * Storage is a JSON file written atomically. No database, by design — this is a
 * ledger for one agent or one fleet, not a data warehouse.
 */

/** What the agent knows that the chain doesn't. */
export interface RequestMetadata {
  /** The x402 resource that was purchased, e.g. `https://api.example.com/report`. */
  resource?: string;
  /** Merchant host. Derived from `resource` when omitted. */
  merchant?: string;
  /** Free-form label: which agent, which run, which task. */
  label?: string;
  /** Category for accounting, e.g. `data`, `compute`, `booking`. */
  category?: string;
  /** Anything else worth keeping. */
  [key: string]: unknown;
}

export interface ReceiptRecord {
  /** Base transaction hash or Solana transaction signature. */
  transaction: string;
  rail: "evm" | "solana";
  network: string;
  status: "success" | "failed";
  timestamp: string | null;
  /** Primary payment leg: the largest recognised token transfer. */
  payer: string | null;
  payee: string | null;
  amount: number | null;
  amountRaw: string | null;
  asset: string | null;
  symbol: string | null;
  feeNative: number | null;
  block: number | null;
  explorerUrl: string;
  /** Every transfer in the transaction, not just the primary leg. */
  transfers: ChainReceipt["transfers"];
  /** Agent-supplied context. */
  metadata: RequestMetadata;
  /** When this service first resolved it. */
  resolvedAt: string;
  /** When the metadata was last updated. */
  updatedAt: string;
}

export interface ReceiptLedgerOptions {
  /** JSON file used for persistence. Default: `data/receipts.json`. */
  file?: string;
  /** Disable persistence (in-memory only). */
  ephemeral?: boolean;
}

export class ReceiptLedger {
  private records = new Map<string, ReceiptRecord>();
  private readonly file: string;
  private readonly ephemeral: boolean;

  constructor(options: ReceiptLedgerOptions = {}) {
    this.file = options.file ?? "data/receipts.json";
    this.ephemeral = options.ephemeral ?? false;
    this.load();
  }

  /** Store (or refresh) a resolved transaction, keeping any existing metadata. */
  record(receipt: ChainReceipt, metadata: RequestMetadata = {}): ReceiptRecord {
    const existing = this.records.get(receipt.transaction);
    const primary = primaryTransfer(receipt);
    const now = new Date().toISOString();

    const record: ReceiptRecord = {
      transaction: receipt.transaction,
      rail: receipt.rail,
      network: receipt.network,
      status: receipt.status,
      timestamp: receipt.timestamp,
      payer: primary?.from ?? null,
      payee: primary?.to ?? null,
      amount: primary?.amount ?? null,
      amountRaw: primary?.amountRaw ?? null,
      asset: primary?.asset ?? null,
      symbol: primary?.symbol ?? null,
      feeNative: receipt.feeNative,
      block: receipt.block,
      explorerUrl: receipt.explorerUrl,
      transfers: receipt.transfers,
      metadata: { ...existing?.metadata, ...withMerchant(metadata) },
      resolvedAt: existing?.resolvedAt ?? now,
      updatedAt: now,
    };

    this.records.set(record.transaction, record);
    this.save();
    return record;
  }

  /** Attach or update agent-side context on an already-resolved transaction. */
  annotate(transaction: string, metadata: RequestMetadata): ReceiptRecord | undefined {
    const record = this.records.get(transaction);
    if (!record) return undefined;
    record.metadata = { ...record.metadata, ...withMerchant(metadata) };
    record.updatedAt = new Date().toISOString();
    this.save();
    return { ...record };
  }

  get(transaction: string): ReceiptRecord | undefined {
    const record = this.records.get(transaction);
    return record ? { ...record } : undefined;
  }

  /** Every record, newest first, optionally filtered. */
  list(filter: ReceiptFilter = {}): ReceiptRecord[] {
    return [...this.records.values()]
      .filter((r) => (filter.rail ? r.rail === filter.rail : true))
      .filter((r) => (filter.network ? r.network === filter.network : true))
      .filter((r) => (filter.payer ? eq(r.payer, filter.payer) : true))
      .filter((r) => (filter.payee ? eq(r.payee, filter.payee) : true))
      .filter((r) => (filter.merchant ? eq(r.metadata.merchant as string, filter.merchant) : true))
      .filter((r) => (filter.category ? r.metadata.category === filter.category : true))
      .filter((r) => (filter.since ? afterOrEqual(r.timestamp ?? r.resolvedAt, filter.since) : true))
      .filter((r) => (filter.until ? !afterOrEqual(r.timestamp ?? r.resolvedAt, filter.until) : true))
      .sort((a, b) => (b.timestamp ?? b.resolvedAt).localeCompare(a.timestamp ?? a.resolvedAt));
  }

  /** Totals for a filtered slice — what an expense report actually needs. */
  summary(filter: ReceiptFilter = {}): LedgerSummary {
    const records = this.list(filter);
    const byRail: Record<string, { count: number; totalUsd: number }> = {};
    const byMerchant: Record<string, { count: number; totalUsd: number }> = {};
    let totalUsd = 0;

    for (const record of records) {
      // USDC is dollar-denominated, so a USDC amount is a USD amount. Anything
      // else would need a price oracle, so it is counted but not summed.
      const usd = record.symbol === "USDC" && record.status === "success" ? (record.amount ?? 0) : 0;
      totalUsd += usd;

      const rail = (byRail[record.rail] ??= { count: 0, totalUsd: 0 });
      rail.count += 1;
      rail.totalUsd = round6(rail.totalUsd + usd);

      const merchantKey = (record.metadata.merchant as string) ?? record.payee ?? "unknown";
      const merchant = (byMerchant[merchantKey] ??= { count: 0, totalUsd: 0 });
      merchant.count += 1;
      merchant.totalUsd = round6(merchant.totalUsd + usd);
    }

    return {
      count: records.length,
      totalUsd: round6(totalUsd),
      failedCount: records.filter((r) => r.status === "failed").length,
      firstAt: records.at(-1)?.timestamp ?? null,
      lastAt: records[0]?.timestamp ?? null,
      byRail,
      byMerchant,
    };
  }

  /** HMAC over the whole ledger — tamper evidence for an exported book. */
  digest(filter: ReceiptFilter = {}): string {
    return sign(this.list(filter));
  }

  private load(): void {
    if (this.ephemeral || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as ReceiptRecord[];
      for (const record of raw) this.records.set(record.transaction, record);
    } catch {
      // Corrupt or empty file — start fresh rather than crash on boot.
    }
  }

  private save(): void {
    if (this.ephemeral) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.records.values()], null, 2));
    renameSync(tmp, this.file);
  }
}

export interface ReceiptFilter {
  rail?: "evm" | "solana";
  network?: string;
  payer?: string;
  payee?: string;
  merchant?: string;
  category?: string;
  /** ISO date or datetime, inclusive. */
  since?: string;
  /** ISO date or datetime, exclusive. */
  until?: string;
}

export interface LedgerSummary {
  count: number;
  totalUsd: number;
  failedCount: number;
  firstAt: string | null;
  lastAt: string | null;
  byRail: Record<string, { count: number; totalUsd: number }>;
  byMerchant: Record<string, { count: number; totalUsd: number }>;
}

/** The CSV column order used by `toCsv` — stable, so diffs stay readable. */
export const CSV_COLUMNS = [
  "timestamp",
  "transaction",
  "rail",
  "network",
  "status",
  "payer",
  "payee",
  "amount",
  "symbol",
  "asset",
  "feeNative",
  "block",
  "merchant",
  "resource",
  "category",
  "label",
  "explorerUrl",
] as const;

/** Render records as RFC 4180 CSV — the format every accounting tool imports. */
export function toCsv(records: ReceiptRecord[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    rows.push(
      CSV_COLUMNS.map((column) => csvCell(valueFor(record, column))).join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

function valueFor(record: ReceiptRecord, column: (typeof CSV_COLUMNS)[number]): unknown {
  switch (column) {
    case "merchant":
    case "resource":
    case "category":
    case "label":
      return record.metadata[column];
    default:
      return record[column as keyof ReceiptRecord];
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function primaryTransfer(receipt: ChainReceipt): ChainReceipt["transfers"][number] | undefined {
  if (receipt.transfers.length === 0) return undefined;
  // Prefer a recognised stablecoin leg; otherwise the largest movement.
  const known = receipt.transfers.filter((t) => t.symbol !== "UNKNOWN");
  const pool = known.length > 0 ? known : receipt.transfers;
  return pool.reduce((largest, t) => (t.amount > largest.amount ? t : largest), pool[0]);
}

function withMerchant(metadata: RequestMetadata): RequestMetadata {
  if (metadata.merchant || !metadata.resource) return metadata;
  try {
    return { ...metadata, merchant: new URL(metadata.resource).host };
  } catch {
    return metadata;
  }
}

function eq(a: string | undefined | null, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

function afterOrEqual(value: string, bound: string): boolean {
  return value >= bound;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
