/**
 * GSTIN validation: structure + the official mod-36 check character.
 * Format: 2-digit state code, 10-char PAN, entity number, 'Z', check character.
 * This validates that a number is *well-formed*; it cannot tell whether the
 * registration is active — that needs the GST portal.
 */

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const val = CHARS.indexOf(first14[i]);
    const product = val * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normaliseGstin(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export type GstinResult = { valid: true } | { valid: false; reason: string };

export function validateGstin(raw: string): GstinResult {
  const g = normaliseGstin(raw);
  if (g.length !== 15) {
    return { valid: false, reason: `has ${g.length} characters, a GSTIN has 15` };
  }
  if (!FORMAT.test(g)) {
    const state = g.slice(0, 2);
    if (!/^(0[1-9]|[12][0-9]|3[0-8]|97|99)$/.test(state)) {
      return { valid: false, reason: `state code ${state} is not a valid GST state code` };
    }
    return { valid: false, reason: "does not follow the GSTIN layout (2 digits, 5 letters, 4 digits, letter, entity, Z, check)" };
  }
  const expected = gstinCheckChar(g.slice(0, 14));
  if (expected !== g[14]) {
    return { valid: false, reason: `check character is ${g[14]} but should be ${expected}` };
  }
  return { valid: true };
}
