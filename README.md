# Complyra

An expense-compliance workbench for finance teams and CAs. Import a bank, card or expense statement, have every line checked against your written policies, review what gets flagged, and export evidence an auditor can rely on.

This is a ground-up rebuild of the original `complyra-app` demo. The screens are familiar; the engine underneath is real (see [What changed](#what-changed-from-the-original)).

## Run it

Requires Node.js 20.9 or newer.

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

For development use `npm run dev`. No environment variables are required.

**First run:** open the app and you will be taken to a one-time setup screen to create the administrator account and your first client. There are no default credentials.

**Try it with data:** go to *Import* and upload `sample-data/expenses-q2-fy27.csv` (137 transactions with known problems planted in them, plus two deliberately broken rows). It produces about 19 findings across the rule types.

## The workflow

1. **Import** a CSV, `.xlsx`, or text-based PDF statement. Columns are recognised automatically (`Date`, `Description`/`Merchant`/`Narration`, `Amount` or `Debit`/`Credit`/`Withdrawal`/`Deposit`, `Employee`, `Department`, `Category`, `Invoice No`, `Vendor GSTIN`, `Reference`), and preamble lines above the header are skipped. Common bank layouts such as HDFC's multi-line `Date / Narration / Chq./Ref.No. / Value Dt / Withdrawal Amt. / Deposit Amt. / Closing Balance` are supported; wrapped narration lines are joined and closing balances are never treated as transactions. Scanned/image-only PDFs are not OCR'd; export them with selectable text or use CSV/Excel. You are shown exactly how your columns were read and which rows were rejected and why. Re-importing the same or an overlapping file never double counts.
2. **Policies** are structured rules that really run: amount limits, monthly budgets, duplicate payments, split payments that dodge an approval limit, weekend spend, prohibited merchants, round-figure amounts, missing invoices, invalid vendor GSTINs (full check-character validation), statistical outliers per category, and unattributed spend. Saving a rule re-checks everything immediately. Rules that cannot run on your data (for example invoice checks when the file has no invoice column) say so instead of flagging every row.
3. **Findings** is a review queue. Each finding explains *why* it was flagged with the actual numbers. Confirm, escalate or dismiss it; dismissing or escalating requires a written note. Keyboard: `J`/`K` move, `C` confirm, `E` escalate, `D` dismiss. Decisions survive re-runs.
4. **Export** an Excel report (summary, findings, transactions with what flagged each one, rules, audit status) or a findings CSV.

Also included: multiple clients, filing deadlines, an audit log, user management, and optional Slack/WhatsApp alerts.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including users, clients, and removing imports |
| Reviewer | Import, edit rules, review findings, view the audit log |
| Viewer | Read-only: dashboards, transactions, findings, exports |

Roles are checked on the server for every request, against the database, so a role change or deactivation takes effect immediately.

## Reading your statements correctly

- **Dates** are read day-first by default (`03/04/2026` is 3 April). Switch to month-first on the Import screen for US-format files. A date that cannot be read rejects that row; it is never replaced with today's date.
- **Amounts** are stored as integer paise, so there is no floating-point drift. `₹1,23,456.78`, `Rs. 1,200`, `(1,200.00)` and `1,500 Cr` are all understood.
- **Credits and refunds** are recorded but are not counted as spend.
- A single signed `Amount` column is ambiguous: card statements usually mean *negative = refund*, bank statements *negative = money out*. Pick the right one on the Import screen. Files with separate Debit/Credit columns are unambiguous.
- Scanned/image-only PDF statements and legacy `.xls` are not supported (you get a clear message telling you to export a selectable-text PDF, CSV, or `.xlsx`). Limits: 5 MB and 20,000 rows per file.

## Security model

- Passwords hashed with scrypt; sessions are HMAC-signed, expire after 8 hours, and are re-checked against the user table on every request.
- Every page and API route is behind a deny-by-default proxy, and every handler also enforces authentication and role itself.
- Cross-origin writes are rejected; sign-in is rate limited; responses never reveal whether an email exists.
- The audit log is append-only (database triggers refuse edits and deletes) and hash-chained. *Verify integrity* on the Audit page detects edits to history. Someone with access to the database **file** could still truncate the newest entries or rebuild the chain, so record the head hash somewhere outside the server (it is shown on the Audit page and in the Excel report).
- CSV exports neutralise spreadsheet formulas in merchant names. Uploaded `.xlsx` files are checked for zip bombs before being opened. Every stored transaction also has a SHA-256 content hash used for idempotent imports and included in audit exports; duplicate rows are skipped without double counting. Each transaction also has a SHA-256 hash derived from its canonical fields; it is used for idempotent imports and shown in the transaction view/report for reconciliation.
- Optional AI never calculates findings. It only answers from computed totals and drafts rules that are schema-validated and shown to you before anything is saved.

## Deploying

Data lives in SQLite under `./data` (override with `COMPLYRA_DATA_DIR`). Back that folder up. It means:

- It suits a single server or a small VM, with a persistent disk. Put it behind HTTPS (Caddy, nginx) and set `TRUST_PROXY=1` so the audit log records client IPs.
- It will **not** work on serverless hosts such as Vercel, whose filesystems are read-only or ephemeral. To go there, replace `src/server/db.ts` with Postgres.
- Run one instance. Sign-in rate limiting and the notification retry loop are in-process.

## Honest limitations

- GSTIN validation proves a number is well-formed and its check character is correct. It cannot tell whether the registration is active; that needs the GST portal.
- The "standard" GST and TDS dates generated on the Deadlines page are only the usual ones. Due dates are extended by notification and differ for some filers. Verify before relying on them.
- Findings are flags for human review, not conclusions. Round-figure and outlier rules in particular are weak signals by design.
- WhatsApp free-text alerts only deliver inside Meta's customer-service window; outside it you need an approved template.

## What changed from the original

| Original | Now |
|---|---|
| 15 of 20 API routes had no authentication; the middleware didn't cover `/api` | Deny-by-default proxy plus per-handler enforcement |
| Session cookie was unsigned base64; login trusted a client-supplied `role`; one shared mock credential | Signed sessions, scrypt passwords, DB-backed roles, first-run setup |
| Policy rules were free text and never executed; findings used a hardcoded `amount >= 2500` | 11 structured rule types that run, with real explanations |
| "GST mismatch" was a category regex with canned text | Real GSTIN checksum validation and honest invoice checks |
| Bad dates silently became today; credits counted as spend; `03/04` parsed US-style; "ola" matched "Coca-Cola" | Strict parsing with row-level errors, direction handling, day-first dates, whole-word matching |
| One shared JSON file as database, read-modify-write races | SQLite with transactions and migrations |
| Audit log forgeable by anyone and truncated at 300 entries | Append-only, hash-chained, verifiable |
| Falls back to fake demo numbers when empty | Honest empty states |
| `xlsx@0.18` (known vulnerabilities) | `exceljs` with zip-bomb guard |

## Development

```bash
npm test            # 64 tests: parsing, rule engine, import pipeline, audit chain, auth
npm run typecheck
npm run lint
npm run sample:generate   # regenerate the sample statement
```

Layout: `src/lib` is shared pure logic (rules, engine, money, dates, GSTIN); `src/server` is database, auth, import, analysis, export; `src/app/api` is thin route handlers; `src/app/dashboard` is the UI.
