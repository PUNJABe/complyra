import { describe, expect, it } from "vitest";
import { parseMoneyToPaise, formatMoney } from "@/lib/money";
import { parseDate, isWeekend, daysBetween } from "@/lib/dates";
import { validateGstin, gstinCheckChar } from "@/lib/gstin";

describe("parseMoneyToPaise", () => {
  it("handles Indian grouping, symbols and accounting negatives", () => {
    expect(parseMoneyToPaise("₹1,23,456.78")?.paise).toBe(12345678);
    expect(parseMoneyToPaise("Rs. 1,200")?.paise).toBe(120000);
    expect(parseMoneyToPaise("(1,200.00)")?.paise).toBe(-120000);
    expect(parseMoneyToPaise("-500")?.paise).toBe(-50000);
    expect(parseMoneyToPaise(499.99)?.paise).toBe(49999);
  });
  it("reads Dr/Cr markers", () => {
    expect(parseMoneyToPaise("1,500.00 Cr")).toEqual({ paise: 150000, marker: "cr" });
    expect(parseMoneyToPaise("250 DR")).toEqual({ paise: 25000, marker: "dr" });
  });
  it("rejects garbage instead of guessing", () => {
    expect(parseMoneyToPaise("abc")).toBeNull();
    expect(parseMoneyToPaise("")).toBeNull();
    expect(parseMoneyToPaise("12.3.4")).toBeNull();
  });
  it("avoids float drift on cents", () => {
    expect(parseMoneyToPaise("0.1")!.paise + parseMoneyToPaise("0.2")!.paise).toBe(30);
  });
  it("formats in lakh/crore grouping", () => {
    expect(formatMoney(12345678)).toBe("₹1,23,457");
  });
});

describe("parseDate", () => {
  it("reads DD/MM/YYYY by default (India), not US order", () => {
    expect(parseDate("03/04/2026")).toBe("2026-04-03");
    expect(parseDate("03/04/2026", { dayFirst: false })).toBe("2026-03-04");
  });
  it("disambiguates when one part cannot be a month", () => {
    expect(parseDate("13/04/2026")).toBe("2026-04-13");
    expect(parseDate("04/13/2026")).toBe("2026-04-13");
  });
  it("handles ISO, month names and 2-digit years", () => {
    expect(parseDate("2026-04-03")).toBe("2026-04-03");
    expect(parseDate("3-Apr-26")).toBe("2026-04-03");
    expect(parseDate("03 April 2026")).toBe("2026-04-03");
    expect(parseDate("Apr 3, 2026")).toBe("2026-04-03");
  });
  it("converts Excel serials and Date cells without timezone drift", () => {
    expect(parseDate(46115)).toBe("2026-04-03");
    expect(parseDate(new Date(Date.UTC(2026, 3, 3)))).toBe("2026-04-03");
  });
  it("returns null for impossible or unknown dates (never 'today')", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
  it("weekend and day arithmetic", () => {
    expect(isWeekend("2026-04-04")).toBe(true); // Saturday
    expect(isWeekend("2026-04-06")).toBe(false); // Monday
    expect(daysBetween("2026-04-01", "2026-04-04")).toBe(3);
  });
});

describe("validateGstin", () => {
  // A GSTIN built here with the official algorithm, then mutated.
  const base = "27AAPFU0939F1Z";
  const good = base + gstinCheckChar(base);
  it("accepts a well-formed GSTIN with correct check character", () => {
    expect(validateGstin(good)).toEqual({ valid: true });
    expect(validateGstin(good.toLowerCase())).toEqual({ valid: true });
  });
  it("accepts the widely published sample 27AAPFU0939F1ZV", () => {
    expect(validateGstin("27AAPFU0939F1ZV")).toEqual({ valid: true });
  });
  it("rejects a wrong check character and says what it should be", () => {
    const bad = base + (good[14] === "A" ? "B" : "A");
    const r = validateGstin(bad);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("check character");
  });
  it("rejects wrong length and bad state codes", () => {
    expect(validateGstin("27AAPFU0939F1Z").valid).toBe(false);
    const r = validateGstin("45AAPFU0939F1ZV");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("state code");
  });
});
