// 插件页面的本地管理服务。
//
// 页面在 magpie 里是 sandbox="allow-scripts" 的框架，源是 opaque 的：没有
// cookie、没有 localStorage，fetch 到 127.0.0.1 也是跨源。所以这里用
// 「每次启动生成的进程内 token + 内联进 HTML」来鉴权，而不是 cookie。

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as cli from "./cli.mjs";
import { issuedCSV, keysCSV } from "./csv.mjs";
import * as gw from "./gateway.mjs";
import { configDir, dataDir, keysPath, magpieBin } from "./paths.mjs";
import {
  defaultKeyId,
  findKey,
  limitList,
  publicKey,
  readKeys,
  updateKeys,
} from "./store.mjs";
import { applyTemplate, cleanTemplate, deleteTemplate, listTemplates, saveTemplate } from "./templates.mjs";
import {
  cleanConcurrency,
  cleanExpires,
  cleanLimits,
  cleanModels,
  cleanName,
  ValidationError,
} from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// vite 的构建产物；源码在 ui/src，改完跑 `npm run build`。
const UI_DIR = path.join(HERE, "..", "ui", "dist");
const APP = "magpie-gateway-admin";

const PERIODS = new Set(["today", "7d", "30d", "all"]);
const ASSET_TYPES = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".map", "application/json; charset=utf-8"],
]);
// 只有 vite 放在 assets/ 下、带内容哈希的文件直接静态返回。
const ASSET_PATH = /^assets\/[A-Za-z0-9._-]+$/;

export async function startServer({ port = 3478, dir = configDir() } = {}) {
  const token = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(12).toString("base64");
  const state = { dir, token, startedAt: new Date().toISOString(), version: "0.1.0" };

  const server = http.createServer((req, res) => {
    handle(req, res, state).catch((err) => {
      if (!res.headersSent) sendJSON(res, 500, { error: { message: err?.message || String(err) } });
      else res.end();
    });
  });

  server.on("clientError", (_err, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {
      // ignore
    }
  });

  server.on("close", () => console.log("[gateway-admin] server closed", new Date().toISOString()));

  const listening = await listen(server, port).catch(async (err) => {
    if (err.code !== "EADDRINUSE") throw err;
    const alive = await probeServer(port);
    if (alive) return { port, reused: true };
    throw new Error(`端口 ${port} 已被占用，请在插件选项里换一个 port`);
  });

  if (listening.reused) {
    return {
      port: listening.port,
      token,
      reused: true,
      close: async () => {},
    };
  }

  return {
    port: listening.port,
    token,
    reused: false,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 1500).unref?.();
      }),
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve({ port: addr && typeof addr === "object" ? addr.port : port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function probeServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.app === APP;
  } catch {
    return false;
  }
}

// ---------- 基础响应 ----------

function cors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "null");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "x-magpie-admin-token, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

function sendJSON(res, code, body, origin) {
  cors(res, origin);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(code);
  res.end(JSON.stringify(body));
}

function sendText(res, code, text, type, origin) {
  cors(res, origin);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", type);
  res.writeHead(code);
  res.end(text);
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new ValidationError("请求体太大", "body");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("请求体不是有效的 JSON", "body");
  }
}

function periodOf(url) {
  const p = url.searchParams.get("period") || "7d";
  return PERIODS.has(p) ? p : "7d";
}

// ---------- 路由 ----------

async function handle(req, res, state) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const origin = req.headers.origin || "";

  if (req.method === "OPTIONS") {
    cors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/ping") {
    sendJSON(res, 200, { app: APP, ok: true, version: state.version, startedAt: state.startedAt }, origin);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!authorized(req, state)) {
      sendJSON(res, 401, { error: { message: "没有权限：请从 magpie 的插件页面打开这个界面" } }, origin);
      return;
    }
    await api(req, res, url, state, origin);
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    let body;
    try {
      body = await fsp.readFile(path.join(UI_DIR, "index.html"), "utf8");
    } catch {
      sendText(
        res,
        503,
        "界面还没有构建：在插件目录里跑 npm install && npm run build",
        "text/plain; charset=utf-8",
        origin,
      );
      return;
    }
    body = body.replaceAll("%%TOKEN%%", state.token).replaceAll("%%NONCE%%", nonceOf(state));
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src 'nonce-${nonceOf(state)}' 'self'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src *",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    sendText(res, 200, body, "text/html; charset=utf-8", origin);
    return;
  }

  const rel = url.pathname.replace(/^\/+/, "");
  if (ASSET_PATH.test(rel)) {
    const file = path.join(UI_DIR, rel);
    let body;
    try {
      body = await fsp.readFile(file);
    } catch {
      sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
      return;
    }
    const type = ASSET_TYPES.get(path.extname(file)) || "application/octet-stream";
    cors(res, origin);
    // 文件名里带内容哈希，可以放心长缓存。
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
    return;
  }

  sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
}

