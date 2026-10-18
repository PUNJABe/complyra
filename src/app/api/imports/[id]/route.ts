import { ADMIN, HttpError, route } from "@/server/http";
import { deleteImport } from "@/server/imports";

export const DELETE = route({ roles: ADMIN }, ({ user, clientId, params }) => {
  const summary = deleteImport(params.id, clientId, user.email);
  if (!summary) throw new HttpError(404, "Import not found.");
  return { ok: true, analysis: summary };
});
