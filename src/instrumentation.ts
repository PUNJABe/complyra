// Runs once when the Node server starts. Retries queued notifications every minute so backoff really happens
// even when nobody is using the app.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { processOutbox } = await import("@/server/notify");
  const timer = setInterval(() => { processOutbox().catch((e) => console.error("[outbox]", e)); }, 60_000);
  timer.unref();
}
