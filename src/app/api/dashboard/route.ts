import { route } from "@/server/http";
import { dashboardStats } from "@/server/stats";

export const GET = route({}, ({ clientId }) => dashboardStats(clientId));