function nonceOf(state) {
  return state.nonce || (state.nonce = crypto.randomBytes(12).toString("base64"));
}

function authorized(req, state) {
  const given = String(req.headers["x-magpie-admin-token"] || "");
  if (!given || given.length !== state.token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(state.token));
  } catch {
    return false;
  }
}

async function api(req, res, url, state, origin) {
  const dir = state.dir;
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const rest = parts.slice(1);

  try {
    if (rest[0] === "health" && req.method === "GET") return await health(res, dir, origin);
    if (rest[0] === "catalog" && req.method === "GET") return await catalog(res, origin);
    if (rest[0] === "templates") return await templates(req, res, rest, dir, origin);
    if (rest[0] === "export" && req.method === "GET") return await exportCSV(res, url, dir, origin);
    if (rest[0] === "export" && req.method === "POST") return await saveExport(req, res, dir, origin);
    if (rest[0] === "usage") return await usageRoutes(req, res, url, rest, origin);
    if (rest[0] === "keys") return await keyRoutes(req, res, url, rest, dir, origin);
    sendJSON(res, 404, { error: { message: "没有这个接口" } }, origin);
  } catch (err) {
    if (err instanceof ValidationError) {
      sendJSON(res, 400, { error: { message: err.message, field: err.field } }, origin);
      return;
    }
    if (err instanceof cli.CliError) {
      sendJSON(res, 400, { error: { message: err.message, kind: "cli" } }, origin);
      return;
    }
    if (err?.code === "ENOENT") {
      sendJSON(res, 404, { error: { message: "找不到文件" } }, origin);
      return;
    }
    console.error("[gateway-admin]", err);
    sendJSON(res, 500, { error: { message: err?.message || String(err) } }, origin);
  }
}

// ---------- 健康检查 ----------

async function health(res, dir, origin) {
  const [gateway, keysReadable] = await Promise.all([gw.ping(), readKeys(dir).then(() => true).catch(() => false)]);
  let writable = false;
  try {
    await fsp.access(path.dirname(keysPath(dir)), fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  sendJSON(
    res,
    200,
    {
      app: APP,
      version: "0.1.0",
      configDir: dir,
      keysFile: keysPath(dir),
      keysReadable,
      writable,
      cli: { ok: cli.cliAvailable(), path: magpieBin() },
      gateway,
    },
    origin,
  );
}

async function catalog(res, origin) {
  const [models, quotas] = await Promise.all([
    gw.models().catch(() => []),
    gw.quotas().catch(() => []),
  ]);
  const providers = [...new Set(models.map((m) => m.provider).filter(Boolean))].sort();
  sendJSON(
    res,
    200,
    {
      models,
      providers,
      quotas: quotas.map((q) => ({
        provider: q.provider,
        name: q.name,
        plan: q.plan,
        kind: q.kind,
        user: q.user,
      })),
    },
    origin,
  );
}

// ---------- 模板 ----------

async function templates(req, res, rest, dir, origin) {
  if (req.method === "GET" && rest.length === 1) {
    sendJSON(res, 200, { templates: await listTemplates(dir) }, origin);
    return;
  }
  if (req.method === "POST" && rest.length === 1) {
    const body = await readBody(req);
    sendJSON(res, 200, { template: await saveTemplate(dir, body) }, origin);
    return;
  }
  if (req.method === "DELETE" && rest.length === 2) {
    await deleteTemplate(dir, rest[1]);
    sendJSON(res, 200, { ok: true }, origin);
    return;
  }
  sendJSON(res, 405, { error: { message: "方法不允许" } }, origin);
}

// ---------- 用量 ----------

async function usageRoutes(req, res, url, rest, origin) {
  if (req.method !== "GET") {
    sendJSON(res, 405, { error: { message: "方法不允许" } }, origin);
    return;
  }
  const period = periodOf(url);
  if (rest.length === 1) {
    const summary = await gw.usage(period);
    sendJSON(res, 200, { summary, groups: summary.callerKeys || [] }, origin);
    return;
  }
  if (rest[1] === "requests") {
    const page = await gw.requests({
      period,
      offset: Number(url.searchParams.get("offset") || 0),
      limit: Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50))),
      callerKey: url.searchParams.get("callerKey") || "",
      q: url.searchParams.get("q") || "",
      failed: url.searchParams.get("failed") === "1",
      retried: url.searchParams.get("retried") === "1",
    });
    sendJSON(res, 200, page, origin);
    return;
  }
  sendJSON(res, 404, { error: { message: "没有这个接口" } }, origin);
}

