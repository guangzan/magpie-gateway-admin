import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { readKeys } from "../lib/store.mjs";
import { startServer } from "../lib/server.mjs";

// 一个假的 magpie CLI：只实现插件用到的那几条，直接改同一个 caller-keys.json。
const FAKE_CLI = `#!/usr/bin/env python3
import fcntl, json, os, secrets, sys, tempfile

cfg = os.environ["MAGPIE_ADMIN_CONFIG_DIR"]
path = os.path.join(cfg, "caller-keys.json")
os.makedirs(cfg, exist_ok=True)
# 和真 magpie 一样用 flock 串行化读改写；插件会并发 spawn add。
lock = open(path + ".lock", "w")
fcntl.flock(lock, fcntl.LOCK_EX)

def load():
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def save(keys):
    fd, tmp = tempfile.mkstemp(dir=cfg, prefix=".keys-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(keys, f, indent=2)
        f.write("\\n")
    os.replace(tmp, path)

args = sys.argv[2:]
keys = load()

if args[0] == "add":
    name = args[1]
    if name.startswith("boom") or name == "mixed-02":
        sys.exit("boom: injected failure")
    ro = "--read-only" in args
    secret = "sk-magpie-key-" + secrets.token_hex(24)
    # migrate-* 模拟真实 magpie：add 打印一种明文，落盘后立刻换成另一种。
    printed = ("sk-oldformat-" + secrets.token_hex(12)) if name.startswith("migrate") else secret
    keys.append({"id": secrets.token_hex(6), "name": name, "secret": secret, **({"readOnly": True} if ro else {})})
    save(keys)
    print(printed)
elif args[0] == "rotate":
    kid = args[1]
    for k in keys:
        if k["id"] == kid:
            k["secret"] = "sk-magpie-key-" + secrets.token_hex(24)
            print(k["secret"])
            save(keys)
            break
    else:
        sys.exit("Key not found")
elif args[0] == "remove":
    kid = args[1]
    save([k for k in keys if k["id"] != kid])
    print("Gateway key removed")
elif args[0] == "accounts":
    kid, field = args[1], "accounts"
    values = [a for a in args[2:] if a != "all"]
    for k in keys:
        if k["id"] == kid:
            if values:
                k[field] = values
            else:
                k.pop(field, None)
    save(keys)
elif args[0] == "limit":
    # limit <id> reset：只证明命令被转发到了 CLI
    print("ok")
elif args[0] == "list":
    print("ID\\tNAME")
else:
    # 和真的 magpie 一样：不认识的子命令打 usage 并以非零退出。
    sys.stderr.write("usage: magpie gateway-key list | add <name> | accounts <id> ...\\n")
    sys.exit(1)
`;

let dir;
let bin;
let server;
const token = () => server.token;

