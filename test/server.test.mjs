import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { readKeys } from "../lib/store.mjs";
import { startServer } from "../lib/server.mjs";

// 一个假的 magpie CLI：只实现插件用到的那几条，直接改同一个 caller-keys.json。
const FAKE_CLI = `#!/usr/bin/env python3
import json, os, secrets, sys

cfg = os.environ["MAGPIE_ADMIN_CONFIG_DIR"]
path = os.path.join(cfg, "caller-keys.json")

def load():
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def save(keys):
    os.makedirs(cfg, exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(keys, f, indent=2)
        f.write("\\n")
    os.replace(path + ".tmp", path)

args = sys.argv[2:]
keys = load()

if args[0] == "add":
    name = args[1]
    ro = "--read-only" in args
    secret = "sk-magpie-key-" + secrets.token_hex(24)
    keys.append({"id": secrets.token_hex(6), "name": name, "secret": secret, **({"readOnly": True} if ro else {})})
    save(keys)
    print(secret)
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

  // 界面是 vite 的构建产物，服务只做注入 + 静态托管。
  test("serves the built ui and injects the token", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(token());
    expect(html).not.toContain("%%TOKEN%%");

    const asset = html.match(/\/assets\/[A-Za-z0-9._-]+\.js/)?.[0];
    if (asset) {
      const js = await fetch(`http://127.0.0.1:${server.port}${asset}`);
      expect(js.status).toBe(200);
      expect(js.headers.get("content-type")).toContain("javascript");
    }
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

  test("batch creates names in order", async () => {
    const made = await call("/api/keys/batch", {
      method: "POST",
      body: { count: 3, namePrefix: "team", startAt: 1, template: { maxConcurrency: 2 } },
    });
    expect(made.status).toBe(200);
    expect(made.body.keys.map((k) => k.name)).toEqual(["team-01", "team-02", "team-03"]);
    const raw = await readKeys(dir);
    expect(raw.filter((k) => k.maxConcurrency === 2).length).toBe(3);
  });

  test("patches name, off and models", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys.find((k) => k.name === "Alice").id;
    const patched = await call(`/api/keys/${id}`, {
      method: "PATCH",
      body: { name: "Alice 2", off: true, models: "openai/*", maxConcurrency: 4 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.key.name).toBe("Alice 2");
    expect(patched.body.key.off).toBe(true);
    expect(patched.body.key.models).toEqual(["openai/*"]);
    expect(patched.body.key.maxConcurrency).toBe(4);
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
        maxConcurrency: 4,
        quotas: false,
        issues: true,
        limits: [{ period: "day", tokens: 50000, cost: 2 }],
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.key.limits).toEqual([{ period: "day", tokens: 50000, cost: 2 }]);
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

  test("rejects an invalid limit", async () => {
    const id = (await call("/api/keys?usage=off")).body.keys[0].id;
    const bad = await call(`/api/keys/${id}/limits`, { method: "POST", body: { limits: [{ period: "day", tokens: -1 }] } });
    expect(bad.status).toBe(400);
  });

  test("templates round-trip", async () => {
    const saved = await call("/api/templates", {
      method: "POST",
      body: { name: "试用", template: { limits: [{ period: "day", tokens: 500 }], maxConcurrency: 1 } },
    });
    expect(saved.status).toBe(200);
    const listed = await call("/api/templates");
    expect(listed.body.templates[0].name).toBe("试用");
    await call(`/api/templates/${saved.body.template.id}`, { method: "DELETE" });
    expect((await call("/api/templates")).body.templates).toEqual([]);
  });

  test("health reports the config dir", async () => {
    const { body } = await call("/api/health");
    expect(body.configDir).toBe(dir);
    expect(body.cli.ok).toBe(true);
  });

  // 沙箱页面不能下载，导出走服务落盘。
  test("saves an export to disk", async () => {
    const { status, body } = await call("/api/export", {
      method: "POST",
      body: { name: "../evil name.csv", csv: "name,secret\na,b\n" },
    });
    expect(status).toBe(200);
    expect(body.path.startsWith(path.join(dir, "plugin-data", "magpie-gateway-admin", "exports"))).toBe(true);
    expect(path.basename(body.path)).toBe("evil-name.csv");
    const text = await fsp.readFile(body.path, "utf8");
    expect(text).toContain("a,b");
    const mode = (await fsp.stat(body.path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("rejects an empty export", async () => {
    const { status } = await call("/api/export", { method: "POST", body: { name: "x.csv", csv: "  " } });
    expect(status).toBe(400);
  });
});
