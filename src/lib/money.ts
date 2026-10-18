/**
 * Money is stored and transported as integer paise (1 INR = 100 paise).
 * Floats are only used at the edges (parsing user input, formatting for display).
 */

export function toPaise(major: number): number {
  return Math.round(major * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

const fmtCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean) {
  const key = `${currency}|${compact}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: compact ? 1 : 0,
      ...(compact ? { notation: "compact" as const } : {}),
    });
    fmtCache.set(key, f);
  }
  return f;
}

/** ₹1,23,456 (no decimals; whole-rupee display for dashboards). */
export function formatMoney(paise: number, currency = "INR"): string {
  return formatter(currency, false).format(paise / 100);
}

/** ₹1.2L / ₹3.4Cr for tight spaces such as chart axes. */
export function formatMoneyCompact(paise: number, currency = "INR"): string {
  return formatter(currency, true).format(paise / 100);
}

/** Exact amount with paise, for tables and evidence text. */
export function formatMoneyExact(paise: number, currency = "INR"): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

/**
 * Parse a human-entered or exported money string into integer paise.
 * Handles: ₹ / Rs. / INR / $ prefixes, thousands separators (1,23,456.78),
 * accounting negatives "(1,200.00)", and trailing Dr/Cr markers.
 * Returns null when the value is not a recognisable amount.
 */
export function parseMoneyToPaise(
  value: unknown,
): { paise: number; marker?: "dr" | "cr" } | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { paise: Math.round(value * 100) };
  }
  if (typeof value !== "string") return null;

  let s = value.trim();
  if (!s) return null;

  let marker: "dr" | "cr" | undefined;
  const tail = s.match(/\s*(dr|cr)\.?$/i);
  if (tail) {
    marker = tail[1].toLowerCase() as "dr" | "cr";
    s = s.slice(0, tail.index).trim();
  }

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  s = s.replace(/^(rs\.?|inr|₹|\$|usd)\s*/i, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const paise = Math.round(n * 100);
  return { paise: negative ? -paise : paise, marker };
}
