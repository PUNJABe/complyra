import { runAnalysis } from "@/server/analysis";
import { route, WRITE } from "@/server/http";

export const POST = route({ roles: WRITE }, ({ user, clientId }) => runAnalysis(clientId, user.email));
