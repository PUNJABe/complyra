import { z } from "zod";
import { validateGstin } from "./gstin";

export const clientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  gstin: z.string().trim().max(20).default(""),
  pan: z.string().trim().max(10).default(""),
  sector: z.string().trim().max(60).default(""),
});

/** Returns an error message, or null when the identifiers are fine. */
export function clientIdProblem(gstin: string, pan: string): string | null {
  if (gstin) {
    const r = validateGstin(gstin);
    if (!r.valid) return `GSTIN ${r.reason}.`;
  }
  if (pan && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(pan)) return "PAN should look like ABCDE1234F.";
  return null;
}
