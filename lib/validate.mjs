// 与 magpie 内部 access 包同义的校验，尽量逐条对齐，避免写进网关读不懂的配置。
// 参考 internal/access/{access,limit,models,accounts}.go。

export const MAX_LIMITS = 5;
export const MAX_LIMIT_MODELS = 50;
export const MAX_DAYS = 3650;
export const MAX_HOURS = 8760;
export const MAX_MODELS = 500;
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

// expires 接受 ISO 时间串、毫秒时间戳或 null；null/"" 表示永不过期。
// allowPast 只在「保存时原样带回已有过期时间」时用：已过期的 key 也要能
// 改模型/限额，不能因为到期字段没动就整次保存失败。
export function cleanExpires(value, { allowPast = false } = {}) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(d.getTime())) bad("到期时间不是有效的时间", "expires");
  if (!allowPast && d.getTime() <= Date.now()) bad("到期时间必须在将来", "expires");
  return d;
}

// Limit.Valid：Tokens/Cost 非负且不能同时为 0；period 决定 Days/Hours；
// Cost 保留 4 位小数。
//
// 不再写 models：magpie 的 access.Limit 没有这个字段，JSON 反序列化时会被
// 直接忽略，界面上的「只算这些模型」会给人一个假的开关。旧数据里的 models
// 会在下次保存时被丢掉。
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

  const cyclic = period === "days" || period === "hours";
  const limit = {
    period,
    tokens: Math.trunc(tokens),
    cost: Math.round(cost * 1e4) / 1e4,
  };
  if (days) limit.days = days;
  if (hours) limit.hours = hours;
  if (input.cacheReads) limit.cacheReads = true;

  // since 是 magpie 的：新限额从现在起算；编辑已有限额时必须把原来的 since
  // 带回来，否则「只改个名字」也会把 5 小时限额窗口清零（等于白送一次用量）。
  const since = input.since == null || input.since === "" ? null : new Date(String(input.since));
  const sinceValid = since && !Number.isNaN(since.getTime()) && since.getTime() <= now.getTime();
  if (sinceValid) limit.since = since.toISOString();
  else if (cyclic) limit.since = now.toISOString();
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

// sameLimitWindow 判断两条限额是不是同一个窗口（周期 + 周期长度）。
// 编辑保存时用它把原来的 since 接回去。模型范围不再是窗口的一部分：
// magpie 不认这个字段。
export function sameLimitWindow(a, b) {
  if (!a || !b) return false;
  return a.period === b.period && (a.days || 0) === (b.days || 0) && (a.hours || 0) === (b.hours || 0);
}

function sameLimit(a, b) {
  return sameLimitWindow(a, b);
}

// 把限额表拆成 magpie 的 Limit + moreLimits（老版本只认第一个）。
export function splitLimits(limits) {
  const list = limits || [];
  return {
    limit: list.length ? list[0] : undefined,
    moreLimits: list.length > 1 ? list.slice(1) : undefined,
  };
}
