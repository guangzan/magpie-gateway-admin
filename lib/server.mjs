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
import { HttpError, MethodNotAllowedError, NotFoundError } from "./errors.mjs";
import * as gw from "./gateway.mjs";
import { backupDir, configDir, dataDir, keysPath, magpieBin } from "./paths.mjs";
import {
  defaultKeyId,
  findKey,
  limitList,
  publicKey,
  readKeys,
  setLimits,
  updateKeys,
} from "./store.mjs";
import { applyTemplate, cleanTemplate, deleteTemplate, listTemplates, saveTemplate } from "./templates.mjs";
import {
  cleanExpires,
  cleanLimits,
  cleanModels,
  cleanName,
  sameLimitWindow,
  ValidationError,
} from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// vite 的构建产物；源码在 ui/src，改完跑 `npm run build`。
const UI_DIR = path.join(HERE, "..", "ui", "dist");
const APP = "magpie-gateway-admin";
// 插件版本：health/ping 里报出去，端口复用和排查「跑的是哪一版」都靠它。
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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

// 管理服务只监听本机：插件页面在 magpie 的 sandbox iframe 里，本来就走
// 127.0.0.1；成员入口由 magpie 网关自带的 /me 提供，不需要在这里另开端口。
export function isLoopback(address) {
  const ip = String(address || "").replace(/^::ffff:/i, "");
  return ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.");
}

