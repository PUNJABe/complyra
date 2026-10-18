// Generates sample-data/expenses-q2-fy27.csv — a realistic corporate-card statement with known violations planted.
// Run: node scripts/make-sample.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(prefix14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(prefix14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return prefix14 + CHARS[(36 - (sum % 36)) % 36];
}
const G = {
  zenith: gstin("27AABCZ4821K1Z"), apex: gstin("29AAFCA7712M1Z"), skyline: gstin("07AAGCS1034P1Z"),
  prime: gstin("33AAHCP9921Q1Z"), mercure: gstin("27AACCG5510R1Z"), stationery: gstin("29AAICS3321N1Z"),
};
const BAD_SKYLINE = G.skyline.slice(0, 14) + (G.skyline[14] === "A" ? "B" : "A"); // wrong check character

let seed = 20260930;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (lo, hi) => Math.round(lo + rand() * (hi - lo));

const people = [
  ["Asha Verma", "Marketing"], ["Ravi Kumar", "Sales"], ["Meera Nair", "Operations"],
  ["Karan Singh", "Finance"], ["Priya Sharma", "Product"],
];
const dd = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const rows = [];
let inv = 1000;
const add = (date, merchant, amount, who, opts = {}) => {
  const [emp, dept] = who ?? ["", ""];
  rows.push({ d: date, merchant, amount, emp: opts.noOwner ? "" : emp, dept: opts.noOwner ? "" : dept,
    cat: opts.cat ?? "", inv: opts.noInvoice || amount < 1500 ? "" : `INV-${inv++}`, gstin: opts.gstin ?? "", ref: opts.ref ?? "" });
};
const day = (m, d) => new Date(Date.UTC(2026, m - 1, d));

// ---- routine spend: July–September 2026, weekdays only ----
const routine = [
  ["Swiggy", [280, 1400]], ["Zomato", [250, 1200]], ["Starbucks Coffee", [300, 900]], ["Ola Cabs", [180, 1100]],
  ["Uber India", [200, 1500]], ["Indian Oil Fuel Station", [1800, 4200]], ["Amazon Business", [900, 6500]],
  ["Staples Stationery", [600, 3800]], ["Airtel Broadband", [1499, 2499]], ["Zoom Subscription", [1300, 1800]],
];
for (let i = 0; i < 118; i++) {
  let dt;
  do { dt = day(between(7, 9), between(1, 28)); } while ([0, 6].includes(dt.getUTCDay()));
  const [m, [lo, hi]] = pick(routine);
  add(dt, m, between(lo, hi) + (rand() < 0.5 ? 0 : 0.5), pick(people), m.startsWith("Staples") ? { gstin: G.stationery } : {});
}
// Make a few routine rows unattributed (no employee / department)
for (let i = 0; i < 4; i++) add(day(8, 5 + i * 3), pick(["Amazon Business", "Staples Stationery"]), between(1800, 3200), null, { noOwner: true });

// ---- planted violations ----
const R = people[1], A = people[0], M = people[2], K = people[3];
add(day(7, 7), "Swiggy", 1240, A, { ref: "Team lunch" });            // duplicate payment
add(day(7, 9), "Swiggy", 1240, A, { ref: "Team lunch" });
add(day(8, 11), "Zenith Events Pvt Ltd", 28000, R, { gstin: G.zenith }); // split to avoid ₹50k approval
add(day(8, 12), "Zenith Events Pvt Ltd", 24500, R, { gstin: G.zenith });
add(day(8, 12), "Zenith Events Pvt Ltd", 21000, R, { gstin: G.zenith });
add(day(9, 2), "Apex Laptops India", 86500, K, { gstin: G.apex });    // high value
add(day(8, 22), "Royal Casino Goa", 9800, R, { noInvoice: false });  // prohibited
add(day(9, 14), "Whisky Barrel Liquor Mart", 4200, R);                // prohibited (+ no invoice)
add(day(9, 5), "Skyline Consultants LLP", 18500, M, { gstin: BAD_SKYLINE }); // invalid GSTIN
add(day(8, 15), "Prime Advisory Services", 20000, K, { gstin: G.prime });    // round figure, big
add(day(8, 16), "Hotel Grand Mercure", 18250, A, { gstin: G.mercure, cat: "Accommodation" }); // Saturday, big
add(day(9, 19), "Barbeque Nation", 14800, A);                         // outlier within Food & Dining
add(day(7, 23), "Metro Cash Supplies", 7800, M, { noInvoice: true });  // no invoice
add(day(9, 8), "Local Tent House", 6400, M, { noInvoice: true });      // no invoice
add(day(8, 29), "Amazon Business", -2499, K, { cat: "Office & Supplies", ref: "Refund order #44219" }); // credit

// ---- write CSV ----
const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const lines = [
  "Corporate Card Statement - Acme Industries Pvt Ltd",
  "Period: 01/07/2026 to 30/09/2026,,,,,,,",
  ",,,,,,,",
  "Txn Date,Description,Amount (INR),Employee,Department,Category,Invoice No,Vendor GSTIN",
];
rows.sort((a, b) => a.d - b.d);
for (const r of rows) {
  lines.push([dd(r.d), r.merchant, r.amount < 0 ? `(${Math.abs(r.amount).toLocaleString("en-IN")})` : r.amount.toLocaleString("en-IN"), r.emp, r.dept, r.cat, r.inv, r.gstin].map(esc).join(","));
}
// bad rows a real export might contain
lines.push(["31/02/2026", "Typo Date Vendor", "1,200", "Asha Verma", "Marketing", "", "", ""].map(esc).join(","));
lines.push(["12/09/2026", "Missing Amount Vendor", "N/A", "Asha Verma", "Marketing", "", "", ""].map(esc).join(","));
lines.push(["Total", "", "", "", "", "", "", ""].join(","));

mkdirSync("sample-data", { recursive: true });
writeFileSync("sample-data/expenses-q2-fy27.csv", lines.join("\n") + "\n");
console.log(`Wrote ${rows.length} transactions (+2 deliberately bad rows) to sample-data/expenses-q2-fy27.csv`);
