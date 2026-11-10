// 网关的只读接口。loopback 上不需要 key；绑定到别的地址时才需要（这里不做）。

import { gatewayAddr } from "./paths.mjs";

const TIMEOUT = 10000;

// 网关的用量/模型目录变化不快，列表页又会频繁刷新；短 TTL 缓存把重复的
// 上游请求挡掉。失败不缓存，网关恢复后下一次就能读到。
const CACHE = new Map();

function cacheKey(name) {
  return `${gatewayAddr()}|${name}`;
}

async function cached(name, ttlMs, fn) {
  const key = cacheKey(name);
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await fn();
  CACHE.set(key, { at: now, value });
  return value;
}

export function clearCache() {
  CACHE.clear();
}

async function getJSON(path, { timeout = TIMEOUT } = {}) {
  const url = `${gatewayAddr()}${path}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`网关 ${path} 返回 ${res.status}${text ? `：${text.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

export async function usage(period = "7d") {
  const p = encodeURIComponent(period);
  return cached(`usage:${p}`, 10000, () => getJSON(`/v1/magpie/usage?period=${p}`, { timeout: 20000 }));
}

export async function requests({ period = "7d", offset = 0, limit = 50, callerKey = "", q = "", failed = false, retried = false } = {}) {
  const params = new URLSearchParams({ period, offset: String(offset), limit: String(limit) });
  if (callerKey) params.set("callerKey", callerKey);
  if (q) params.set("q", q);
  if (failed) params.set("failed", "1");
  if (retried) params.set("retried", "1");
  return cached(`requests:${params}`, 5000, () =>
    getJSON(`/v1/magpie/usage/requests?${params}`, { timeout: 20000 }),
  );
}

export async function models() {
  return cached("models", 60000, async () => {
    const data = await getJSON("/v1/models");
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map((m) => ({
      id: String(m.id || ""),
      name: String(m.display_name || m.id || ""),
      provider: String(m.owned_by || ""),
      group: /^(auto|group)\//.test(String(m.id || "")),
    })).filter((m) => m.id);
  });
}

export async function quotas() {
  return cached("quotas", 60000, async () => {
    const data = await getJSON("/v1/magpie/quotas?kept=1");
    return Array.isArray(data?.data) ? data.data : [];
  });
}

// keyLimit 用一把 key 自查限额，顺便确认这把 key 网关真的认。
// reachable=false 表示网关连不上（这时不下结论），info=null 表示网关拒绝了这把 key。
export async function keyLimit(secret, { timeout = TIMEOUT } = {}) {
  const url = `${gatewayAddr()}/v1/magpie/limit`;
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    });
  } catch {
    return { reachable: false, info: null };
  }
  if (!res.ok) return { reachable: true, info: null };
  const info = await res.json().catch(() => null);
  return { reachable: true, info };
}

export async function ping() {
  try {
    const data = await getJSON("/v1/models", { timeout: 3000 });
    return { ok: true, models: Array.isArray(data?.data) ? data.data.length : 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
