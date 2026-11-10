import type { BudgetStatus, KeyRow, Limit, LimitRow } from "./types";

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
  if (l.cacheReads) parts.push("含缓存读");
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
    if (item.period === "days") item.days = Math.max(1, Number(row.n || 0));
    if (item.period === "hours") item.hours = Math.max(1, Number(row.n || 0));
    if (row.since) item.since = row.since;
    if (row.cacheReads) item.cacheReads = true;
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
    since: l.since,
    cacheReads: !!l.cacheReads,
  }));
}

// 新建 key / 模板的默认值：每天、每月 $20、每 5 小时，其余不限。
export function blankLimits(): LimitRow[] {
  // 默认只留一条真正生效的：每月 $20。以前的三行里有两条全 0，保存后
  // 会被丢掉，界面却像是已经配了三个窗口。
  return [{ period: "month", n: 1, tokens: 0, cost: 20 }];
}

const BUDGET_WORD: Record<string, string> = { day: "每天", week: "每周", month: "每月" };

export function budgetWindow(s: BudgetStatus): string {
  if (s.period === "days") return `${s.days ?? 0} 天`;
  if (s.period === "hours") return `${s.hours ?? 0} 小时`;
  return BUDGET_WORD[s.period] || s.period;
}

export interface BudgetDisplay {
  text: string;
  spent: boolean;
  warning: boolean;
}

// 限额使用率：0.8 表示最紧的一条已经用掉 80%。没有限额信息时返回 -1。
export function budgetRatio(limits?: BudgetStatus[], binding?: BudgetStatus | null): number {
  let best = -1;
  for (const l of [...(limits || []), ...(binding ? [binding] : [])]) {
    const costRatio = l.costLimit ? (l.cost || 0) / l.costLimit : -1;
    const tokenRatio = l.tokenLimit ? (l.tokens || 0) / l.tokenLimit : -1;
    best = Math.max(best, costRatio, tokenRatio);
  }
  return best;
}

// budgetDisplay 只显示最紧的一条：任何一条用完，网关都会拒绝。
// 网关在 /v1/magpie/limit 的 `limit` 里已经给出它真正卡住的那一条（binding）；
// 用它比前端按比例猜更准——多条同时用尽时，按比例挑会显示错的重置时间。
export function budgetDisplay(
  limits?: BudgetStatus[],
  binding?: BudgetStatus | null,
): BudgetDisplay | null {
  const ratioOf = (l: BudgetStatus) => {
    const costRatio = l.costLimit ? (l.cost || 0) / l.costLimit : -1;
    const tokenRatio = l.tokenLimit ? (l.tokens || 0) / l.tokenLimit : -1;
    return { ratio: Math.max(costRatio, tokenRatio), useCost: costRatio >= tokenRatio };
  };

  let best: BudgetStatus | null = null;
  let bestRatio = -1;
  let useCost = false;

  if (binding && (binding.costLimit || binding.tokenLimit)) {
    const r = ratioOf(binding);
    best = binding;
    bestRatio = r.ratio;
    useCost = r.useCost;
  }
  for (const l of limits || []) {
    const r = ratioOf(l);
    if (r.ratio > bestRatio) {
      bestRatio = r.ratio;
      best = l;
      useCost = r.useCost;
    }
  }
  if (!best || bestRatio < 0) return null;

  const amount = useCost
    ? `${fmtCost(best.cost)} / ${fmtCost(best.costLimit)}`
    : `${fmtNum(best.tokens)} / ${fmtNum(best.tokenLimit)} tok`;
  const reset = best.reset ? ` · ${fmtDate(best.reset)} 重置` : "";
  const unpriced = Number(best.unpriced || 0);
  const estimate = unpriced > 0 && Number(best.costLimit || 0) > 0;
  const note = unpriced > 0 ? ` · ${fmtNum(unpriced)} 次未计价` : "";
  const ratio = Math.max(0, Math.min(1, bestRatio));
  return {
    text: `${budgetWindow(best)} ${amount}${reset}${note}`,
    spent: !!best.spent,
    // 未计价的调用按 $0 算，美元限额可能永远不触发；这值得一个警告色。
    warning: !!best.spent || ratio >= 0.8 || estimate,
  };
}
