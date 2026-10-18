import { verifyAudit } from "@/server/audit";
import { route, WRITE } from "@/server/http";

export const GET = route({ roles: WRITE, noClient: true }, () => verifyAudit());
