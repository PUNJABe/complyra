import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseStatement } from "@/server/parser";

const samplePath = "d:\\Downloads\\statement hdfc.pdf";

describe("bank PDF statements", () => {
  it.skipIf(!fs.existsSync(samplePath))("reads the supplied HDFC multi-line statement", async () => {
    const result = await parseStatement(
      fs.readFileSync(samplePath),
      "statement hdfc.pdf",
      { dayFirst: true, negativeIsDebit: true },
    );
    expect(result.rows.length).toBeGreaterThan(100);
    expect(result.rows.every((row) => row.amountPaise > 0)).toBe(true);
    expect(result.rows.some((row) => row.direction === "credit")).toBe(true);
    expect(result.mapping).toMatchObject({
      date: "Date",
      merchant: "Narration",
      debit: "Withdrawal Amt.",
      credit: "Deposit Amt.",
    });
  });
});