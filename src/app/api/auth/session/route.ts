import { aiEnabled } from "@/server/ai";
import { getDb } from "@/server/db";
import { activeClientId, route } from "@/server/http";
import { channelStatus } from "@/server/notify";

export const GET = route({ noClient: true }, async ({ req, user }) => {
  const clients = await getDb().prepare("SELECT id, name, gstin, pan, sector, currency FROM clients ORDER BY created_at").all();
  return { user, clients, activeClientId: activeClientId(req), aiEnabled: aiEnabled(), channels: channelStatus() };
});