export async function startServer({ port = 3478, dir = configDir() } = {}) {
  const token = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(12).toString("base64");
  const host = "127.0.0.1";
  const state = {
    dir,
    token,
    nonce,
    port: 0,
    startedAt: new Date().toISOString(),
    version: VERSION,
  };

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

  const listening = await listen(server, port, host).catch(async (err) => {
    if (err.code !== "EADDRINUSE") throw err;
    const alive = await probeServer(port);
    if (alive) {
      // 复用前先确认端口上是不是「同一份 magpie 配置、同一个版本」的服务。
      // 只看 app 名会静默接管另一套配置的管理台：页面显示的是别人的 key，
      // 写进去的却是当前配置目录，最坏会在批量发 key 时留下没限额的孤儿。
      if (alive.configDir && alive.configDir !== dir) {
        throw new Error(
          `端口 ${port} 已被另一份 magpie 配置的管理台占用（${alive.configDir}），当前配置目录是 ${dir}。` +
            `请在插件选项里换一个 port：magpie plugin options ${APP} '{"port": 3479}'`,
        );
      }
      if (alive.version && alive.version !== VERSION) {
        throw new Error(
          `端口 ${port} 上是旧版本 ${alive.version} 的管理台（当前 ${VERSION}）。` +
            `请重启 magpie 以加载新版本，或在插件选项里换一个 port。`,
        );
      }
      return { port, reused: true };
    }
    throw new Error(`端口 ${port} 已被占用，请在插件选项里换一个 port`);
  });

  state.port = listening.port;
  allowOrigins(listening.port);

  if (listening.reused) {
    // 端口上已经是另一个实例；这个进程并没有在服务，返回自己的 token 只会
    // 造成「拿到了 token 却调不动接口」的误解，所以这里明确给 null。
    return {
      port: listening.port,
      token: null,
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

function listen(server, port, host) {
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
    server.listen(port, host);
  });
}

// probe 永远走回环：管理服务只监听 127.0.0.1。
export async function probeServer(port) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/ping`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return false;
    const body = await res.json();
    // 老版本没有 configDir/version 字段；返回对象让调用方自己决定怎么用。
    return body?.app === APP ? body : false;
  } catch {
    return false;
  }
}

// ---------- 基础响应 ----------

// 只允许服务自己的源、vite dev 的 5173、以及 magpie web 代理下的沙箱页面
//（Origin: null）。以前把请求的 Origin 原样回显，任何网页都能跨源读到内联
// 了 token 的 HTML，等于把管理 token 交出去；localhost 的其它端口也不认。
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
let ALLOWED_ORIGINS = new Set(["null", ...DEV_ORIGINS]);

function allowOrigins(port) {
  const extra = String(process.env.MAGPIE_ADMIN_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  ALLOWED_ORIGINS = new Set([
    "null",
    ...DEV_ORIGINS,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
    ...extra,
  ]);
}

function localOrigin(origin) {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

function cors(res, origin) {
  if (!localOrigin(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "x-magpie-admin-token, content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function baseHeaders(res) {
  // 不要加 Cross-Origin-Resource-Policy: same-origin。页面的脚本和样式是在
  // magpie 的 sandbox iframe 里加载的，iframe 的源是 opaque，对它来说这些
  // 文件就是跨源资源；CORP 会把它们全部挡掉（magpie 自己的 pagePolicy 也
  // 特意不加 CORP，原因相同）。
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJSON(res, code, body, origin) {
  cors(res, origin);
  baseHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(code);
  res.end(JSON.stringify(body));
}

function sendText(res, code, text, type, origin) {
  cors(res, origin);
  baseHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", type);
  res.writeHead(code);
  res.end(text);
}

// Host 必须是本机地址，且端口就是本次服务监听的端口。DNS rebinding 把
// evil.com 解析到 127.0.0.1 时，Host 仍然是 evil.com，在这里被挡掉。
function hostAllowed(host, port) {
  if (!host) return false;
  const text = String(host).toLowerCase();
  const names = ["127.0.0.1", "localhost", "[::1]"];
  return names.some((name) => text === name || text === `${name}:${port}`);
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
  const pathname = url.pathname;
  const local = isLoopback(req.socket?.remoteAddress);

  if (!hostAllowed(req.headers.host, state.port)) {
    sendText(res, 421, "Misdirected Request", "text/plain; charset=utf-8", "");
    return;
  }

  if (req.method === "OPTIONS") {
    if (origin && !localOrigin(origin)) {
      sendText(res, 403, "forbidden", "text/plain; charset=utf-8", origin);
      return;
    }
    cors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  // 管理接口只能从本机来：只靠 Host 校验会把管理 token 和 key 列表交出去。
  if (pathname === "/api/ping") {
    if (!local) {
      sendJSON(res, 403, { error: { message: "这个接口只在本机可用" } }, origin);
      return;
    }
    sendJSON(
      res,
      200,
      {
        app: APP,
        ok: true,
        version: state.version,
        configDir: state.dir,
        pid: process.pid,
        startedAt: state.startedAt,
      },
      origin,
    );
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (!local) {
      sendJSON(res, 403, { error: { message: "管理接口只在本机可用" } }, origin);
      return;
    }
    if (origin && !localOrigin(origin)) {
      sendJSON(res, 403, { error: { message: "这个接口只接受本机管理页面的请求" } }, origin);
      return;
    }
    if (!authorized(req, state)) {
      sendJSON(res, 401, { error: { message: "没有权限：请从 magpie 的插件页面打开这个界面" } }, origin);
      return;
    }
    await api(req, res, url, state, origin);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    // 管理页含本次启动的 token，只发给本机。
    if (!local) {
      sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
      return;
    }
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
    // index.html 引用的资源必须都在。构建产物是提交进仓库的；只提交了
    // index.html、漏了 assets 里的文件时，浏览器会白屏且没有任何提示。
    const missing = await missingUiAsset(body);
    if (missing) {
      sendText(
        res,
        503,
        `界面构建产物不完整：缺少 ${missing}。在插件目录里跑 npm install && npm run build`,
        "text/plain; charset=utf-8",
        origin,
      );
      return;
    }
    body = body.replaceAll("%%TOKEN%%", state.token).replaceAll("%%NONCE%%", nonceOf(state));
    // 这一页在 sandbox iframe 里，文档的源是 opaque；WebKit 下 'self' 不一定
    // 能匹配自己的地址（magpie 自己的文档也记了这个坑）。所以除了 'self'
    //（magpie web 的反代会把它改写成自己的源），再把本机地址显式写一遍。
    const own = ["127.0.0.1", "localhost", "[::1]"]
      .map((host) => `http://${host}:${state.port}`)
      .join(" ");
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'none'",
        `script-src 'nonce-${nonceOf(state)}' 'self' ${own}`,
        `style-src 'self' 'unsafe-inline' ${own}`,
        `img-src 'self' data: ${own}`,
        `font-src 'self' ${own}`,
        `connect-src 'self' ${own}`,
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    );
    // 不能加 X-Frame-Options / frame-ancestors 'none'：这一页本来就跑在
    // magpie 的 sandbox iframe 里（page/boot.js 用 location.replace 把自己
    // 导航到这里），禁框会把整个插件挡在外面。防跨站靠 Host、Origin 和
    // 内联 token，不靠禁框。
    res.setHeader("Referrer-Policy", "no-referrer");
    sendText(res, 200, body, "text/html; charset=utf-8", origin);
    return;
  }

  const rel = pathname.replace(/^\/+/, "");
  if (ASSET_PATH.test(rel)) {
    // 管理页的静态资源同样只发给本机：它们没有秘密，但也没必要扩大面。
    if (!local) {
      sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
      return;
    }
    await serveAsset(res, path.join(UI_DIR, rel), origin);
    return;
  }

  sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
}

