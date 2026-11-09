// 与 magpie 内部 access 包同义的校验，尽量逐条对齐，避免写进网关读不懂的配置。
// 参考 internal/access/{access,limit,models,accounts}.go。

export const MAX_LIMITS = 5;
export const MAX_LIMIT_MODELS = 50;
export const MAX_DAYS = 3650;
export const MAX_HOURS = 8760;
export const MAX_MODELS = 500;
export const MAX_CONCURRENCY = 1000;
export const MAX_NAME = 120;

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field || "";
  }
}

const bad = (msg, field) => {
  throw new ValidationError(msg, field);
};

export function cleanName(value) {
  const name = String(value ?? "").trim();
  const runes = [...name];
  if (runes.length === 0 || runes.length > MAX_NAME) {
    bad(`名称需要 1 到 ${MAX_NAME} 个字符`, "name");
  }
  return name;
}

// CleanModels：去空白、去重（忽略大小写）、必须含 "/" 且不在两端、≤300 字符，最多 500 条。
export function cleanModels(input) {
  const out = [];
  for (const raw of asList(input)) {
    const m = String(raw).trim();
    if (!m) continue;
    if (out.some((o) => o.toLowerCase() === m.toLowerCase())) continue;
    if (!m.includes("/") || m.startsWith("/") || m.endsWith("/")) {
      bad(`模型要写成 <provider>/<model> 或 <provider>/*，例如 openai/gpt-5：${m}`, "models");
    }
    if (m.length > 300) bad("单个模型最多 300 个字符", "models");
    out.push(m);
  }
  if (out.length > MAX_MODELS) bad(`一个 key 最多列出 ${MAX_MODELS} 个模型`, "models");
  return out;
}

function asList(input) {
  if (input == null) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function cleanConcurrency(value) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CONCURRENCY) {
    bad(`并发需要 0 到 ${MAX_CONCURRENCY} 的整数（0 表示不限）`, "maxConcurrency");
  }
  return n;
}

// expires 接受 ISO 时间串、毫秒时间戳或 null；null/"" 表示永不过期。
export function cleanExpires(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(d.getTime())) bad("到期时间不是有效的时间", "expires");
  if (d.getTime() <= Date.now()) bad("到期时间必须在将来", "expires");
  return d;
}

// Limit.Valid：Tokens/Cost 非负且不能同时为 0；period 决定 Days/Hours；
// Cost 保留 4 位小数；模型不能是路由组（group/、auto/）。
export function cleanLimit(input, now = new Date()) {
  if (input == null) return null;
  const tokens = Number(input.tokens ?? 0);
  const cost = Number(input.cost ?? 0);
  if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(cost) || cost < 0) {
    bad("限额不能是负数", "limit");
  }
  if (tokens === 0 && cost === 0) return null;

  let period = String(input.period ?? "").trim() || "day";
  let days = Math.trunc(Number(input.days ?? 0)) || 0;
  let hours = Math.trunc(Number(input.hours ?? 0)) || 0;

  switch (period) {
    case "day":
    case "week":
    case "month":
      days = 0;
      hours = 0;
      break;
    case "days":
      hours = 0;
      if (days < 1 || days > MAX_DAYS) bad(`按天限额的周期是 1 到 ${MAX_DAYS} 天`, "limit");
      break;
    case "hours":
      days = 0;
      if (hours < 1 || hours > MAX_HOURS) bad(`按小时限额的周期是 1 到 ${MAX_HOURS} 小时`, "limit");
      break;
    default:
      bad("限额周期只能是 day、week、month、days 或 hours", "limit");
  }

  const models = cleanModels(input.models ?? []).slice();
  for (const m of models) {
    const lower = m.toLowerCase();
    if (lower.startsWith("group/") || lower.startsWith("auto/")) {
      bad(`限额统计的是模型或厂商，不是路由组：${m}`, "limit");
    }
  }
  if (models.length > MAX_LIMIT_MODELS) bad(`一个限额最多统计 ${MAX_LIMIT_MODELS} 个模型`, "limit");

  const cyclic = period === "days" || period === "hours";
  const limit = {
    period,
    tokens: Math.trunc(tokens),
    cost: Math.round(cost * 1e4) / 1e4,
  };
  if (days) limit.days = days;
  if (hours) limit.hours = hours;
  if (input.cacheReads) limit.cacheReads = true;
  if (models.length) limit.models = models;
  // since 是 magpie 自己维护的：按天/按小时的新限额从现在起算，日历窗口不写。
  if (cyclic) limit.since = now.toISOString();
  return limit;
}

export function cleanLimits(input, now = new Date()) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  const out = [];
  for (const raw of list) {
    const limit = cleanLimit(raw, now);
    if (!limit) continue;
    out.push(limit);
  }
  if (out.length > MAX_LIMITS) bad(`一个 key 最多 ${MAX_LIMITS} 个限额`, "limits");
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (sameLimit(out[i], out[j])) {
        bad(
          `同一个 key 已经有相同周期的限额${out[i].models?.length ? `（${out[i].models.join(", ")}）` : ""}，改那一条而不是再加一条`,
          "limits",
        );
      }
    }
  }
  return out;
}

function sameLimit(a, b) {
  if (a.period !== b.period || (a.days || 0) !== (b.days || 0) || (a.hours || 0) !== (b.hours || 0)) {
    return false;
  }
  const sa = [...(a.models || [])].map((m) => m.toLowerCase()).sort().join(",");
  const sb = [...(b.models || [])].map((m) => m.toLowerCase()).sort().join(",");
  return sa === sb;
}

// 把限额表拆成 magpie 的 Limit + moreLimits（老版本只认第一个）。
export function splitLimits(limits) {
  const list = limits || [];
  return {
    limit: list.length ? list[0] : undefined,
    moreLimits: list.length > 1 ? list.slice(1) : undefined,
  };
}

export function joinLimits(key) {
  const out = [];
  if (key?.limit) out.push(key.limit);
  if (Array.isArray(key?.moreLimits)) out.push(...key.moreLimits);
  return out;
}
