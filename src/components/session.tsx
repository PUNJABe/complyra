"use client";
import { createContext, useContext } from "react";
import { formatMoney, formatMoneyExact } from "@/lib/money";

export type Client = { id: string; name: string; gstin: string; pan: string; sector: string; currency: string };
export type SessionData = {
  user: { id: string; email: string; name: string; role: "admin" | "reviewer" | "viewer" };
  clients: Client[];
  activeClientId: string | null;
  aiEnabled: boolean;
  channels: { slack: boolean; whatsapp: boolean };
};
export type SessionCtx = SessionData & { reload: () => void };

export const SessionContext = createContext<SessionCtx | null>(null);
export function useSession(): SessionCtx {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside dashboard");
  return s;
}

export function useMoney() {
  const s = useSession();
  const currency = s.clients.find((c) => c.id === s.activeClientId)?.currency ?? "INR";
  return { money: (p: number) => formatMoney(p, currency), exact: (p: number) => formatMoneyExact(p, currency), currency };
}

export const canWrite = (role: string) => role === "admin" || role === "reviewer";