async function serveAsset(res, file, origin) {
  let body;
  try {
    body = await fsp.readFile(file);
  } catch {
    sendText(res, 404, "not found", "text/plain; charset=utf-8", origin);
    return;
  }
  const type = ASSET_TYPES.get(path.extname(file)) || "application/octet-stream";
  cors(res, origin);
  baseHeaders(res);
  // 文件名里带内容哈希，可以放心长缓存。
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.writeHead(200, { "Content-Type": type });
  res.end(body);
}

async function missingUiAsset(html) {
  const refs = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
  for (const rel of refs) {
    if (!ASSET_PATH.test(rel)) return rel;
    try {
      await fsp.access(path.join(UI_DIR, rel), fs.constants.R_OK);
    } catch {
      return rel;
    }
  }
  return "";
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
    if (rest[0] === "health" && req.method === "GET") return await health(res, state, origin);
    if (rest[0] === "catalog" && req.method === "GET") return await catalog(res, origin);
    if (rest[0] === "templates") return await templates(req, res, rest, dir, origin);
    if (rest[0] === "export" && req.method === "POST") return await saveExport(req, res, dir, origin);
    if (rest[0] === "export") throw new MethodNotAllowedError("POST");
    if (rest[0] === "usage") return await usageRoutes(req, res, url, rest, origin);
    if (rest[0] === "keys") return await keyRoutes(req, res, url, rest, dir, origin);
    throw new NotFoundError("没有这个接口");
  } catch (err) {
    respondError(res, err, origin);
  }
}

// 所有接口共用一套错误映射。
function respondError(res, err, origin) {
  if (err instanceof HttpError) {
    for (const [name, value] of Object.entries(err.headers || {})) res.setHeader(name, value);
    const error = { message: err.message };
    if (err.field) error.field = err.field;
    if (err.kind) error.kind = err.kind;
    sendJSON(res, err.status, { error }, origin);
    return;
  }
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
  // 内部错误的细节只进日志，不回给页面。
  console.error("[gateway-admin]", err);
  sendJSON(res, 500, { error: { message: "本地服务内部错误，详情见 magpie 日志" } }, origin);
}

// ---------- 健康检查 ----------

async function health(res, state, origin) {
  const dir = state.dir;
  const [gateway, keysResult] = await Promise.all([
    gw.ping(),
    readKeys(dir)
      .then((keys) => ({ ok: true, count: keys.length, error: "" }))
      .catch((err) => ({ ok: false, count: 0, error: err?.message || String(err) })),
  ]);
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
      version: VERSION,
      configDir: dir,
      // magpie 自己不读这两个变量；设了以后插件可能管的不是 magpie 正在用的那份。
      configOverride: process.env.MAGPIE_ADMIN_CONFIG_DIR
        ? "MAGPIE_ADMIN_CONFIG_DIR"
        : process.env.MAGPIE_CONFIG_DIR
          ? "MAGPIE_CONFIG_DIR"
          : "",
      keysFile: keysPath(dir),
      keysReadable: keysResult.ok,
      keysCount: keysResult.count,
      keysError: keysResult.error,
      writable,
      backupsDir: backupDir(dir),
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
  if (rest.length === 1) {
    if (req.method === "GET") {
      sendJSON(res, 200, { templates: await listTemplates(dir) }, origin);
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJSON(res, 200, { template: await saveTemplate(dir, body) }, origin);
      return;
    }
    throw new MethodNotAllowedError("GET, POST");
  }
  if (rest.length === 2) {
    if (req.method === "DELETE") {
      await deleteTemplate(dir, rest[1]);
      sendJSON(res, 200, { ok: true }, origin);
      return;
    }
    throw new MethodNotAllowedError("DELETE");
  }
  throw new NotFoundError("没有这个接口");
}

// ---------- 用量 ----------

