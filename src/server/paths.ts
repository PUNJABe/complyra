import path from "node:path";

export function dataDir(): string {
  if (process.env.VERCEL) return "/tmp";
  return process.env.COMPLYRA_DATA_DIR || path.join(process.cwd(), "data");
}
