import { audit } from "@/server/audit";
import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { findingsCsv } from "@/server/export";

export const GET = route({}, async ({ user, clientId }) => {
  const csv = await findingsCsv(clientId);
  await audit({ actor: user.email, action: "findings_exported", resource: "findings.csv", clientId, details: "Findings exported to CSV." }, getDb());
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="complyra-findings.csv"', "Cache-Control": "no-store" } });
});