async function usageRoutes(req, res, url, rest, origin) {
  if (req.method !== "GET") throw new MethodNotAllowedError("GET");
  const period = periodOf(url);
  if (rest.length === 1) {
    const summary = await usageOr502(() => gw.usage(period));
    sendJSON(res, 200, { summary, groups: summary.callerKeys || [] }, origin);
    return;
  }
  if (rest[1] === "requests") {
    const rawOffset = Math.trunc(Number(url.searchParams.get("offset") || 0));
    const rawLimit = Math.trunc(Number(url.searchParams.get("limit") || 50));
    const page = await usageOr502(() =>
      gw.requests({
        period,
        offset: Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0,
        limit: Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50,
        callerKey: url.searchParams.get("callerKey") || "",
        q: url.searchParams.get("q") || "",
        failed: url.searchParams.get("failed") === "1",
        retried: url.searchParams.get("retried") === "1",
      }),
    );
    sendJSON(res, 200, page, origin);
    return;
  }
  throw new NotFoundError("没有这个接口");
}

// 网关只读接口失败时给页面一个能看懂的 502，而不是笼统的「内部错误」。
// 前端据此显示失败态，不会把 0 / 空表当成真实数据。
async function usageOr502(fn) {
  try {
    return await fn();
  } catch (err) {
    throw new HttpError(502, `用量取不到：${err?.message || String(err)}`, { kind: "gateway" });
  }
}

// ---------- key ----------

async function keyRoutes(req, res, url, rest, dir, origin) {
  const usageParam = url.searchParams.get("usage") || "today";
  const period = usageParam === "off" ? "" : PERIODS.has(usageParam) ? usageParam : "today";

  if (rest.length === 1) {
    if (req.method === "GET") return await listKeys(res, dir, period, origin);
    if (req.method === "POST") return await createKey(req, res, dir, origin);
    throw new MethodNotAllowedError("GET, POST");
  }

  if (rest.length === 2 && rest[1] === "batch") {
    if (req.method !== "POST") throw new MethodNotAllowedError("POST");
    return await batchKeys(req, res, dir, origin);
  }

  if (rest.length === 2 && rest[1] === "bulk") {
    if (req.method !== "POST") throw new MethodNotAllowedError("POST");
    return await bulkKeys(req, res, dir, origin);
  }

  const id = rest[1];
  if (!id) throw new NotFoundError("没有这个 key");

  if (rest.length === 2 && req.method === "DELETE") {
    await assertNotDefault(dir, id);
    await cli.removeKey(id);
    sendJSON(res, 200, { ok: true }, origin);
    return;
  }

  if (rest.length === 3) {
    const action = rest[2];
    if (action === "rotate" && req.method === "POST") {
      await assertNotDefault(dir, id);
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
        setLimits(key, carrySince(limits, limitList(key)));
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
      if (!key) throw new NotFoundError("没有这个 key");
      sendJSON(res, 200, { id, secret: key.secret || "" }, origin);
      return;
    }
  }

  if (rest.length === 4 && rest[2] === "limits" && rest[3] === "reset" && req.method === "POST") {
    await cli.resetLimits(id);
    return await respondKey(res, dir, id, origin);
  }

  if (rest.length === 2 && req.method === "PATCH") {
    return await patchRoute(req, res, dir, id, origin);
  }

  throw new NotFoundError("没有这个接口");
}

// carrySince 在保存限额时把同一个窗口原来的 since 接回去。cleanLimits 对
// days/hours 会写 now，如果没有这一步，改个名字也会把限额窗口清零。
function carrySince(limits, previous) {
  return limits.map((limit) => {
    const old = previous.find((item) => sameLimitWindow(item, limit));
    return old?.since ? { ...limit, since: old.since } : limit;
  });
}

// 默认共享 key 是 magpie 自己的 Gateway 页面管的。插件已经拦了改名、停用、
// 只读；删除和轮换如果不拦，就能绕过全部保护，把所有共享客户端一次性打掉。
async function assertNotDefault(dir, id) {
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  const key = findKey(keys, id);
  if (!key) throw new NotFoundError("没有这个 key");
  if (key.id === defaultId || key.lan) {
    throw new HttpError(409, "默认共享 key 不能在这里删除或轮换，请到 magpie 的 Gateway 页面操作", {
      field: "id",
    });
  }
  return key;
}

