import { daysBetween, isWeekend, monthOf } from "./dates";
import { validateGstin } from "./gstin";
import { formatMoney, formatMoneyExact, toPaise } from "./money";
import type { Severity, StoredRule } from "./rules";

export type EngineTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  merchantNorm: string;
  amountPaise: number;
  direction: "debit" | "credit";
  employee: string;
  department: string;
  category: string;
  invoiceNo: string;
  vendorGstin: string;
  reference: string;
};

export type Detection = {
  ruleId: string;
  ruleName: string;
  kind: string;
  severity: Severity;
  /** Stable within a rule: the same underlying issue keeps the same key across re-runs. */
  key: string;
  title: string;
  why: string;
  evidence: string;
  amountPaise: number;
  txnIds: string[];
};

export type Skipped = { ruleId: string; ruleName: string; reason: string };
export type EngineResult = { detections: Detection[]; skipped: Skipped[] };

type Ctx = { currency: string };
type Out = { detections: Detection[]; skipped?: string };

// ---------- helpers ----------

const byDateId = (a: EngineTxn, b: EngineTxn) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function makeMoney(ctx: Ctx) {
  return (p: number) => (p % 100 === 0 ? formatMoney(p, ctx.currency) : formatMoneyExact(p, ctx.currency));
}

const who = (t: EngineTxn) => t.employee || "an unassigned employee";
const describe = (t: EngineTxn) =>
  `${t.merchant} · ${t.date} · ${t.employee || "no employee"} · ${t.category}`;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

// ---------- evaluators ----------

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Evaluator = (rule: StoredRule, p: P, debits: EngineTxn[], all: EngineTxn[], m: (n: number) => string) => Out;

function base(rule: StoredRule, key: string, d: Pick<Detection, "title" | "why" | "evidence" | "amountPaise" | "txnIds">): Detection {
  return { ruleId: rule.id, ruleName: rule.name, kind: rule.kind, severity: rule.severity, key, ...d };
}

