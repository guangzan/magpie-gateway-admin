// 服务在 127.0.0.1 上，每次启动换一个 token。沙箱页面没有 cookie 和
// localStorage，token 是服务内联进 HTML 的；开发时可以用 #token=… 传进来。
const TOKEN =
  (window as { __MPA_TOKEN__?: string }).__MPA_TOKEN__ ||
  new URLSearchParams(window.location.hash.slice(1)).get("token") ||
  "";

export class ApiError extends Error {
  status: number;
  field: string;

  constructor(message: string, { status = 0, field = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function api<T>(path: string, { method = "GET", body }: RequestOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "x-magpie-admin-token": TOKEN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const err = data as { error?: { message?: string; field?: string } } | null;
    throw new ApiError(err?.error?.message || `HTTP ${res.status}`, {
      status: res.status,
      field: err?.error?.field || "",
    });
  }
  return data as T;
}

export async function rawExport(period: string): Promise<string> {
  const res = await fetch(`api/export?period=${encodeURIComponent(period)}`, {
    headers: { "x-magpie-admin-token": TOKEN },
  });
  if (!res.ok) throw new ApiError(`导出失败：HTTP ${res.status}`, { status: res.status });
  return res.text();
}

export function hasToken(): boolean {
  return Boolean(TOKEN);
}