async function listKeys(res, dir, period, origin) {
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  // 用量和限额互不依赖，并行取；任一个失败都不该拖垮列表。
  const [usageResult, budgetResult] = await Promise.allSettled([
    period ? gw.usage(period) : Promise.resolve(null),
    keyBudgets(keys),
  ]);

  const usageMap = new Map();
  const usageOk = usageResult.status === "fulfilled" && !!usageResult.value;
  let usageError = "";
  if (usageOk) {
    for (const group of usageResult.value.callerKeys || []) {
      usageMap.set(group.callerKeyId || group.id, group);
    }
  } else if (usageResult.status === "rejected") {
    usageError = usageResult.reason?.message || String(usageResult.reason);
  }
  // 用量取不到时不要再合成一组 0：0 和「不知道」在界面上必须是两件事，
  // 否则「今天谁花了多少」会看起来一切正常。
  let warning = usageError ? `用量暂时取不到（${usageError}），用量列显示为 —` : "";

  const budgets = budgetResult.status === "fulfilled" ? budgetResult.value : { out: new Map(), complete: false };
  if (!budgets.complete) {
    warning = warning || "限额读取超时，部分 key 的限额稍后刷新再看";
  }

  const rows = keys.map((k) => {
    const pub = publicKey(k, { defaultId });
    pub.budget = budgets.out.get(k.id) || null;
    if (period && usageOk) {
      const g = usageMap.get(k.id);
      pub.usage = g
        ? {
            calls: g.calls || 0,
            errors: g.errors || 0,
            cost: g.cost || 0,
            unpriced: g.unpriced || 0,
            input: g.input || 0,
            output: g.output || 0,
            cache_read: g.cache_read || 0,
          }
        : { calls: 0, errors: 0, cost: 0, unpriced: 0, input: 0, output: 0, cache_read: 0 };
    }
    return pub;
  });
  sendJSON(
    res,
    200,
    { keys: rows, period, warning, usageOk, budgetComplete: budgets.complete, configDir: dir },
    origin,
  );
}

// keyBudgets 逐把 key 用它的明文自查限额用量：GET /v1/magpie/limit。
// 停用的 key 网关不认，连不上网关时也没有数据，界面上都显示“—”。
// 两点约束：结果短缓存（列表会频繁刷新），整轮有 8s 预算（网关挂住时
// 不能让列表等 100×3s）。
const BUDGET_AT_ONCE = 8;
const BUDGET_TTL = 15000;
const BUDGET_FAIL_TTL = 5000;
const BUDGET_BUDGET_MS = 8000;
const budgetCache = new Map();

async function keyLimitCached(secret) {
  const hit = budgetCache.get(secret);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const value = await gw.keyLimit(secret, { timeout: 2500 });
  const ttl = value.reachable && value.info ? BUDGET_TTL : BUDGET_FAIL_TTL;
  budgetCache.set(secret, { at: now, value, ttl });
  if (budgetCache.size > 500) {
    // 轮换/删除会留下旧明文；简单按插入顺序清掉最早的一批。
    let drop = budgetCache.size - 400;
    for (const key of budgetCache.keys()) {
      budgetCache.delete(key);
      if (--drop <= 0) break;
    }
  }
  return value;
}

async function keyBudgets(keys) {
  const out = new Map();
  const todo = keys.filter((k) => !k.off && k.secret);
  const deadline = Date.now() + BUDGET_BUDGET_MS;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (Date.now() > deadline) return;
      const key = todo[next++];
      try {
        const { reachable, info } = await keyLimitCached(key.secret);
        if (!reachable || !info) continue;
        const limits = Array.isArray(info.limits) ? info.limits : info.limit ? [info.limit] : [];
        // `limit` 是网关选出的“真正卡住这把 key”的那一条；多条同时用尽时
        // 它比前端按比例挑更准。
        const binding = info.limit && typeof info.limit === "object" ? info.limit : null;
        out.set(key.id, { limited: !!info.limited, limits, binding });
      } catch {
        // 单把 key 查不到不影响整个列表
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BUDGET_AT_ONCE, todo.length) }, worker));
  return { out, complete: next >= todo.length };
}

async function respondKey(res, dir, id, origin) {
  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  const key = findKey(keys, id);
  if (!key) throw new NotFoundError("没有这个 key");
  sendJSON(res, 200, { key: publicKey(key, { defaultId }) }, origin);
}

async function patchKey(dir, id, mutate) {
  await updateKeys(dir, (keys) => {
    const key = findKey(keys, id);
    if (!key) throw new NotFoundError("没有这个 key");
    mutate(key);
  });
}

