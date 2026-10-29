import { HttpError, route, WRITE } from "@/server/http";
import { MAX_FILE_BYTES, ParseError, parseStatement } from "@/server/parser";

export const POST = route({ roles: WRITE }, async ({ req }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Upload the file as multipart form data."); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a file to preview.");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(400, "File is larger than 5 MB. Split it and import in parts.");
  try {
    let columnMapping: Record<string, string> | undefined;
    try { const raw = form.get("columnMapping"); if (typeof raw === "string" && raw) columnMapping = JSON.parse(raw) as Record<string,string>; } catch { throw new HttpError(400,"Saved column mapping is invalid."); }
    const parsed = await parseStatement(Buffer.from(await file.arrayBuffer()), file.name, {
      dayFirst: form.get("dateOrder") !== "mdy", negativeIsDebit: form.get("negatives") === "out", columnMapping,
    });
    return {
      filename: file.name, totalRows: parsed.totalRows, accepted: parsed.rows.length,
      rejected: parsed.rejected.length, ignored: parsed.ignored, mapping: parsed.mapping, headers: parsed.headers,
      sample: parsed.rows.slice(0, 5).map((r) => ({ date: r.date, merchant: r.merchant, amountPaise: r.amountPaise, direction: r.direction, category: r.category })),
      rejectedRows: parsed.rejected.slice(0, 10),
    };
  } catch (e) {
    if (e instanceof ParseError) throw new HttpError(400, e.message);
    throw e;
  }
});
