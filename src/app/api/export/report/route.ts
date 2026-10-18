import { route } from "@/server/http";
import { reportXlsx } from "@/server/export";

export const GET = route({}, async ({ user, clientId }) => {
  const buf = await reportXlsx(clientId, user.email);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="complyra-report.xlsx"', "Cache-Control": "no-store",
    },
  });
});