async function patchRoute(req, res, dir, id, origin) {
  const body = await readBody(req);
  const keys = await readKeys(dir);
  const key = findKey(keys, id);
  if (!key) throw new NotFoundError("没有这个 key");
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
    // 到期也能让 key 失效，对默认共享 key 放开等于绕过上面的「不能停用」。
    if (isDefault) {
      throw new ValidationError(
        "默认共享 key 的到期时间不能在这里改；改到期等于绕过「不能停用」，请用 magpie 的 Gateway 页面",
        "expires",
      );
    }
    if (body.expires === null || body.expires === "") {
      next.expires = null;
    } else {
      const requested = String(body.expires);
      // 同一天视为「没改」：保留原来的完整时间，避免表单的 YYYY-MM-DD 把
      // 时区/时分秒改掉；也让已过期的 key 还能保存其他字段。
      const sameDay = key.expires && requested.slice(0, 10) === String(key.expires).slice(0, 10);
      next.expires = sameDay ? key.expires : cleanExpires(requested).toISOString();
    }
  }
  if (body.limits !== undefined) {
    next.limits = cleanLimits(body.limits);
  }
  if (body.models !== undefined) {
    next.models = cleanModels(body.models);
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
      setLimits(k, carrySince(next.limits, limitList(k)));
    }
    if (next.models !== undefined) {
      if (next.models.length) k.models = next.models;
      else delete k.models;
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
  // cleanTemplate 现在也认绝对的 expires：单把新建的到期时间不会再被丢掉。
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
  const start = Math.trunc(Number(body.startAt ?? 1));
  if (!Number.isInteger(start) || start < 1 || start > 1000000) {
    throw new ValidationError("起始编号需要是正整数", "startAt");
  }
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(cleanName(`${prefix}-${String(start + i).padStart(2, "0")}`));
  }
  const existing = new Set((await readKeys(dir)).map((k) => k.name));
  const duplicate = names.find((name) => existing.has(name));
  if (duplicate) throw new ValidationError(`名称已存在：${duplicate}`, "namePrefix");
  const created = await createKeys(dir, { names, template, off: !!body.off });
  sendJSON(res, 200, { keys: created }, origin);
}

// 列表多选后的批量操作。启用/停用一次持锁读改写；删除逐把走 magpie 的
// CLI（它才是 caller-keys.json 的写者），失败逐条回报，不假装整批成功。
async function bulkKeys(req, res, dir, origin) {
  const body = await readBody(req);
  const action = String(body.action || "");
  if (!["off", "on", "delete"].includes(action)) {
    throw new ValidationError("批量操作只支持启用、停用或删除", "action");
  }
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean))];
  if (!ids.length) throw new ValidationError("先选要操作的 key", "ids");
  if (ids.length > 200) throw new ValidationError("一次最多操作 200 把 key", "ids");

  const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
  const byId = new Map(keys.map((k) => [k.id, k]));
  const skipped = [];
  const target = [];
  for (const id of ids) {
    const key = byId.get(id);
    if (!key) {
      skipped.push({ id, message: "这把 key 已经不在了" });
    } else if (key.id === defaultId || key.lan) {
      skipped.push({ id, message: "默认共享 key 请到 magpie 的 Gateway 页面操作" });
    } else {
      target.push(id);
    }
  }

  const failed = [];
  if (action === "delete") {
    await runPool(target, 4, async (id) => {
      try {
        await cli.removeKey(id);
      } catch (err) {
        failed.push({ id, message: err?.message || String(err) });
      }
    });
  } else if (target.length) {
    await updateKeys(dir, (list) => {
      for (const key of list) {
        if (!target.includes(key.id)) continue;
        if (action === "off") key.off = true;
        else delete key.off;
      }
    });
  }

  const failedIds = new Set(failed.map((f) => f.id));
  sendJSON(
    res,
    200,
    {
      ok: true,
      action,
      succeeded: target.filter((id) => !failedIds.has(id)),
      failed,
      skipped,
    },
    origin,
  );
}

async function runPool(items, limit, fn) {
  let next = 0;
  let failed = null;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        await fn(items[index], index);
      } catch (err) {
        // 等所有 worker 收工再抛：否则回滚开始后，还在跑的 CLI 进程会再写回
        // 一个刚被删掉的 key。
        if (!failed) failed = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failed;
}

// createKeys：先让 magpie 自己生成密钥（格式和默认 key 一致），再把模板里的
// 限额/模型/账号/到期写进文件。整批是一个事务：任何一步失败，把这一批已经
// 落盘的 key 全部删掉，不留半批没有限额的孤儿。
const ADD_AT_ONCE = 4;
const VERIFY_AT_ONCE = 6;