async function call(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}${pathname}`, {
    method,
    headers: {
      "x-magpie-admin-token": token(),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mpa-server-"));
  bin = path.join(dir, "magpie");
  await fsp.writeFile(bin, FAKE_CLI, { mode: 0o755 });
  process.env.MAGPIE_ADMIN_CONFIG_DIR = dir;
  process.env.MAGPIE_BIN = bin;
  process.env.MAGPIE_ADDR = "127.0.0.1:1";
  server = await startServer({ port: 0, dir });
});

afterAll(async () => {
  await server?.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("server", () => {
  test("api needs the token", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/keys`);
    expect(res.status).toBe(401);
  });

  test("rejects foreign origins and Host headers", async () => {
    const foreign = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { "x-magpie-admin-token": token(), origin: "http://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBe(null);

    const local = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { "x-magpie-admin-token": token(), origin: "http://localhost:5173" },
    });
    expect(local.status).toBe(200);
    expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    // 本机别的端口也不认；magpie web 代理出来的沙箱页面 Origin 是 null。
    const otherPort = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { "x-magpie-admin-token": token(), origin: "http://localhost:9999" },
    });
    expect(otherPort.status).toBe(403);

    const sandboxed = await fetch(`http://127.0.0.1:${server.port}/api/health`, {
      headers: { "x-magpie-admin-token": token(), origin: "null" },
    });
    expect(sandboxed.status).toBe(200);
    expect(sandboxed.headers.get("access-control-allow-origin")).toBe("null");

    const badHost = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/api/ping",
          headers: { host: "evil.example", "x-magpie-admin-token": token() },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(badHost).toBe(421);
  });

  // 界面是 vite 的构建产物，服务只做注入 + 静态托管。
  test("serves the built ui and injects the token", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    // 这一页本来就跑在 magpie 的 sandbox iframe 里，不能禁框；脚本也只能连自己。
    // 也不发 CORP：iframe 的源是 opaque，same-origin 会把构建产物全挡掉。
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).not.toContain("frame-ancestors");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(res.headers.get("cross-origin-resource-policy")).toBeNull();
    const html = await res.text();
    expect(html).toContain(token());
    expect(html).not.toContain("%%TOKEN%%");

    // 构建产物必须完整：index.html 引用的每个资源都要真的能取到。
    const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const file = await fetch(`http://127.0.0.1:${server.port}/${asset}`);
      expect(file.status).toBe(200);
    }
    const js = assets.find((asset) => asset.endsWith(".js"));
    const bundle = await fetch(`http://127.0.0.1:${server.port}/${js}`);
    expect(bundle.headers.get("content-type")).toContain("javascript");
  });

  test("starts empty", async () => {
    const { status, body } = await call("/api/keys?usage=off");
    expect(status).toBe(200);
    expect(body.keys).toEqual([]);
  });

  test("creates a key and never lists its secret", async () => {
    const made = await call("/api/keys", {
      method: "POST",
      body: { name: "Alice", limits: [{ period: "days", days: 1, tokens: 1000, cost: 1 }] },
    });
    expect(made.status).toBe(200);
    const secret = made.body.keys[0].secret;
    expect(secret.startsWith("sk-magpie-key-")).toBe(true);

    const listed = await call("/api/keys?usage=off");
    expect(listed.body.keys.length).toBe(1);
    expect(listed.body.keys[0].masked).not.toBe(secret);
    expect(JSON.stringify(listed.body)).not.toContain(secret);

    const raw = await readKeys(dir);
    expect(raw[0].limit.tokens).toBe(1000);
    expect(raw[0].limit.period).toBe("days");
    expect(raw[0].limit.since).toBeTruthy();
  });

  test("applies expires on a single create", async () => {
    const expires = new Date(Date.now() + 10 * 86400000).toISOString();
    const made = await call("/api/keys", {
      method: "POST",
      body: { name: "Dated", expires, limits: [] },
    });
    expect(made.status).toBe(200);
    const key = (await readKeys(dir)).find((k) => k.name === "Dated");
    expect(key.expires).toBe(expires);
  });

  // 真实 magpie 的 add 会打印一种明文，落盘后很快迁移成另一种；必须按 key 认，
  // 不能按 CLI 打印的明文认，否则会把刚发出去的 key 当成没写进文件。
  test("returns the secret that actually landed after a format migration", async () => {
    const made = await call("/api/keys", {
      method: "POST",
      body: { name: "migrate-one", limits: [] },
    });
    expect(made.status).toBe(200);
    const raw = (await readKeys(dir)).find((k) => k.name === "migrate-one");
    expect(raw.secret.startsWith("sk-magpie-key-")).toBe(true);
    expect(made.body.keys[0].secret).toBe(raw.secret);
  });

  test("batch creates names in order", async () => {
    const made = await call("/api/keys/batch", {
      method: "POST",
      body: { count: 3, namePrefix: "team", startAt: 1, template: { limits: [{ period: "day", tokens: 10 }] } },
    });
    expect(made.status).toBe(200);
    expect(made.body.keys.map((k) => k.name)).toEqual(["team-01", "team-02", "team-03"]);
    const raw = await readKeys(dir);
    expect(raw.filter((k) => k.limit?.tokens === 10).length).toBe(3);
  });

  test("batch is all-or-nothing", async () => {
    const before = (await readKeys(dir)).length;
    const made = await call("/api/keys/batch", {
      method: "POST",
      body: { count: 3, namePrefix: "mixed", startAt: 1, template: {} },
    });
    expect(made.status).toBe(400);
    const after = await readKeys(dir);
    expect(after.length).toBe(before);
    expect(after.some((k) => k.name.startsWith("mixed-"))).toBe(false);
  });

  // 新建页固定三行；填 0 的那两条不写进文件，只留每月 $20。
  test("creates the three fixed windows and drops the empty ones", async () => {
    const made = await call("/api/keys", {
      method: "POST",
      body: {
        name: "Fixed",
        limits: [
          { period: "day", tokens: 0, cost: 0 },
          { period: "month", tokens: 0, cost: 20 },
          { period: "hours", hours: 5, tokens: 0, cost: 0 },
        ],
      },
    });
    expect(made.status).toBe(200);
    const key = (await readKeys(dir)).find((k) => k.name === "Fixed");
    expect(key.limit).toEqual({ period: "month", tokens: 0, cost: 20 });
    expect(key.moreLimits).toBeUndefined();
  });

  // 网关连不上时列表照常返回，额度那列交给界面显示“—”。
  test("lists keys with no budget when the gateway is unreachable", async () => {
    const { status, body } = await call("/api/keys?usage=off");
    expect(status).toBe(200);
    expect(body.keys.every((k) => k.budget === null)).toBe(true);
  });

  test("resets every limit window", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "Alice").id;
    const reset = await call(`/api/keys/${id}/limits/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
    expect(reset.body.key.id).toBe(id);
  });

  test("patches name, off and models", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "Alice").id;
    const patched = await call(`/api/keys/${id}`, {
      method: "PATCH",
      body: { name: "Alice 2", off: true, models: "openai/*" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.key.name).toBe("Alice 2");
    expect(patched.body.key.off).toBe(true);
    expect(patched.body.key.models).toEqual(["openai/*"]);
  });

  // 编辑弹窗会把没改过的账号一起发回来；不能因此去跑一遍 CLI，
  // 否则 magpie 少一个子命令就会把整次保存变成 400。
  test("saves a detail-shaped patch without extra cli calls", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "Alice 2").id;
    const patched = await call(`/api/keys/${id}`, {
      method: "PATCH",
      body: {
        name: "Alice 2",
        off: true,
        expires: null,
        accounts: "",
        models: "openai/*, anthropic/claude-*",
        quotas: false,
        issues: true,
        limits: [{ period: "day", tokens: 50000, cost: 2 }],
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.key.limits).toEqual([{ period: "day", tokens: 50000, cost: 2 }]);
  });

  // 编辑时窗口起点必须接回去，否则改个限额就等于把 7 天额度清空重发。
  test("editing keeps since and cacheReads", async () => {
    const made = await call("/api/keys", {
      method: "POST",
      body: {
        name: "Window",
        limits: [{ period: "days", days: 7, tokens: 1000, cacheReads: true }],
      },
    });
    expect(made.status).toBe(200);
    const id = made.body.keys[0].id;
    const before = (await readKeys(dir)).find((k) => k.id === id).limit;
    expect(before.since).toBeTruthy();
    expect(before.cacheReads).toBe(true);

    // 界面把整行发回来（带 since）和只发周期字段，两种都要保留原窗口。
    const withSince = await call(`/api/keys/${id}`, {
      method: "PATCH",
      body: { limits: [{ period: "days", days: 7, tokens: 2000, cacheReads: true, since: before.since }] },
    });
    expect(withSince.status).toBe(200);
    expect(withSince.body.key.limits[0].since).toBe(before.since);
    expect(withSince.body.key.limits[0].cacheReads).toBe(true);

    const withoutSince = await call(`/api/keys/${id}`, {
      method: "PATCH",
      body: { limits: [{ period: "days", days: 7, tokens: 3000, cacheReads: true }] },
    });
    expect(withoutSince.body.key.limits[0].since).toBe(before.since);
  });

  test("default key cannot be renamed, disabled, expired or made read-only", async () => {
    const settings = path.join(dir, "settings.json");
    const keysFile = path.join(dir, "caller-keys.json");
    const previous = await readKeys(dir);
    await fsp.writeFile(settings, JSON.stringify({ lanKeyId: "dflt" }));
    await fsp.writeFile(
      keysFile,
      JSON.stringify([
        ...previous,
        { id: "dflt", name: "Shared", lan: true, secret: "sk-magpie-key-" + "d".repeat(48) },
      ]),
    );
    try {
      for (const body of [{ name: "x" }, { off: true }, { readOnly: true }, { expires: "2020-01-01" }]) {
        const res = await call("/api/keys/dflt", { method: "PATCH", body });
        expect(res.status).toBe(400);
      }
      // 删除和轮换也必须拦住，否则能绕过上面所有保护。
      expect((await call("/api/keys/dflt", { method: "DELETE" })).status).toBe(409);
      expect((await call("/api/keys/dflt/rotate", { method: "POST" })).status).toBe(409);
    } finally {
      await fsp.rm(settings, { force: true });
      await fsp.writeFile(keysFile, JSON.stringify(previous));
    }
  });

  test("rotates and deletes", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "team-02").id;
    const rotated = await call(`/api/keys/${id}/rotate`, { method: "POST" });
    expect(rotated.body.secret.startsWith("sk-magpie-key-")).toBe(true);

    const removed = await call(`/api/keys/${id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    const left = (await call("/api/keys?usage=off")).body.keys;
    expect(left.some((k) => k.id === id)).toBe(false);
  });

  // 网关暂时不认新密钥时，轮换已经生效了：照常返回明文，只带一句提醒。
  test("rotation hands out the secret even when the gateway lags", async () => {
    const stub = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"key":"","limited":false}');
    });
    await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const prev = process.env.MAGPIE_ADDR;
    process.env.MAGPIE_ADDR = `127.0.0.1:${stub.address().port}`;
    try {
      const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "Alice 2").id;
      await call(`/api/keys/${id}`, { method: "PATCH", body: { off: false } });
      const rotated = await call(`/api/keys/${id}/rotate`, { method: "POST" });
      expect(rotated.status).toBe(200);
      expect(rotated.body.secret.startsWith("sk-magpie-key-")).toBe(true);
      expect(rotated.body.warning).toBeTruthy();
    } finally {
      process.env.MAGPIE_ADDR = prev;
      await new Promise((resolve) => stub.close(resolve));
    }
  });

  test("bulk disables and deletes, reporting every id", async () => {
    const made = await call("/api/keys/batch", {
      method: "POST",
      body: { count: 2, namePrefix: "bulk", startAt: 1, template: {} },
    });
    expect(made.status).toBe(200);
    const ids = made.body.keys.map((k) => k.id);

    const off = await call("/api/keys/bulk", { method: "POST", body: { action: "off", ids } });
    expect(off.status).toBe(200);
    expect(off.body.succeeded).toEqual(ids);
    let rows = (await call("/api/keys?usage=off")).body.keys;
    expect(rows.filter((k) => ids.includes(k.id)).every((k) => k.off)).toBe(true);

    const del = await call("/api/keys/bulk", { method: "POST", body: { action: "delete", ids } });
    expect(del.status).toBe(200);
    expect(del.body.succeeded).toEqual(ids);
    rows = (await call("/api/keys?usage=off")).body.keys;
    expect(rows.some((k) => ids.includes(k.id))).toBe(false);
  });

  test("bulk refuses an unknown action", async () => {
    const res = await call("/api/keys/bulk", { method: "POST", body: { action: "nuke", ids: ["x"] } });
    expect(res.status).toBe(400);
  });

  // 用量取不到时列表返回 usageOk=false 并且不把每把 key 的用量补成 0。
  test("does not fabricate zero usage when the gateway is down", async () => {
    const { status, body } = await call("/api/keys?usage=today");
    expect(status).toBe(200);
    expect(body.usageOk).toBe(false);
    expect(body.warning).toContain("用量");
    expect(body.keys.every((k) => k.usage === undefined)).toBe(true);
  });

  test("ping tells which config dir and version it serves", async () => {
    const pkg = JSON.parse(await fsp.readFile(new URL("../package.json", import.meta.url), "utf8"));
    const res = await fetch(`http://127.0.0.1:${server.port}/api/ping`);
    const body = await res.json();
    expect(body.configDir).toBe(dir);
    expect(body.version).toBe(pkg.version);
    expect(body.pid).toBeGreaterThan(0);
  });

  test("rejects an invalid limit", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys[0].id;
    const bad = await call(`/api/keys/${id}/limits`, { method: "POST", body: { limits: [{ period: "day", tokens: -1 }] } });
    expect(bad.status).toBe(400);
  });

  test("templates keep every window and apply them on create", async () => {
    const saved = await call("/api/templates", {
      method: "POST",
      body: {
        name: "试用",
        template: {
          models: ["openai/*"],
          accounts: ["openai/acct_1"],
          limits: [
            { period: "week", tokens: 500, cacheReads: true },
            { period: "hours", hours: 6, tokens: 1000 },
          ],
          expiresInDays: 7,
          issues: true,
        },
      },
    });
    expect(saved.status).toBe(200);
    const listed = await call("/api/templates");
    const tpl = listed.body.templates[0].template;
    expect(listed.body.templates[0].name).toBe("试用");
    // 模板里的循环窗口不带 since，窗口在创建 key 时才起算。
    expect(tpl.limits).toEqual([
      { period: "week", tokens: 500, cost: 0, cacheReads: true },
      { period: "hours", hours: 6, tokens: 1000, cost: 0 },
    ]);
    expect(tpl.accounts).toEqual(["openai/acct_1"]);
    expect(tpl.issues).toBe(true);
    expect(tpl.expiresInDays).toBe(7);

    const made = await call("/api/keys", {
      method: "POST",
      body: { name: "FromTpl", template: tpl },
    });
    expect(made.status).toBe(200);
    const key = (await readKeys(dir)).find((k) => k.name === "FromTpl");
    expect(key.limit).toMatchObject({ period: "week", tokens: 500, cacheReads: true });
    expect(key.moreLimits[0]).toMatchObject({ period: "hours", hours: 6, tokens: 1000 });
    expect(key.moreLimits[0].since).toBeTruthy();
    expect(key.models).toEqual(["openai/*"]);
    expect(key.accounts).toEqual(["openai/acct_1"]);
    expect(key.issues).toBe(true);
    expect(new Date(key.expires).getTime()).toBeGreaterThan(Date.now());

    await call(`/api/templates/${saved.body.template.id}`, { method: "DELETE" });
    expect((await call("/api/templates")).body.templates).toEqual([]);
  });

  test("passes callerKey through to the gateway", async () => {
    const seen = [];
    const stub = http.createServer((req, res) => {
      seen.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rows: [], total: 0 }));
    });
    await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const prev = process.env.MAGPIE_ADDR;
    process.env.MAGPIE_ADDR = `127.0.0.1:${stub.address().port}`;
    try {
      const { status, body } = await call(
        "/api/usage/requests?period=today&callerKey=key-abc",
      );
      expect(status).toBe(200);
      expect(body.total).toBe(0);
      expect(seen[0]).toContain("callerKey=key-abc");
    } finally {
      process.env.MAGPIE_ADDR = prev;
      await new Promise((resolve) => stub.close(resolve));
    }
  });

  test("health reports the config dir", async () => {
    const { body } = await call("/api/health");
    expect(body.configDir).toBe(dir);
    expect(body.cli.ok).toBe(true);
  });

  // 用量取不到时不生成「调用 0 / 花费 0」的对账文件，宁可这次失败。
  test("refuses a keys export when usage is unavailable", async () => {
    const { status, body } = await call("/api/export", {
      method: "POST",
      body: { kind: "keys", period: "7d" },
    });
    expect(status).toBe(502);
    expect(body.error.kind).toBe("gateway");
  });

  // 沙箱页面不能下载，导出走服务落盘；CSV 由服务端生成，只有一层 BOM。
  test("saves a keys export to disk", async () => {
    const stub = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        '{"calls":1,"unpriced":2,"callerKeys":[{"callerKeyId":"gone","callerKeyName":"已离职","calls":3,"cost":0.5,"input":10,"output":5,"cache_read":0,"unpriced":0}]}',
      );
    });
    await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const prev = process.env.MAGPIE_ADDR;
    process.env.MAGPIE_ADDR = `127.0.0.1:${stub.address().port}`;
    let status;
    let body;
    try {
      ({ status, body } = await call("/api/export", {
        method: "POST",
        body: { kind: "keys", period: "7d", name: "../evil name.csv" },
      }));
    } finally {
      process.env.MAGPIE_ADDR = prev;
      await new Promise((resolve) => stub.close(resolve));
    }
    expect(status).toBe(200);
    expect(body.path.startsWith(path.join(dir, "plugin-data", "magpie-gateway-admin", "exports"))).toBe(true);
    expect(path.basename(body.path)).toMatch(/^evil-name-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    const text = await fsp.readFile(body.path, "utf8");
    expect(text.startsWith("﻿id,name,")).toBe(true);
    expect(text.slice(1)).not.toContain("﻿");
    expect(text).toContain("Alice");
    // 已删除 key 的用量不能因为文件里没有它就消失。
    expect(text).toContain("已离职（已删除）");
    expect(text).toContain(",deleted,");
    const mode = (await fsp.stat(body.path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("exports issued secrets with formula injection escaped", async () => {
    const { status, body } = await call("/api/export", {
      method: "POST",
      body: { kind: "issued", keys: [{ name: "=cmd", secret: "sk-magpie-x" }] },
    });
    expect(status).toBe(200);
    const text = await fsp.readFile(body.path, "utf8");
    expect(text.startsWith("﻿name,secret\n'=cmd,")).toBe(true);
    expect(text.slice(1)).not.toContain("﻿");
  });

  test("rejects an empty export", async () => {
    const { status } = await call("/api/export", { method: "POST", body: { kind: "issued", keys: [] } });
    expect(status).toBe(400);
  });

  test("export is POST only", async () => {
    const { status } = await call("/api/export?period=7d");
    expect(status).toBe(405);
  });
});
