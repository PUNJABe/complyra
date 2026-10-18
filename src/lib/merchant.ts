/**
 * Merchant normalisation and categorisation.
 * Matching is token/phrase based, so "ola" does not match "Coca-Cola" and
 * "gas" does not match "Vegas" (the substring bug in the previous version).
 */

const NOISE_PREFIX = /^(upi|pos|neft|rtgs|imps|ach|ecs|nach|card|ref|txn|pay|payment to|paid to)\b[\s\-/:]*/i;

export function normaliseMerchant(raw: string): string {
  let s = raw.toLowerCase().trim();
  // strip leading bank rails repeatedly: "UPI-POS-SWIGGY"
  for (let i = 0; i < 3; i++) s = s.replace(NOISE_PREFIX, "");
  s = s
    .replace(/[a-z0-9._]+@[a-z0-9]+(\.[a-z]+)?/g, " ") // upi handles like 98765@ybl (hyphen-delimited so the merchant survives)
    .replace(/[^a-z0-9&\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d{6,}$/.test(t)) // drop long reference numbers
    .join(" ");
  return s.trim();
}

const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["Alcohol & Gaming", ["casino", "betting", "poker", "rummy", "liquor", "whisky", "whiskey", "vodka", "brewery", "pub", "nightclub", "night club", "wine shop", "dream11", "fantasy"]],
  ["Cash", ["atm", "cash withdrawal", "cash wdl", "cash"]],
  ["Accommodation", ["hotel", "oyo", "airbnb", "resort", "lodge", "treebo", "fabhotels"]],
  ["Travel", ["uber", "ola", "rapido", "makemytrip", "goibibo", "irctc", "redbus", "indigo", "spicejet", "vistara", "air india", "akasa", "airline", "taxi", "cab", "flight", "railway", "metro"]],
  ["Fuel", ["petrol", "diesel", "fuel", "hpcl", "bpcl", "iocl", "indian oil", "shell", "bp", "reliance petroleum", "nayara"]],
  ["Food & Dining", ["swiggy", "zomato", "starbucks", "mcdonalds", "dominos", "pizza hut", "kfc", "subway", "cafe", "restaurant", "dhaba", "bakery", "canteen", "eatery", "burger king", "barbeque nation"]],
  ["Software & Subscriptions", ["netflix", "spotify", "adobe", "microsoft", "google workspace", "slack", "figma", "notion", "github", "aws", "amazon web services", "zoom", "atlassian", "subscription", "saas", "openai", "anthropic"]],
  ["Utilities & Telecom", ["electricity", "bescom", "tata power", "broadband", "airtel", "jio", "vodafone", "bsnl", "internet", "water bill", "recharge", "mobile bill", "act fibernet"]],
  ["Professional Services", ["consulting", "advisory", "legal", "audit", "agency", "associates", "chartered accountant", "freelance", "law firm"]],
  ["Rent", ["rent", "landlord", "lease"]],
  ["Office & Supplies", ["amazon", "flipkart", "staples", "stationery", "office depot", "croma", "reliance digital", "supplies", "laptop", "laptops", "computer", "computers", "electronics", "hardware", "furniture", "printer"]],
  ["Entertainment", ["bookmyshow", "pvr", "inox", "cinema"]],
  ["Bank Transfer", ["neft", "rtgs", "imps", "transfer", "upi"]],
];

export function inferCategory(merchantNorm: string): string {
  const padded = ` ${merchantNorm} `;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (padded.includes(` ${kw} `)) return category;
    }
  }
  return "Uncategorised";
}
