import { z } from "zod";

/**
 * Rules are structured data, not free text, so the engine can actually run them.
 * Money parameters are in major units (rupees) because that is what people type.
 */

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

const money = z.number().positive().max(1_000_000_000);
const names = z.array(z.string().trim().min(1).max(60)).max(100);

const base = {
  name: z.string().trim().min(2, "Name is too short").max(80),
  severity: z.enum(SEVERITIES),
  enabled: z.boolean().default(true),
};

function rule<K extends string, P extends z.ZodType>(kind: K, params: P) {
  return z.object({ ...base, kind: z.literal(kind), params });
}

export const ruleInputSchema = z.discriminatedUnion("kind", [
  rule("amount_over", z.object({ threshold: money, categories: names.default([]) })),
  rule(
    "monthly_limit",
    z.object({
      limit: money,
      scope: z.enum(["employee", "department", "category"]),
      category: z.string().trim().max(60).default(""),
    }),
  ),
  rule(
    "duplicate_payment",
    z.object({ windowDays: z.number().int().min(0).max(90), sameEmployee: z.boolean().default(true) }),
  ),
  rule("split_payment", z.object({ limit: money, windowDays: z.number().int().min(0).max(30) })),
  rule("weekend_spend", z.object({ minAmount: z.number().min(0).default(0), categories: names.default([]) })),
  rule("blocked_keywords", z.object({ keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(100) })),
  rule("round_amount", z.object({ minAmount: money, multiple: money })),
  rule("missing_invoice", z.object({ threshold: money })),
  rule("invalid_gstin", z.object({})),
  rule(
    "outlier",
    z.object({
      minSamples: z.number().int().min(5).max(1000).default(8),
      threshold: z.number().min(2).max(20).default(3.5),
      minAmount: z.number().min(0).default(1000),
    }),
  ),
  rule(
    "missing_fields",
    z.object({
      fields: z.array(z.enum(["employee", "department", "category"])).min(1),
      minAmount: z.number().min(0).default(0),
    }),
  ),
]);

export type RuleInput = z.infer<typeof ruleInputSchema>;
export type RuleKind = RuleInput["kind"];

export type StoredRule = {
  id: string;
  name: string;
  kind: RuleKind;
  severity: Severity;
  enabled: boolean;
  params: Record<string, unknown>;
};

export type FieldDef = {
  key: string;
  label: string;
  type: "money" | "number" | "text" | "list" | "select" | "bool";
  options?: { value: string; label: string }[];
  help?: string;
};

export type KindMeta = {
  kind: RuleKind;
  label: string;
  description: string;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
};

