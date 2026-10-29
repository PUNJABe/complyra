import { runAnalysis } from "@/server/analysis";
import { route, WRITE } from "@/server/http";

export const POST = route({ roles: WRITE }, async ({ user, clientId }) => await runAnalysis(clientId, user.email));
