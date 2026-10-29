import { route } from "@/server/http";
import { dashboardStats } from "@/server/stats";

export const GET = route({}, async ({ clientId }) => await dashboardStats(clientId));
