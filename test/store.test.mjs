import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { maskSecret, readSettings, readKeys, setLimits, updateKeys, writeKeys } from "../lib/store.mjs";

let dir;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mpa-store-"));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe("store", () => {
  test("missing file reads as no keys", async () => {
    expect(await readKeys(dir)).toEqual([]);
  });

  test("writes 0600 and keeps unicode", async () => {
    await writeKeys(dir, [{ id: "a1", name: "张三", secret: "sk-magpie-key-" + "a".repeat(48) }]);
    const st = await fsp.stat(path.join(dir, "caller-keys.json"));
    expect(st.mode & 0o777).toBe(0o600);
    const keys = await readKeys(dir);
    expect(keys[0].name).toBe("张三");
  });

  test("concurrent updates do not lose a key", async () => {
    await writeKeys(dir, []);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateKeys(dir, (keys) => {
          keys.push({ id: `k${i}`, name: `n${i}`, secret: `sk-magpie-key-${String(i).repeat(48).slice(0, 48)}` });
        }),
      ),
    );
    expect((await readKeys(dir)).length).toBe(8);
  });

  // magpie 的 .lock 文件用完不删；它不该让插件的写操作卡住。
  test("writes while magpie's lock file is already there", async () => {
    await fsp.writeFile(path.join(dir, "caller-keys.json.lock"), "");
    await updateKeys(dir, (keys) => {
      keys.push({ id: "leftover", name: "留着的锁", secret: "sk-magpie-key-" + "b".repeat(48) });
    });
    expect((await readKeys(dir))[0].name).toBe("留着的锁");
  });

  // 读不懂的 settings.json 不能被当成空对象，否则默认共享 key 会被当成普通 key。
  test("corrupt settings throw instead of guessing", async () => {
    await fsp.writeFile(path.join(dir, "settings.json"), "{oops");
    await expect(readSettings(dir)).rejects.toThrow();
    await fsp.writeFile(path.join(dir, "settings.json"), "[]");
    await expect(readSettings(dir)).rejects.toThrow();
  });

  test("setLimits splits into limit and moreLimits", () => {
    const key = {};
    setLimits(key, [
      { period: "day", tokens: 1, cost: 0 },
      { period: "week", tokens: 2, cost: 0 },
    ]);
    expect(key.limit.period).toBe("day");
    expect(key.moreLimits).toEqual([{ period: "week", tokens: 2, cost: 0 }]);
    setLimits(key, []);
    expect(key.limit).toBeUndefined();
    expect(key.moreLimits).toBeUndefined();
  });

  test("masking never reveals the middle", () => {
    const secret = "sk-magpie-key-" + "0123456789abcdef".repeat(3);
    const masked = maskSecret(secret);
    expect(masked.startsWith("sk-magpie-key-…")).toBe(true);
    expect(masked.endsWith(secret.slice(-6))).toBe(true);
    expect(masked).not.toContain(secret.slice(20, 30));
  });
});
