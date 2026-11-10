import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { configDir, gatewayAddr, keysPath, portableDir } from "../lib/paths.mjs";

// paths.mjs 每次都读 process.env（portMemo 以目录为键），所以测试里直接改环境变量。
const ENV = ["MAGPIE_ADMIN_CONFIG_DIR", "MAGPIE_CONFIG_DIR", "XDG_CONFIG_HOME", "MAGPIE_BIN", "MAGPIE_ADDR", "HOME"];
let saved;
let dir;

beforeEach(async () => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  // mkdtemp 在 macOS 上给的是 /var/...，paths.mjs 用 realpath 比较目录。
  dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mpa-paths-")));
  for (const name of ENV) delete process.env[name];
  process.env.HOME = path.join(dir, "home");
  await fsp.mkdir(process.env.HOME, { recursive: true });
});

afterEach(async () => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("configDir", () => {
  test("honours the plugin override", () => {
    process.env.MAGPIE_ADMIN_CONFIG_DIR = path.join(dir, "custom");
    expect(configDir()).toBe(path.join(dir, "custom"));
    expect(keysPath()).toBe(path.join(dir, "custom", "caller-keys.json"));
  });

  test("follows XDG_CONFIG_HOME", () => {
    process.env.XDG_CONFIG_HOME = path.join(dir, "xdg");
    expect(configDir()).toBe(path.join(dir, "xdg", "magpie"));
  });

  test("falls back to ~/.config/magpie", () => {
    expect(configDir()).toBe(path.join(process.env.HOME, ".config", "magpie"));
  });

  test("prefers a portable data/ beside the CLI", async () => {
    const binDir = path.join(dir, "portable");
    await fsp.mkdir(path.join(binDir, "data"), { recursive: true });
    const bin = path.join(binDir, "magpie");
    await fsp.writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
    process.env.MAGPIE_BIN = bin;
    expect(portableDir()).toBe(path.join(binDir, "data"));
    expect(configDir()).toBe(path.join(binDir, "data"));
  });

  test("a .portable marker is enough", async () => {
    const binDir = path.join(dir, "marked");
    await fsp.mkdir(binDir, { recursive: true });
    const bin = path.join(binDir, "magpie");
    await fsp.writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
    await fsp.writeFile(path.join(binDir, ".portable"), "");
    process.env.MAGPIE_BIN = bin;
    expect(portableDir()).toBe(path.join(binDir, "data"));
  });

  test("ignores an unrelated data/ in a shared folder", async () => {
    const binDir = path.join(process.env.HOME, "Downloads");
    await fsp.mkdir(path.join(binDir, "data"), { recursive: true });
    const bin = path.join(binDir, "magpie");
    await fsp.writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
    process.env.MAGPIE_BIN = bin;
    expect(portableDir()).toBe("");
  });

  test("takes a shared folder data/ that already holds magpie files", async () => {
    // 和 magpie 的 shared() 一致：共享目录里已经有 magpie 的文件，就当 portable。
    const binDir = path.join(process.env.HOME, "Downloads");
    await fsp.mkdir(path.join(binDir, "data"), { recursive: true });
    await fsp.writeFile(path.join(binDir, "data", "settings.json"), "{}");
    const bin = path.join(binDir, "magpie");
    await fsp.writeFile(bin, "#!/bin/sh\n", { mode: 0o755 });
    process.env.MAGPIE_BIN = bin;
    expect(portableDir()).toBe(path.join(binDir, "data"));
  });
});

describe("gatewayAddr", () => {
  test("reads the port from settings.json", async () => {
    const cfg = path.join(dir, "cfg");
    await fsp.mkdir(cfg, { recursive: true });
    await fsp.writeFile(path.join(cfg, "settings.json"), JSON.stringify({ port: 4001 }));
    process.env.MAGPIE_ADMIN_CONFIG_DIR = cfg;
    expect(gatewayAddr()).toBe("http://127.0.0.1:4001");
  });

  test("MAGPIE_ADDR wins and wildcard hosts become loopback", () => {
    process.env.MAGPIE_ADDR = "0.0.0.0:5000";
    expect(gatewayAddr()).toBe("http://127.0.0.1:5000");
    process.env.MAGPIE_ADDR = ":5001";
    expect(gatewayAddr()).toBe("http://127.0.0.1:5001");
    process.env.MAGPIE_ADDR = "https://gw.example/";
    expect(gatewayAddr()).toBe("https://gw.example");
  });
});

