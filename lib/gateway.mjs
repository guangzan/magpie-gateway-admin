// 网关的只读接口。loopback 上不需要 key；绑定到别的地址时才需要（这里不做）。

import { gatewayAddr } from "./paths.mjs";

const TIMEOUT = 10000;

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
  return getJSON(`/v1/magpie/usage?period=${p}`, { timeout: 20000 });
}

export async function requests({ period = "7d", offset = 0, limit = 50, callerKey = "", q = "", failed = false, retried = false } = {}) {
  const params = new URLSearchParams({ period, offset: String(offset), limit: String(limit) });
  if (callerKey) params.set("callerKey", callerKey);
  if (q) params.set("q", q);
  if (failed) params.set("failed", "1");
  if (retried) params.set("retried", "1");
  return getJSON(`/v1/magpie/usage/requests?${params}`, { timeout: 20000 });
}

export async function models() {
  const data = await getJSON("/v1/models");
  const list = Array.isArray(data?.data) ? data.data : [];
  return list.map((m) => ({
    id: String(m.id || ""),
    name: String(m.display_name || m.id || ""),
    provider: String(m.owned_by || ""),
    group: String(m.id || "").startsWith("auto/"),
  })).filter((m) => m.id);
}

export async function quotas() {
  const data = await getJSON("/v1/magpie/quotas?kept=1");
  return Array.isArray(data?.data) ? data.data : [];
}

// keyLimit 用一把 key 自查限额，顺便确认这把 key 网关真的认。
// reachable=false 表示网关连不上（这时不下结论），info=null 表示网关拒绝了这把 key。
export async function keyLimit(secret) {
  const url = `${gatewayAddr()}/v1/magpie/limit`;
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
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
