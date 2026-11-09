// caller-keys.json 的读写：和 magpie 用同一把锁、同一种原子写、同样的 0600。

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { withFileLock } from "./lock.mjs";
import { backupDir, keysPath, settingsPath } from "./paths.mjs";

const MAX_BACKUPS = 20;

export async function readKeys(dir) {
  const file = keysPath(dir);
  let text;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${file} 不是 key 数组`);
  return parsed;
}

export async function readSettings(dir) {
  try {
    const text = await fsp.readFile(settingsPath(dir), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function defaultKeyId(dir) {
  const s = await readSettings(dir);
  return typeof s.lanKeyId === "string" ? s.lanKeyId : "";
}

async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  const fh = await fsp.open(tmp, "w", 0o600);
  try {
    await fh.writeFile(text, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.chmod(tmp, 0o600);
  await fsp.rename(tmp, file);
}

export async function writeKeys(dir, keys) {
  const file = keysPath(dir);
  await backup(dir, file);
  const text = JSON.stringify(keys, null, 2) + "\n";
  await writeAtomic(file, text);
}

// 备份放在插件自己的目录里，不动 magpie 的 backups/。
async function backup(dir, file) {
  try {
    const st = await fsp.stat(file);
    if (st.size === 0) return;
    const target = backupDir(dir);
    await fsp.mkdir(target, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fsp.copyFile(file, path.join(target, `caller-keys-${stamp}.json`));
    const names = (await fsp.readdir(target)).filter((n) => n.startsWith("caller-keys-")).sort();
    for (const old of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) {
      await fsp.unlink(path.join(target, old)).catch(() => {});
    }
  } catch {
    // 备份失败不该挡住写入
  }
}

// updateKeys 在读-改-写全程持锁，和 magpie 的写入串行。
export async function updateKeys(dir, mutate) {
  const lock = keysPath(dir) + ".lock";
  return withFileLock(lock, async () => {
    const keys = await readKeys(dir);
    const result = await mutate(keys);
    await writeKeys(dir, keys);
    return result;
  });
}

export function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 8) return "…";
  if (secret.startsWith("sk-magpie-key-")) return `sk-magpie-key-…${secret.slice(-6)}`;
  if (secret.startsWith("sk-magpie-")) return `sk-magpie-…${secret.slice(-6)}`;
  // magpie 有些版本生成的密钥是 sk-xxxxxx-xxx-…：留前一段，认得出是哪把。
  const head = secret.slice(0, Math.min(9, secret.length - 4));
  return `${head}…${secret.slice(-4)}`;
}

// 对外只给掩码，明文只在新建/轮换的响应里出现一次。
export function publicKey(key, { defaultId = "" } = {}) {
  const out = {
    id: key.id,
    name: key.name || "",
    masked: maskSecret(key.secret || key.masked),
    off: !!key.off,
    lan: !!key.lan,
    default: !!defaultId && key.id === defaultId,
    readOnly: !!key.readOnly,
    browser: !!key.browser,
    quotas: !!key.quotas,
    issues: !!key.issues,
    issuer: key.issuer || "",
    expires: key.expires || "",
    maxConcurrency: key.maxConcurrency || 0,
    models: key.models || [],
    accounts: key.accounts || [],
    limits: limitList(key),
  };
  return out;
}

export function limitList(key) {
  const out = [];
  if (key?.limit) out.push(key.limit);
  if (Array.isArray(key?.moreLimits)) out.push(...key.moreLimits);
  return out;
}

export function findKey(keys, id) {
  return keys.find((k) => k.id === id) || null;
}

export function ensureDataDir(dir) {
  fs.mkdirSync(path.join(dir, "plugin-data", "magpie-gateway-admin"), { recursive: true, mode: 0o700 });
}