// ---------- key ----------

async function keyRoutes(req, res, url, rest, dir, origin) {
  const usageParam = url.searchParams.get("usage") || "today";
  const period = usageParam === "off" ? "" : PERIODS.has(usageParam) ? usageParam : "today";

  if (rest.length === 1) {
    if (req.method === "GET") return await listKeys(res, dir, period, origin);
    if (req.method === "POST") return await createKey(req, res, dir, origin);
    sendJSON(res, 405, { error: { message: "方法不允许" } }, origin);
    return;
  }

  if (rest.length === 2 && rest[1] === "batch" && req.method === "POST") {
    return await batchKeys(req, res, dir, origin);
  }

  const id = rest[1];
  if (!id) {
    sendJSON(res, 404, { error: { message: "没有这个 key" } }, origin);
    return;
  }

  if (rest.length === 2 && req.method === "DELETE") {
    await cli.removeKey(id);
    sendJSON(res, 200, { ok: true }, origin);
    return;
  }

  if (rest.length === 3) {
    const action = rest[2];
    if (action === "rotate" && req.method === "POST") {
      const secret = await cli.rotateKey(id);
      // 已停用的 key 网关本来就不认，别拿它当迁移失败。真出错也不要吞掉
      // 已经生效的轮换：把明文照常返回，只带一句提醒。
      const rotated = findKey(await readKeys(dir), id);
      let warning = "";
      if (!rotated?.off) {
        const { reachable, info } = await gw.keyLimit(secret);
        if (reachable && !info?.key) {
          warning = "新密钥暂时没被网关认出来，可能还在迁移，稍后刷新再看";
        }
      }
      sendJSON(res, 200, { id, secret, ...(warning ? { warning } : {}) }, origin);
      return;
    }
    if (action === "limits" && req.method === "POST") {
      const body = await readBody(req);
      const limits = cleanLimits(body.limits ?? body);
      await patchKey(dir, id, (key) => {
        key.limit = limits[0];
        if (limits.length > 1) key.moreLimits = limits.slice(1);
        else delete key.moreLimits;
      });
      return await respondKey(res, dir, id, origin);
    }
    if (action === "expires" && req.method === "POST") {
      const body = await readBody(req);
      const expires = cleanExpires(body.expires);
      await patchKey(dir, id, (key) => {
        if (expires) key.expires = expires.toISOString();
        else delete key.expires;
      });
      return await respondKey(res, dir, id, origin);
    }
    if (action === "secret" && req.method === "GET") {
      // 只在用户点“复制”时给一次明文；和 magpie 的 copy-key 同义。
      const keys = await readKeys(dir);
      const key = findKey(keys, id);
      if (!key) throw new ValidationError("没有这个 key", "id");
      sendJSON(res, 200, { id, secret: key.secret || "" }, origin);
      return;
    }
  }

  if (rest.length === 2 && req.method === "PATCH") {
    return await patchRoute(req, res, dir, id, origin);
  }

  sendJSON(res, 404, { error: { message: "没有这个接口" } }, origin);
}

async function listKeys(res, dir, period, origin) {
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  let usageMap = new Map();
  let warning = "";
  if (period) {
    try {
      const summary = await gw.usage(period);
      for (const g of summary.callerKeys || []) {
        usageMap.set(g.callerKeyId || g.id, g);
      }
    } catch (err) {
      warning = `用量暂时取不到：${err.message}`;
    }
  }
  const rows = keys.map((k) => {
    const pub = publicKey(k, { defaultId });
    if (period) {
      const g = usageMap.get(k.id);
      pub.usage = g
        ? {
            calls: g.calls || 0,
            errors: g.errors || 0,
            cost: g.cost || 0,
            input: g.input || 0,
            output: g.output || 0,
            cache_read: g.cache_read || 0,
          }
        : { calls: 0, errors: 0, cost: 0, input: 0, output: 0, cache_read: 0 };
    }
    return pub;
  });
  sendJSON(res, 200, { keys: rows, period, warning, configDir: dir }, origin);
}

async function respondKey(res, dir, id, origin) {
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  const key = findKey(keys, id);
  if (!key) throw new ValidationError("没有这个 key", "id");
  sendJSON(res, 200, { key: publicKey(key, { defaultId }) }, origin);
}

async function patchKey(dir, id, mutate) {
  await updateKeys(dir, (keys) => {
    const key = findKey(keys, id);
    if (!key) throw new ValidationError("没有这个 key", "id");
    mutate(key);
  });
}