// 新增的 key 按「不在 before 里 + 名称是这一批的」认，不按 CLI 打印的明文认：
// 有些 magpie 版本会在 add 之后立刻把密钥迁移成另一种格式，明文一变就找不到了。
function freshKeys(all, before, names) {
  const wanted = new Set(names);
  return all.filter((key) => !before.has(key.id) && wanted.has(key.name));
}

async function createKeys(dir, { names, template, off = false }) {
  const before = new Set((await readKeys(dir)).map((k) => k.id));
  // magpie 侧的 before/after：配置目录不一致时，本地 caller-keys.json 看不到
  // 新 key，必须按 CLI 的 id 回滚，否则会留在 magpie 那边。
  const cliBefore = await cli.listKeys().catch(() => null);
  let cliAdded = [];
  const created = [];
  try {
    // 1. magpie 生成密钥。magpie 自己有跨进程文件锁，4 路并发只是省 spawn 时间。
    await runPool(names, ADD_AT_ONCE, (name) => cli.addKey(name, { readOnly: !!template?.readOnly }));

    // 2. 按名称认出这一批新 key（同一批里的名称在 batchKeys 里检查过不重复）。
    const localAfter = await readKeys(dir);
    if (cliBefore) {
      const after = await cli.listKeys().catch(() => null);
      if (after) {
        const wanted = new Set(names);
        // 只认这一批的名称，避免把并发加的别的 key 当成自己的回滚掉。
        cliAdded = [...after].filter(([id, name]) => !cliBefore.has(id) && wanted.has(name)).map(([id]) => id);
      }
    }
    const added = freshKeys(localAfter, before, names);
    const byName = new Map();
    for (const key of added) if (!byName.has(key.name)) byName.set(key.name, key);
    const ordered = names.map((name) => byName.get(name));
    if (ordered.some((key) => !key) || new Set(ordered.map((k) => k.id)).size !== names.length) {
      throw new Error(
        cliAdded.length
          ? `magpie 写入了 ${cliAdded.length} 把新 key，但插件在 ${keysPath(dir)} 里找不到。配置目录和 magpie 实际使用的不一致，已回滚这批 key。`
          : `新 key 没有全部写进 ${keysPath(dir)}，请检查 magpie 的日志`,
      );
    }

    // 3. 一次读改写：把模板应用到这些 id 上
    const ids = new Set(ordered.map((key) => key.id));
    await updateKeys(dir, (keys) => {
      const now = new Date();
      for (const key of keys) {
        if (!ids.has(key.id)) continue;
        if (off) key.off = true;
        applyTemplate(key, template, now);
      }
    });

    // 4. 以文件里真正存下的为准：迁移可能已经换掉了明文。
    const stored = await readKeys(dir);
    for (const item of ordered) {
      const key = stored.find((k) => k.id === item.id);
      if (!key?.secret) throw new Error(`新 key “${item.name}” 没有写进 ${keysPath(dir)}，请检查 magpie 的日志`);
      created.push({ id: key.id, name: key.name || item.name, secret: key.secret });
    }

    // 5. accounts 走 CLI（magpie 自己校验 provider/account）。
    if (template?.accounts?.length) {
      await runPool(created, ADD_AT_ONCE, (k) => cli.setAccounts(k.id, template.accounts));
    }

    // 6. 交付前验活：magpie 升级时可能迁移密钥格式，发不出去的 key 不如不发。
    if (!off) {
      await runPool(created, VERIFY_AT_ONCE, async (k) => {
        if (await secretWorks(k.secret)) return;
        // 再读一次：迁移可能刚把明文换掉，换成文件里的那个再试。
        const fresh = (await readKeys(dir)).find((x) => x.id === k.id);
        if (fresh?.secret && fresh.secret !== k.secret && (await secretWorks(fresh.secret))) {
          k.secret = fresh.secret;
          return;
        }
        throw new Error(`新 key “${k.name}” 没有被网关认出来（magpie 可能正在迁移密钥格式）`);
      });
    }
    return created;
  } catch (err) {
    // 回滚：按 id/name 找出这一批已经落盘的 key（包括 add 成功但还没进入
    // created 的），全部删掉。
    const all = await readKeys(dir).catch(() => []);
    const rollback = new Set(created.map((k) => k.id));
    for (const key of freshKeys(all, before, names)) rollback.add(key.id);
    // 本地文件里没有、但 magpie 那边确实新增的 key，也要删掉。
    for (const id of cliAdded) rollback.add(id);
    // 回滚失败不能吞掉：留下的是一把 magpie 认得、插件却没有限额记录的 key。
    const stuck = [];
    for (const id of rollback) {
      try {
        await cli.removeKey(id);
      } catch {
        stuck.push(id);
      }
    }
    if (stuck.length) {
      throw new Error(
        `${err?.message || err}；另有 ${stuck.length} 把新 key 回滚失败（${stuck.join("、")}），可能没有限额，请到 magpie 的 Gateway 页面手动删除`,
      );
    }
    throw err;
  }
}

