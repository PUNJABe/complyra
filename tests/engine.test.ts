import { describe, expect, it } from "vitest";
import { evaluate, type EngineTxn } from "@/lib/engine";
import { gstinCheckChar } from "@/lib/gstin";
import { normaliseMerchant, inferCategory } from "@/lib/merchant";
import type { StoredRule } from "@/lib/rules";

let n = 0;
function tx(p: Partial<EngineTxn> & { amount: number }): EngineTxn {
  const { amount, ...rest } = p;
  n += 1;
  const merchant = rest.merchant ?? "Acme Traders";
  return {
    id: `t${String(n).padStart(3, "0")}`,
    date: "2026-04-01",
    merchant,
    merchantNorm: normaliseMerchant(merchant),
    amountPaise: Math.round(amount * 100),
    direction: "debit",
    employee: "Asha",
    department: "Ops",
    category: "Office & Supplies",
    invoiceNo: "INV-1",
    vendorGstin: "",
    reference: "",
    ...rest,
  };
}
const rule = (kind: StoredRule["kind"], params: Record<string, unknown>, extra: Partial<StoredRule> = {}): StoredRule => ({
  id: `r-${kind}`, name: kind, kind, severity: "medium", enabled: true, params, ...extra,
});
const run = (r: StoredRule, t: EngineTxn[]) => evaluate([r], t);

describe("merchant normalisation & categorisation", () => {
  it("strips bank rails and reference numbers", () => {
    expect(normaliseMerchant("UPI-SWIGGY-9876543210@ybl")).toBe("swiggy");
    expect(normaliseMerchant("POS 4412 STARBUCKS COFFEE")).toBe("4412 starbucks coffee");
  });
  it("matches whole words only (no 'ola' in 'Coca-Cola', no 'gas' in 'Vegas')", () => {
    expect(inferCategory(normaliseMerchant("Coca-Cola Distributors"))).not.toBe("Travel");
    expect(inferCategory(normaliseMerchant("Vegas Souvenirs"))).not.toBe("Fuel");
    expect(inferCategory(normaliseMerchant("Ola Cabs"))).toBe("Travel");
    expect(inferCategory(normaliseMerchant("Indian Oil Corp"))).toBe("Fuel");
    expect(inferCategory(normaliseMerchant("Random Vendor"))).toBe("Uncategorised");
  });
});

describe("amount_over", () => {
  it("flags only expenses strictly above the limit", () => {
    const r = run(rule("amount_over", { threshold: 50000, categories: [] }), [tx({ amount: 50000 }), tx({ amount: 50001 }), tx({ amount: 100 })]);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].why).toContain("₹50,001");
  });
  it("ignores credits (refunds are not spend)", () => {
    const r = run(rule("amount_over", { threshold: 100, categories: [] }), [tx({ amount: 9999, direction: "credit" })]);
    expect(r.detections).toHaveLength(0);
  });
});

describe("duplicate_payment", () => {
  it("groups repeats within the window and counts only the extra payments as at-risk", () => {
    const a = tx({ amount: 1200, merchant: "Swiggy", date: "2026-04-01" });
    const b = tx({ amount: 1200, merchant: "Swiggy", date: "2026-04-03" });
    const far = tx({ amount: 1200, merchant: "Swiggy", date: "2026-04-20" });
    const r = run(rule("duplicate_payment", { windowDays: 7, sameEmployee: true }), [a, b, far]);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].txnIds).toEqual([a.id, b.id]);
    expect(r.detections[0].amountPaise).toBe(120000);
  });
  it("does not mix employees when sameEmployee is on", () => {
    const r = run(rule("duplicate_payment", { windowDays: 7, sameEmployee: true }), [
      tx({ amount: 500, merchant: "Uber", employee: "Asha" }),
      tx({ amount: 500, merchant: "Uber", employee: "Ravi" }),
    ]);
    expect(r.detections).toHaveLength(0);
  });
  it("keeps a stable key when a third duplicate arrives (reviews survive re-runs)", () => {
    const a = tx({ amount: 300, merchant: "Uber", date: "2026-04-01" });
    const b = tx({ amount: 300, merchant: "Uber", date: "2026-04-02" });
    const c = tx({ amount: 300, merchant: "Uber", date: "2026-04-03" });
    const k2 = run(rule("duplicate_payment", { windowDays: 7, sameEmployee: true }), [a, b]).detections[0].key;
    const k3 = run(rule("duplicate_payment", { windowDays: 7, sameEmployee: true }), [a, b, c]).detections[0].key;
    expect(k3).toBe(k2);
  });
});

describe("split_payment", () => {
  it("catches several sub-limit payments that together exceed the limit", () => {
    const parts = [30000, 25000, 20000].map((amount, i) => tx({ amount, merchant: "Zenith Events", date: `2026-04-0${i + 1}` }));
    const r = run(rule("split_payment", { limit: 50000, windowDays: 3 }), parts);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].amountPaise).toBe(7500000);
  });
  it("ignores spread-out payments and small totals", () => {
    const r = run(rule("split_payment", { limit: 50000, windowDays: 3 }), [
      tx({ amount: 30000, merchant: "Zenith", date: "2026-04-01" }),
      tx({ amount: 30000, merchant: "Zenith", date: "2026-04-20" }),
      tx({ amount: 1000, merchant: "Other", date: "2026-04-01" }),
      tx({ amount: 1000, merchant: "Other", date: "2026-04-01" }),
    ]);
    expect(r.detections).toHaveLength(0);
  });
});

