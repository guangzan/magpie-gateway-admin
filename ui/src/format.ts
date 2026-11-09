import type { KeyRow, Limit, LimitRow } from "./types";

export function fmtNum(n?: number | null): string {
  const v = Number(n || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

export function fmtCost(n?: number | null): string {
  const v = Number(n || 0);
  if (!v) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PERIOD_WORD: Record<string, string> = { day: "每天", week: "每周", month: "每月" };

export function limitWord(l: Limit): string {
  const win =
    l.period === "days"
      ? `${l.days ?? 0}天`
      : l.period === "hours"
        ? `${l.hours ?? 0}小时`
        : PERIOD_WORD[l.period] || l.period;
  const parts: string[] = [];
  if (l.tokens) parts.push(`${fmtNum(l.tokens)} tok`);
  if (l.cost) parts.push(fmtCost(l.cost));
  if (l.models?.length) parts.push(l.models.join("|"));
  return `${win} ${parts.join(" + ") || "—"}`;
}

export interface KeyState {
  color: "default" | "green" | "gold";
  label: string;
}

export function stateOf(key: KeyRow): KeyState {
  if (key.off) return { color: "default", label: "已停用" };
  if (key.expires && new Date(key.expires).getTime() <= Date.now()) {
    return { color: "default", label: "已过期" };
  }
  if (key.expires) return { color: "gold", label: `至 ${fmtDate(key.expires)}` };
  return { color: "green", label: "启用" };
}

// 和 server 的 cleanLimit 同义：只保留真正有数值的行。
export function readLimits(rows: LimitRow[]): Limit[] {
  const out: Limit[] = [];
  for (const row of rows || []) {
    const tokens = Number(row.tokens || 0);
    const cost = Number(row.cost || 0);
    if (!tokens && !cost) continue;
    const item: Limit = { period: row.period || "day", tokens, cost };
    if (item.period === "days") item.days = Number(row.n || 0);
    if (item.period === "hours") item.hours = Number(row.n || 0);
    const models = String(row.models || "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (models.length) item.models = models;
    out.push(item);
  }
  return out;
}

export function toLimitRows(limits?: Limit[]): LimitRow[] {
  return (limits || []).map((l) => ({
    period: l.period || "day",
    n: l.period === "days" ? l.days || 1 : l.period === "hours" ? l.hours || 1 : 1,
    tokens: l.tokens || 0,
    cost: l.cost || 0,
    models: (l.models || []).join(", "),
  }));
}
