import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 text-center shadow-sm sm:p-8">
        <p className="mb-3 text-lg font-semibold tracking-tight">Complyra</p>
        <h1 className="text-2xl font-semibold tracking-tight">Expense compliance, made clear.</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Review expenses, find risks, and keep your audit evidence organized.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Link href="/login" className="rounded-md bg-brand px-3.5 py-2.5 text-sm font-medium text-brand-ink hover:opacity-90">
            Log in
          </Link>
          <Link href="/setup" className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm font-medium text-ink hover:bg-sunken">
            Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