async function patchRoute(req, res, dir, id, origin) {
  const body = await readBody(req);
  const keys = await readKeys(dir);
  const key = findKey(keys, id);
  if (!key) throw new ValidationError("没有这个 key", "id");
  const defaultId = await defaultKeyId(dir);
  const isDefault = key.id === defaultId || !!key.lan;

  // 先把所有字段校验完，再动任何一处，避免改一半。
  const next = {};
  if (body.name !== undefined) {
    if (isDefault) throw new ValidationError("默认共享 key 不能在插件里改名，请用 magpie 的 Gateway 页面", "name");
    next.name = cleanName(body.name);
  }
  if (body.off !== undefined) {
    if (isDefault && body.off) {
      throw new ValidationError("默认共享 key 不能停用，请在 magpie 的 Gateway 页面关掉共享", "off");
    }
    next.off = !!body.off;
  }
  if (body.expires !== undefined) {
    const expires = cleanExpires(body.expires);
    next.expires = expires ? expires.toISOString() : null;
  }
  if (body.limits !== undefined) {
    next.limits = cleanLimits(body.limits);
  }
  if (body.models !== undefined) {
    next.models = cleanModels(body.models);
  }
  if (body.maxConcurrency !== undefined) {
    next.maxConcurrency = cleanConcurrency(body.maxConcurrency);
  }
  if (body.readOnly !== undefined) {
    if (isDefault && body.readOnly) {
      throw new ValidationError("默认共享 key 不能设为只读，另建一把只读 key", "readOnly");
    }
    next.readOnly = !!body.readOnly;
  }
  if (body.quotas !== undefined) next.quotas = !!body.quotas;
  if (body.issues !== undefined) {
    if (body.issues && (key.browser || key.issuer)) {
      throw new ValidationError("这把 key 不能签发短期 key", "issues");
    }
    next.issues = !!body.issues;
  }

  // 账号要 magpie 自己校验（provider.ResolveAccount 等），走 CLI。
  if (body.accounts !== undefined) {
    next.accounts = (Array.isArray(body.accounts) ? body.accounts : String(body.accounts).split(/[\n,]/))
      .map((s) => String(s).trim())
      .filter(Boolean);
  }

  // 只在真的改了账号时才动 CLI：每次保存都跑一遍既慢，也会在 magpie 版本
  // 变化时把一次普通保存变成失败。
  if (next.accounts) {
    const before = (key.accounts || []).join("\n");
    const after = next.accounts.join("\n");
    if (before !== after) await cli.setAccounts(id, next.accounts);
  }

  await patchKey(dir, id, (k) => {
    if (next.name !== undefined) k.name = next.name;
    if (next.off !== undefined) {
      if (next.off) k.off = true;
      else delete k.off;
    }
    if (next.expires !== undefined) {
      if (next.expires) k.expires = next.expires;
      else delete k.expires;
    }
    if (next.limits !== undefined) {
      if (next.limits.length) {
        k.limit = next.limits[0];
        if (next.limits.length > 1) k.moreLimits = next.limits.slice(1);
        else delete k.moreLimits;
      } else {
        delete k.limit;
        delete k.moreLimits;
      }
    }
    if (next.models !== undefined) {
      if (next.models.length) k.models = next.models;
      else delete k.models;
    }
    if (next.maxConcurrency !== undefined) {
      if (next.maxConcurrency) k.maxConcurrency = next.maxConcurrency;
      else delete k.maxConcurrency;
    }
    if (next.readOnly !== undefined) {
      if (next.readOnly) k.readOnly = true;
      else delete k.readOnly;
    }
    if (next.quotas !== undefined) {
      if (next.quotas) k.quotas = true;
      else delete k.quotas;
    }
    if (next.issues !== undefined) {
      if (next.issues) k.issues = true;
      else delete k.issues;
    }
  });

  await respondKey(res, dir, id, origin);
}

async function createKey(req, res, dir, origin) {
  const body = await readBody(req);
  const name = cleanName(body.name);
  const template = cleanTemplate(body.template ?? body);
  const created = await createKeys(dir, { names: [name], template, off: !!body.off });
  sendJSON(res, 200, { keys: created }, origin);
}

async function batchKeys(req, res, dir, origin) {
  const body = await readBody(req);
  const count = Math.trunc(Number(body.count ?? 1));
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new ValidationError("一次可以发 1 到 100 把 key", "count");
  }
  const prefix = String(body.namePrefix ?? "").trim();
  if (!prefix) throw new ValidationError("给这批 key 一个名称前缀", "namePrefix");
  const template = cleanTemplate(body.template ?? {});
  const start = Math.trunc(Number(body.startAt ?? 1)) || 1;
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(cleanName(`${prefix}-${String(start + i).padStart(2, "0")}`));
  }
  const created = await createKeys(dir, { names, template, off: !!body.off });
  sendJSON(res, 200, { keys: created }, origin);
}