const amount_over: Evaluator = (rule, p, debits, _all, m) => {
  const limit = toPaise(p.threshold);
  const cats = (p.categories as string[]).map((c) => c.toLowerCase());
  const detections = debits
    .filter((t) => t.amountPaise > limit && (!cats.length || cats.includes(t.category.toLowerCase())))
    .map((t) =>
      base(rule, `t:${t.id}`, {
        title: `${m(t.amountPaise)} at ${t.merchant} is over the ${m(limit)} limit`,
        why: `${m(t.amountPaise)} is over the ${m(limit)} limit by ${m(t.amountPaise - limit)}.`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  return { detections };
};

const duplicate_payment: Evaluator = (rule, p, debits, _all, m) => {
  const window = p.windowDays as number;
  const groups = groupBy(
    debits.filter((t) => t.merchantNorm),
    (t) => `${t.merchantNorm}|${t.amountPaise}|${p.sameEmployee ? t.employee.toLowerCase() : ""}`,
  );
  const detections: Detection[] = [];
  const flush = (cluster: EngineTxn[]) => {
    if (cluster.length < 2) return;
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    const span = daysBetween(first.date, last.date);
    detections.push(
      base(rule, `d:${first.id}`, {
        title: `${cluster.length} identical payments to ${first.merchant}`,
        why: `${cluster.length} payments of ${m(first.amountPaise)} to ${first.merchant}${
          p.sameEmployee ? ` by ${who(first)}` : ""
        } within ${span === 0 ? "the same day" : `${span} day${span === 1 ? "" : "s"}`}. ${m(
          first.amountPaise * (cluster.length - 1),
        )} may be a repeat charge.`,
        evidence: cluster.map((t) => t.date).join(", "),
        amountPaise: first.amountPaise * (cluster.length - 1),
        txnIds: cluster.map((t) => t.id),
      }),
    );
  };
  for (const g of groups.values()) {
    let cur: EngineTxn[] = [g[0]];
    for (let i = 1; i < g.length; i++) {
      if (daysBetween(cur[cur.length - 1].date, g[i].date) <= window) cur.push(g[i]);
      else {
        flush(cur);
        cur = [g[i]];
      }
    }
    flush(cur);
  }
  return { detections };
};

const split_payment: Evaluator = (rule, p, debits, _all, m) => {
  const limit = toPaise(p.limit);
  const window = p.windowDays as number;
  const groups = groupBy(
    debits.filter((t) => t.merchantNorm && t.amountPaise < limit),
    (t) => `${t.employee.toLowerCase()}|${t.merchantNorm}`,
  );
  const detections: Detection[] = [];
  for (const g of groups.values()) {
    let i = 0;
    while (i < g.length) {
      const members: EngineTxn[] = [];
      let sum = 0;
      for (let k = i; k < g.length && daysBetween(g[i].date, g[k].date) <= window; k++) {
        members.push(g[k]);
        sum += g[k].amountPaise;
      }
      if (members.length >= 2 && sum >= limit) {
        const first = members[0];
        const span = daysBetween(first.date, members[members.length - 1].date);
        const over = span === 0 ? "on the same day" : `over ${span} day${span === 1 ? "" : "s"}`;
        detections.push(
          base(rule, `s:${first.id}`, {
            title: `${members.length} payments to ${first.merchant} add up to ${m(sum)}`,
            why: `${who(first)} made ${members.length} payments to ${first.merchant} ${over}. Each is under the ${m(limit)} limit but together they total ${m(sum)}.`,
            evidence: members.map((t) => `${t.date} ${m(t.amountPaise)}`).join("; "),
            amountPaise: sum,
            txnIds: members.map((t) => t.id),
          }),
        );
        i += members.length;
      } else {
        i += 1;
      }
    }
  }
  return { detections };
};

const monthly_limit: Evaluator = (rule, p, debits, _all, m) => {
  const limit = toPaise(p.limit);
  const scope = p.scope as "employee" | "department" | "category";
  const only = (p.category as string).trim().toLowerCase();
  const rows = debits.filter((t) => t[scope] && (!only || t.category.toLowerCase() === only));
  const groups = groupBy(rows, (t) => `${t[scope].toLowerCase()}|${monthOf(t.date)}`);
  const detections: Detection[] = [];
  for (const [k, g] of groups) {
    const sum = g.reduce((s, t) => s + t.amountPaise, 0);
    if (sum <= limit) continue;
    const name = g[0][scope];
    const month = monthOf(g[0].date);
    detections.push(
      base(rule, `m:${scope}:${k}`, {
        title: `${name} over monthly budget in ${month}`,
        why: `${name} spent ${m(sum)} in ${month} against a ${m(limit)} monthly ${scope} budget, over by ${m(sum - limit)}.`,
        evidence: `${g.length} payment${g.length === 1 ? "" : "s"} in the month`,
        amountPaise: sum - limit,
        txnIds: g.slice(0, 200).map((t) => t.id),
      }),
    );
  }
  return { detections };
};

const weekend_spend: Evaluator = (rule, p, debits, _all, m) => {
  const min = toPaise(p.minAmount);
  const cats = (p.categories as string[]).map((c) => c.toLowerCase());
  const detections = debits
    .filter((t) => isWeekend(t.date) && t.amountPaise >= min && (!cats.length || cats.includes(t.category.toLowerCase())))
    .map((t) => {
      const day = new Date(`${t.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
      return base(rule, `t:${t.id}`, {
        title: `Weekend expense at ${t.merchant}`,
        why: `${m(t.amountPaise)} was spent on a ${day} (${t.date}).`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      });
    });
  return { detections };
};

const blocked_keywords: Evaluator = (rule, p, debits, _all, m) => {
  const patterns = (p.keywords as string[]).map((k) => ({
    k,
    re: new RegExp(`(^|[^a-z0-9])${escapeRegex(k.toLowerCase())}([^a-z0-9]|$)`),
  }));
  const detections: Detection[] = [];
  for (const t of debits) {
    const text = `${t.merchant} ${t.category} ${t.reference}`.toLowerCase();
    const hit = patterns.find((x) => x.re.test(text));
    if (!hit) continue;
    detections.push(
      base(rule, `t:${t.id}`, {
        title: `Prohibited term "${hit.k}" at ${t.merchant}`,
        why: `${m(t.amountPaise)} to ${t.merchant} matches the prohibited term "${hit.k}".`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  }
  return { detections };
};

const round_amount: Evaluator = (rule, p, debits, _all, m) => {
  const min = toPaise(p.minAmount);
  const unit = Math.max(1, toPaise(p.multiple));
  const detections = debits
    .filter((t) => t.amountPaise >= min && t.amountPaise % unit === 0)
    .map((t) =>
      base(rule, `t:${t.id}`, {
        title: `Round-figure expense at ${t.merchant}`,
        why: `${m(t.amountPaise)} is an exact multiple of ${m(unit)}. Genuine invoices rarely land on round figures; check the bill.`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  return { detections };
};

const missing_invoice: Evaluator = (rule, p, debits, _all, m) => {
  if (!debits.some((t) => t.invoiceNo)) {
    return { detections: [], skipped: "No invoice numbers in the imported data. Add an invoice or bill number column to your statement to enable this rule." };
  }
  const min = toPaise(p.threshold);
  const detections = debits
    .filter((t) => t.amountPaise >= min && !t.invoiceNo)
    .map((t) =>
      base(rule, `t:${t.id}`, {
        title: `No invoice for ${m(t.amountPaise)} at ${t.merchant}`,
        why: `Expenses of ${m(min)} or more need an invoice number; none is recorded.`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  return { detections };
};

const invalid_gstin: Evaluator = (rule, _p, debits, _all, m) => {
  const withGstin = debits.filter((t) => t.vendorGstin);
  if (!withGstin.length) {
    return { detections: [], skipped: "No vendor GSTIN values in the imported data. Add a vendor GSTIN column to enable this rule." };
  }
  const detections: Detection[] = [];
  for (const t of withGstin) {
    const r = validateGstin(t.vendorGstin);
    if (r.valid) continue;
    detections.push(
      base(rule, `t:${t.id}`, {
        title: `Invalid GSTIN for ${t.merchant}`,
        why: `GSTIN ${t.vendorGstin} ${r.reason}. Input tax credit on ${m(t.amountPaise)} may be at risk.`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  }
  return { detections };
};

const outlier: Evaluator = (rule, p, debits, _all, m) => {
  const minSamples = p.minSamples as number;
  const threshold = p.threshold as number;
  const min = toPaise(p.minAmount);
  const groups = groupBy(
    debits.filter((t) => !["uncategorised", "bank transfer"].includes(t.category.toLowerCase())),
    (t) => t.category.toLowerCase(),
  );
  const detections: Detection[] = [];
  let evaluated = 0;
  for (const g of groups.values()) {
    if (g.length < minSamples) continue;
    evaluated++;
    const values = g.map((t) => t.amountPaise);
    const med = median(values);
    const mad = median(values.map((v) => Math.abs(v - med)));
    const meanAd = values.reduce((s, v) => s + Math.abs(v - med), 0) / values.length;
    for (const t of g) {
      if (t.amountPaise < min || t.amountPaise <= med) continue;
      const z = mad > 0 ? (0.6745 * (t.amountPaise - med)) / mad : meanAd > 0 ? (t.amountPaise - med) / (1.253314 * meanAd) : 0;
      if (z <= threshold) continue;
      const times = med > 0 ? t.amountPaise / med : 0;
      detections.push(
        base(rule, `o:${t.id}`, {
          title: `Unusually large ${t.category} expense`,
          why: `${m(t.amountPaise)} at ${t.merchant} is ${times.toFixed(1)}× the typical ${m(Math.round(med))} for ${t.category}, based on ${g.length} payments.`,
          evidence: `${describe(t)} · robust score ${z.toFixed(1)} (flagged above ${threshold})`,
          amountPaise: t.amountPaise,
          txnIds: [t.id],
        }),
      );
    }
  }
  if (!evaluated) {
    return { detections: [], skipped: `No category has ${minSamples} or more payments yet, so there is no reliable baseline.` };
  }
  return { detections };
};

const missing_fields: Evaluator = (rule, p, debits, _all, m) => {
  const wanted = p.fields as Array<"employee" | "department" | "category">;
  const present = (t: EngineTxn, f: "employee" | "department" | "category") =>
    f === "category" ? t.category !== "Uncategorised" : Boolean(t[f]);
  const active = wanted.filter((f) => debits.some((t) => present(t, f)));
  if (!active.length) {
    return { detections: [], skipped: `None of ${wanted.join(", ")} appear anywhere in the imported data, so every row would be flagged. Add those columns to enable this rule.` };
  }
  const min = toPaise(p.minAmount);
  const detections: Detection[] = [];
  for (const t of debits) {
    if (t.amountPaise < min) continue;
    const missing = active.filter((f) => !present(t, f));
    if (!missing.length) continue;
    detections.push(
      base(rule, `t:${t.id}`, {
        title: `No ${missing.join(" or ")} on ${t.merchant} expense`,
        why: `${m(t.amountPaise)} has no ${missing.join(" or ")} recorded, so nobody is accountable for it.`,
        evidence: describe(t),
        amountPaise: t.amountPaise,
        txnIds: [t.id],
      }),
    );
  }
  return { detections };
};

const EVALUATORS: Record<string, Evaluator> = {
  amount_over, duplicate_payment, split_payment, monthly_limit, weekend_spend,
  blocked_keywords, round_amount, missing_invoice, invalid_gstin, outlier, missing_fields,
};

// ---------- entry point ----------

export function evaluate(rules: StoredRule[], txns: EngineTxn[], ctx: Ctx = { currency: "INR" }): EngineResult {
  const debits = txns.filter((t) => t.direction === "debit").sort(byDateId);
  const m = makeMoney(ctx);
  const detections: Detection[] = [];
  const skipped: Skipped[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const fn = EVALUATORS[rule.kind];
    if (!fn) {
      skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: `Unknown rule type "${rule.kind}".` });
      continue;
    }
    try {
      const out = fn(rule, rule.params as P, debits, txns, m);
      detections.push(...out.detections);
      if (out.skipped) skipped.push({ ruleId: rule.id, ruleName: rule.name, reason: out.skipped });
    } catch (err) {
      skipped.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: `Rule failed to run: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }
  return { detections, skipped };
}
