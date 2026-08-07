/**
 * x402-receipts — turn an x402 settlement id into an accounting record.
 *
 * An x402 payment leaves you holding a bare identifier: a Base transaction hash
 * or a Solana transaction signature. This package resolves either one against
 * public, keyless RPC, extracts the token movements, keeps a ledger, and exports
 * it as CSV or JSON.
 *
 * @example
 * ```ts
 * import { resolveTransaction, ReceiptLedger, toCsv } from "x402-receipts";
 *
 * const ledger = new ReceiptLedger({ file: "data/receipts.json" });
 *
 * // The identifier's shape decides the chain — no need to track which rail paid.
 * const receipt = await resolveTransaction("0x9f3c…");                 // Base
 * const solana  = await resolveTransaction("5Xy7…base58…");            // Solana
 *
 * ledger.record(receipt, { resource: "https://api.example.com/report", category: "data" });
 * ledger.record(solana,  { resource: "https://api.example.com/report", category: "data" });
 *
 * console.log(ledger.summary());   // { count, totalUsd, byRail, byMerchant, … }
 * console.log(toCsv(ledger.list()));
 * ```
 */

export {
  resolveTransaction,
  detectRail,
  KNOWN_ASSETS,
  TransactionNotFoundError,
  UnrecognizedIdentifierError,
  type ChainReceipt,
  type TokenTransfer,
  type Rail,
  type ResolveOptions,
} from "./chain.js";

export {
  ReceiptLedger,
  toCsv,
  CSV_COLUMNS,
  type ReceiptRecord,
  type ReceiptFilter,
  type ReceiptLedgerOptions,
  type RequestMetadata,
  type LedgerSummary,
} from "./ledger.js";

export {
  paywall,
  paymentReceipt,
  activeRails,
  routeMatches,
  usingSuiteDefaultPayTo,
  mountSolanaCheckout,
  DEFAULT_EVM_PAY_TO,
  DEFAULT_SOLANA_PAY_TO,
  type PaymentReceipt,
  type PaywallOptions,
  type RailInfo,
  type RoutePrices,
} from "./payments.js";

export { sign, verify, signed, canonicalize, type SignedRecord } from "./sign.js";