export const KIND_META: Record<RuleKind, KindMeta> = {
  amount_over: {
    kind: "amount_over",
    label: "Amount above limit",
    description: "Flags a single expense above an approval limit.",
    fields: [
      { key: "threshold", label: "Limit", type: "money" },
      { key: "categories", label: "Only these categories", type: "list", help: "Leave empty to apply to every category." },
    ],
    defaults: { threshold: 50000, categories: [] },
  },
  monthly_limit: {
    kind: "monthly_limit",
    label: "Monthly budget exceeded",
    description: "Flags when an employee, department or category spends more than a monthly budget.",
    fields: [
      { key: "limit", label: "Monthly limit", type: "money" },
      {
        key: "scope",
        label: "Measured per",
        type: "select",
        options: [
          { value: "employee", label: "Employee" },
          { value: "department", label: "Department" },
          { value: "category", label: "Category" },
        ],
      },
      { key: "category", label: "Only count this category", type: "text", help: "Optional." },
    ],
    defaults: { limit: 100000, scope: "employee", category: "" },
  },
  duplicate_payment: {
    kind: "duplicate_payment",
    label: "Possible duplicate payment",
    description: "Same merchant and amount paid more than once within a few days.",
    fields: [
      { key: "windowDays", label: "Within (days)", type: "number" },
      { key: "sameEmployee", label: "Same employee only", type: "bool" },
    ],
    defaults: { windowDays: 7, sameEmployee: true },
  },
  split_payment: {
    kind: "split_payment",
    label: "Split to avoid approval",
    description: "Several payments to one merchant by one person that each sit under the limit but together exceed it.",
    fields: [
      { key: "limit", label: "Approval limit", type: "money" },
      { key: "windowDays", label: "Within (days)", type: "number" },
    ],
    defaults: { limit: 50000, windowDays: 3 },
  },
  weekend_spend: {
    kind: "weekend_spend",
    label: "Weekend spend",
    description: "Expenses dated on a Saturday or Sunday.",
    fields: [
      { key: "minAmount", label: "Only above", type: "money" },
      { key: "categories", label: "Only these categories", type: "list", help: "Leave empty for all." },
    ],
    defaults: { minAmount: 10000, categories: [] },
  },
  blocked_keywords: {
    kind: "blocked_keywords",
    label: "Prohibited merchant or category",
    description: "Flags merchants, categories or references containing prohibited words.",
    fields: [{ key: "keywords", label: "Prohibited words", type: "list" }],
    defaults: { keywords: ["casino", "betting", "poker", "rummy", "liquor", "whisky"] },
  },
  round_amount: {
    kind: "round_amount",
    label: "Suspiciously round amount",
    description: "Large expenses that are an exact multiple of a round figure. A weak signal; review, don't assume.",
    fields: [
      { key: "minAmount", label: "Only above", type: "money" },
      { key: "multiple", label: "Exact multiple of", type: "money" },
    ],
    defaults: { minAmount: 10000, multiple: 5000 },
  },
  missing_invoice: {
    kind: "missing_invoice",
    label: "Invoice number missing",
    description: "Expenses above a threshold with no invoice or bill number on record.",
    fields: [{ key: "threshold", label: "Required above", type: "money" }],
    defaults: { threshold: 5000 },
  },
  invalid_gstin: {
    kind: "invalid_gstin",
    label: "Invalid vendor GSTIN",
    description: "Vendor GSTIN is malformed or fails the official check-character test.",
    fields: [],
    defaults: {},
  },
  outlier: {
    kind: "outlier",
    label: "Unusual amount for category",
    description: "Expense far above what is typical for its category (robust statistics, not a fixed limit).",
    fields: [
      { key: "minSamples", label: "Minimum payments in category", type: "number" },
      { key: "threshold", label: "Sensitivity (lower is stricter)", type: "number" },
      { key: "minAmount", label: "Only above", type: "money" },
    ],
    defaults: { minSamples: 8, threshold: 3.5, minAmount: 1000 },
  },
  missing_fields: {
    kind: "missing_fields",
    label: "Unattributed spend",
    description: "Expenses with no employee, department or category assigned.",
    fields: [
      {
        key: "fields",
        label: "Required fields",
        type: "list",
        help: "Any of: employee, department, category.",
      },
      { key: "minAmount", label: "Only above", type: "money" },
    ],
    defaults: { fields: ["employee", "department"], minAmount: 1000 },
  },
};

export const DEFAULT_RULES: RuleInput[] = [
  { name: "High-value expense", kind: "amount_over", severity: "high", enabled: true, params: { threshold: 50000, categories: [] } },
  { name: "Possible duplicate payment", kind: "duplicate_payment", severity: "medium", enabled: true, params: { windowDays: 7, sameEmployee: true } },
  { name: "Split to avoid approval limit", kind: "split_payment", severity: "high", enabled: true, params: { limit: 50000, windowDays: 3 } },
  { name: "Invoice required above ₹5,000", kind: "missing_invoice", severity: "medium", enabled: true, params: { threshold: 5000 } },
  { name: "Vendor GSTIN must be valid", kind: "invalid_gstin", severity: "high", enabled: true, params: {} },
  { name: "Prohibited merchants", kind: "blocked_keywords", severity: "high", enabled: true, params: { keywords: ["casino", "betting", "poker", "rummy", "liquor", "whisky", "nightclub"] } },
  { name: "Weekend spend over ₹10,000", kind: "weekend_spend", severity: "low", enabled: true, params: { minAmount: 10000, categories: [] } },
  { name: "Unusual amount for category", kind: "outlier", severity: "medium", enabled: true, params: { minSamples: 8, threshold: 3.5, minAmount: 1000 } },
  { name: "Round-figure expenses", kind: "round_amount", severity: "low", enabled: true, params: { minAmount: 10000, multiple: 5000 } },
  { name: "Employee monthly budget", kind: "monthly_limit", severity: "medium", enabled: true, params: { limit: 100000, scope: "employee", category: "" } },
  { name: "Spend without owner", kind: "missing_fields", severity: "low", enabled: true, params: { fields: ["employee", "department"], minAmount: 1000 } },
];
