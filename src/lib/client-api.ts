"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public issues?: { path: string; message: string }[]) { super(message); }
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login") && !window.location.pathname.startsWith("/setup")) {
    window.location.href = "/login";
  }
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status, (body as { issues?: ApiError["issues"] } | null)?.issues);
  }
  return body as T;
}

/** GET with caching-free refetch. Stale data from a previous URL is never shown for a new one. */
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data?: T; error?: string }>({ url: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api<T>(url).then((data) => alive && setState({ url, data })).catch((e: Error) => alive && setState({ url, error: e.message }));
    return () => { alive = false; };
  }, [url, tick]);
  const cur = state.url === url ? state : { url };
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: cur.data, error: cur.error, loading: Boolean(url) && cur.data === undefined && !cur.error, reload };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.issues?.length) return `${e.message} ${e.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`;
  return e instanceof Error ? e.message : "Something went wrong.";
}