// secretWorks: 网关连得上时，这把 key 必须能自查限额；连不上就不下结论。
async function secretWorks(secret) {
  const { reachable, info } = await gw.keyLimit(secret, { timeout: 2500 });
  return !reachable || !!info?.key;
}

// ---------- 导出 ----------

// 导出由服务端生成：页面只说要导出什么，CSV 不经过浏览器往返，也就不会
// 出现「导出的文件再导入时被加了两层 BOM」这种问题。
async function saveExport(req, res, dir, origin) {
  const body = await readBody(req, 8 * 1024 * 1024);
  const kind = String(body.kind || "keys");
  let csv;
  let fallbackName;
  if (kind === "keys") {
    const period = cleanPeriod(body.period);
    const [keys, defaultId] = await Promise.all([readKeys(dir), defaultKeyId(dir)]);
    // 用量取不到时不要生成「调用 0 / 花费 0」的报表：月底对账会把错误数据
    // 当真。宁可这次导出失败，让用户知道数据源有问题。
    const summary = await usageOr502(() => gw.usage(period));
    const usageMap = new Map((summary.callerKeys || []).map((g) => [g.callerKeyId || g.id, g]));
    const rows = keys.map((k) => {
      const pub = publicKey(k, { defaultId });
      pub.limits = limitList(k);
      pub.usage = usageMap.get(k.id) || {
        calls: 0,
        cost: 0,
        unpriced: 0,
        input: 0,
        output: 0,
        cache_read: 0,
      };
      return pub;
    });
    // 已删除的 key 还在网关的用量里，但不在 caller-keys.json。只导出现存 key
    // 会让这部分花费凭空消失，月底对账对不上；补一行标明「已删除」。
    const known = new Set(keys.map((k) => k.id));
    for (const g of summary.callerKeys || []) {
      const id = g.callerKeyId || g.id;
      if (!id || known.has(id)) continue;
      rows.push({
        id,
        name: `${g.callerKeyName || id}（已删除）`,
        state: "deleted",
        masked: "",
        models: [],
        accounts: [],
        limits: [],
        expires: "",
        usage: g,
      });
    }
    csv = keysCSV(rows, { period });
    fallbackName = `magpie-keys-${period}`;
  } else if (kind === "issued") {
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) throw new ValidationError("没有要导出的密钥", "keys");
    if (keys.length > 1000) throw new ValidationError("一次最多导出 1000 把密钥", "keys");
    const rows = keys.map((k) => ({
      name: cleanName(k?.name),
      secret: String(k?.secret || "").trim(),
    }));
    if (rows.some((k) => !k.secret)) throw new ValidationError("密钥内容不完整", "keys");
    csv = issuedCSV(rows);
    fallbackName = "magpie-issued-keys";
  } else {
    throw new ValidationError("未知的导出类型", "kind");
  }

  const folder = path.join(dataDir(dir), "exports");
  await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, safeExportName(body.name || fallbackName));
  // 文件里只放一层 BOM：Excel 认它，别的工具也不会读出一串 ﻿。
  const bytes = Buffer.byteLength(csv);
  await fsp.writeFile(file, "﻿" + csv, { mode: 0o600 });
  sendJSON(res, 200, { path: file, bytes, name: path.basename(file) }, origin);
}

function cleanPeriod(value) {
  const period = String(value || "7d");
  return ["today", "7d", "30d", "all"].includes(period) ? period : "7d";
}

// 沙箱页面没有 allow-downloads，a[download] 会被静默拦掉。改由宿主的本地
// 服务落盘：文件写在 magpie 的配置目录下，页面把路径交给用户。
function safeExportName(raw) {
  const base = path.basename(String(raw || ""));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "");
  const name = cleaned || "magpie-export";
  const withExt = name.toLowerCase().endsWith(".csv") ? name : `${name}.csv`;
  const stamped = withExt.replace(/\.csv$/i, `-${stamp}.csv`);
  return stamped.slice(0, 120);
}
