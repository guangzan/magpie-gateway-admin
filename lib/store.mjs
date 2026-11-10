// caller-keys.json 的读写：和 magpie 用同一把锁、同一种原子写、同样的 0600。

import fsp from "node:fs/promises";
import path from "node:path";

import { withFileLock } from "./lock.mjs";
import { backupDir, keysPath, settingsPath } from "./paths.mjs";
import { splitLimits } from "./validate.mjs";

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
  let text;
  try {
    text = await fsp.readFile(settingsPath(dir), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  // 读不懂的 settings.json 不能当成空对象：那会把默认共享 key 误判成普通 key，
  // 从而允许改名/停用。宁可让本次操作失败，也不要做危险的猜测。
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${settingsPath(dir)} 不是有效的设置对象`);
  }
  return parsed;
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
  // 目录项的 rename 也要落盘，断电后才不会只剩一个指向旧 inode 的名字。
  try {
    const dh = await fsp.open(path.dirname(file), "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  } catch {
    // 有些平台不允许 fsync 目录；rename 本身已经是原子的
  }
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

// setLimits 把 limits[] 拆回 magpie 存的一个 limit + moreLimits；只有一处实现。
export function setLimits(key, limits) {
  const { limit, moreLimits } = splitLimits(limits);
  if (limit) {
    key.limit = limit;
    if (moreLimits?.length) key.moreLimits = moreLimits;
    else delete key.moreLimits;
  } else {
    delete key.limit;
    delete key.moreLimits;
  }
}

export function findKey(keys, id) {
  return keys.find((k) => k.id === id) || null;
}