describe("monthly_limit", () => {
  it("flags the excess per employee per month", () => {
    const rows = [60000, 50000].map((amount) => tx({ amount, employee: "Ravi", date: "2026-05-10" }));
    rows.push(tx({ amount: 90000, employee: "Ravi", date: "2026-06-02" }));
    const r = run(rule("monthly_limit", { limit: 100000, scope: "employee", category: "" }), rows);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].amountPaise).toBe(1000000); // 110k - 100k
  });
});

describe("weekend_spend / blocked / round", () => {
  it("weekend", () => {
    const r = run(rule("weekend_spend", { minAmount: 1000, categories: [] }), [tx({ amount: 5000, date: "2026-04-04" }), tx({ amount: 5000, date: "2026-04-06" })]);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].why).toContain("Saturday");
  });
  it("blocked keywords match whole words and name the term", () => {
    const r = run(rule("blocked_keywords", { keywords: ["casino", "bar"] }), [
      tx({ amount: 900, merchant: "Royal Casino Goa" }),
      tx({ amount: 900, merchant: "Barbeque Nation" }), // "bar" must not match inside a word
    ]);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].title).toContain("casino");
  });
  it("round amounts", () => {
    const r = run(rule("round_amount", { minAmount: 10000, multiple: 5000 }), [tx({ amount: 20000 }), tx({ amount: 20001 }), tx({ amount: 5000 })]);
    expect(r.detections).toHaveLength(1);
  });
});

describe("missing_invoice / invalid_gstin / missing_fields — honest about missing data", () => {
  it("missing_invoice is skipped (not noisy) when the file has no invoice data at all", () => {
    const r = run(rule("missing_invoice", { threshold: 1000 }), [tx({ amount: 5000, invoiceNo: "" }), tx({ amount: 7000, invoiceNo: "" })]);
    expect(r.detections).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/invoice/i);
  });
  it("missing_invoice flags gaps once invoice data exists", () => {
    const r = run(rule("missing_invoice", { threshold: 1000 }), [tx({ amount: 5000, invoiceNo: "A1" }), tx({ amount: 7000, invoiceNo: "" })]);
    expect(r.detections).toHaveLength(1);
  });
  it("invalid_gstin uses the real checksum", () => {
    const base = "27AAPFU0939F1Z";
    const good = base + gstinCheckChar(base);
    const bad = base + (good[14] === "A" ? "B" : "A");
    const r = run(rule("invalid_gstin", {}), [tx({ amount: 100, vendorGstin: good }), tx({ amount: 100, vendorGstin: bad }), tx({ amount: 100, vendorGstin: "" })]);
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].why).toContain("check character");
  });
  it("invalid_gstin skipped when no GSTIN data", () => {
    const r = run(rule("invalid_gstin", {}), [tx({ amount: 100 })]);
    expect(r.skipped).toHaveLength(1);
  });
  it("missing_fields only judges columns that exist in the data", () => {
    const r = run(rule("missing_fields", { fields: ["employee", "department"], minAmount: 0 }), [
      tx({ amount: 100, employee: "Asha", department: "" }),
      tx({ amount: 100, employee: "", department: "" }),
    ]);
    // department is empty everywhere → not judged; employee is judged
    expect(r.detections).toHaveLength(1);
    expect(r.detections[0].title).toContain("employee");
  });
});

describe("outlier", () => {
  const baseline = Array.from({ length: 12 }, (_, i) => tx({ amount: 900 + i * 20, category: "Food & Dining", merchant: `Cafe ${i}` }));
  it("flags a payment far above the category's typical amount and explains the baseline", () => {
    const big = tx({ amount: 15000, category: "Food & Dining", merchant: "Fancy Dinner" });
    const r = run(rule("outlier", { minSamples: 8, threshold: 3.5, minAmount: 1000 }), [...baseline, big]);
    expect(r.detections.map((d) => d.txnIds[0])).toEqual([big.id]);
    expect(r.detections[0].why).toMatch(/× the typical/);
  });
  it("stays quiet when spend is uniform and when samples are too few", () => {
    expect(run(rule("outlier", { minSamples: 8, threshold: 3.5, minAmount: 1000 }), baseline).detections).toHaveLength(0);
    const few = run(rule("outlier", { minSamples: 8, threshold: 3.5, minAmount: 1000 }), baseline.slice(0, 3));
    expect(few.skipped).toHaveLength(1);
  });
});

describe("engine isolation", () => {
  it("one failing rule does not stop the others, and disabled rules do not run", () => {
    const broken = rule("blocked_keywords", { keywords: null as unknown as string[] }, { id: "broken" });
    const ok = rule("amount_over", { threshold: 1, categories: [] }, { id: "ok" });
    const off = rule("amount_over", { threshold: 1, categories: [] }, { id: "off", enabled: false });
    const r = evaluate([broken, ok, off], [tx({ amount: 500 })]);
    expect(r.detections.map((d) => d.ruleId)).toEqual(["ok"]);
    expect(r.skipped.map((s) => s.ruleId)).toEqual(["broken"]);
  });
});