// createKeys：先让 magpie 自己生成密钥（格式和默认 key 一致），
// 再把模板里的限额/模型/并发/到期一次性写进文件。
async function createKeys(dir, { names, template, off = false }) {
  const made = [];
  for (const name of names) {
    const secret = await cli.addKey(name, { readOnly: !!template?.readOnly });
    made.push({ name, secret });
  }

  const bySecret = new Map(made.map((m) => [m.secret, m]));
  const ids = [];
  await updateKeys(dir, (keys) => {
    const now = new Date();
    for (const key of keys) {
      const match = bySecret.get(key.secret);
      if (!match || match.id) continue;
      match.id = key.id;
      if (off) key.off = true;
      applyTemplate(key, template, now);
      ids.push(key.id);
    }
  });

  // 以文件里真正存下的为准：magpie 有些版本会在写入后立刻把密钥换成新格式，
  // CLI 打印的那个明文可能已经作废。
  const stored = await readKeys(dir);
  const created = ids.map((id) => {
    const key = stored.find((k) => k.id === id);
    return { id, name: key?.name || "", secret: key?.secret || "" };
  });
  const missing = created.filter((k) => !k.secret);
  if (missing.length) throw new Error(`新 key 没有写进 ${keysPath(dir)}，请检查 magpie 的日志`);

  if (template?.accounts?.length) {
    for (const k of created) await cli.setAccounts(k.id, template.accounts);
  }

  // 交付前先确认这把 key 真的能过网关：magpie 升级时可能迁移密钥格式，
  // 那样刚发出去的明文就作废了。发不出去的 key 不如不发。
  if (!off) {
    for (const k of created) {
      if (await secretWorks(k.secret)) continue;
      // 再读一次：迁移可能刚把明文换掉，换成文件里的那个再试。
      const fresh = (await readKeys(dir)).find((x) => x.id === k.id);
      if (fresh?.secret && fresh.secret !== k.secret && (await secretWorks(fresh.secret))) {
        k.secret = fresh.secret;
        continue;
      }
      await cli.removeKey(k.id).catch(() => {});
      throw new Error(`新 key “${k.name}” 没有被网关认出来（magpie 可能正在迁移密钥格式），已回滚`);
    }
  }
  return created;
}

// secretWorks: 网关连得上时，这把 key 必须能自查限额；连不上就不下结论。
async function secretWorks(secret) {
  const { reachable, info } = await gw.keyLimit(secret);
  return !reachable || !!info?.key;
}

// ---------- 导出 ----------

async function exportCSV(res, url, dir, origin) {
  const period = periodOf(url);
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  const summary = await gw.usage(period).catch(() => ({ callerKeys: [] }));
  const usageMap = new Map((summary.callerKeys || []).map((g) => [g.callerKeyId || g.id, g]));
  const rows = keys.map((k) => {
    const pub = publicKey(k, { defaultId });
    pub.limits = limitList(k);
    pub.usage = usageMap.get(k.id) || null;
    return pub;
  });
  const csv = keysCSV(rows, { period });
  const name = `magpie-keys-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  cors(res, origin);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(200);
  res.end("\ufeff" + csv);
}

// 沙箱页面没有 allow-downloads，a[download] 会被静默拦掉。改由宿主的本地
// 服务落盘：文件写在 magpie 的配置目录下，页面把路径交给用户。
function safeExportName(raw) {
  const base = path.basename(String(raw || ""));
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "");
  const name = cleaned || `magpie-keys-${new Date().toISOString().slice(0, 10)}.csv`;
  const withExt = name.toLowerCase().endsWith(".csv") ? name : `${name}.csv`;
  return withExt.slice(0, 120);
}

async function saveExport(req, res, dir, origin) {
  const body = await readBody(req);
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (!csv.trim()) throw new ValidationError("没有要导出的内容", "csv");
  const bytes = Buffer.byteLength(csv);
  if (bytes > 8 * 1024 * 1024) throw new ValidationError("导出内容超过 8MB", "csv");

  const folder = path.join(dataDir(dir), "exports");
  await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, safeExportName(body.name));
  await fsp.writeFile(file, "\ufeff" + csv, { mode: 0o600 });
  sendJSON(res, 200, { path: file, bytes }, origin);
}

export { issuedCSV };
