// 批量发 key 的模板：存在插件自己的数据目录，不碰 magpie 的配置。

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { NotFoundError } from "./errors.mjs";
import { withFileLock } from "./lock.mjs";
import { templatesPath } from "./paths.mjs";
import { setLimits } from "./store.mjs";
import { cleanExpires, cleanLimits, cleanModels, ValidationError } from "./validate.mjs";

const MAX_TEMPLATES = 40;

async function read(dir) {
  let text;
  try {
    text = await fsp.readFile(templatesPath(dir), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  if (!text.trim()) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.templates)) {
    throw new Error(`${templatesPath(dir)} 不是有效的模板文件`);
  }
  return parsed.templates;
}

async function write(dir, templates) {
  const file = templatesPath(dir);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  const fh = await fsp.open(tmp, "w", 0o600);
  try {
    await fh.writeFile(JSON.stringify({ templates }, null, 2) + "\n", "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

function normalizeAccounts(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[\n,]/)
      : [];
  return list.map((s) => String(s).trim()).filter(Boolean);
}

export function cleanTemplate(input = {}) {
  // since 是某一把 key 的窗口起点，不能跟着模板复用；模板只存相对定义。
  const limits = cleanLimits(input.limits ?? []).map((limit) => {
    const copy = { ...limit };
    delete copy.since;
    return copy;
  });
  const template = {
    models: cleanModels(input.models ?? []),
    limits,
    readOnly: !!input.readOnly,
    quotas: !!input.quotas,
    issues: !!input.issues,
  };
  const accounts = normalizeAccounts(input.accounts);
  if (accounts.length) template.accounts = accounts;
  if (input.expiresInDays != null && input.expiresInDays !== "") {
    const days = Number(input.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw new ValidationError("有效天数需要 1 到 3650", "expiresInDays");
    }
    template.expiresInDays = Math.round(days);
  }
  if (input.expires != null && input.expires !== "") {
    // 只给「单把新建」用：模板文件不保存绝对时间（保存时会重新验证）。
    template.expires = cleanExpires(input.expires).toISOString();
  }
  return template;
}

export async function listTemplates(dir) {
  return read(dir);
}

export async function saveTemplate(dir, input) {
  const lock = templatesPath(dir) + ".lock";
  return withFileLock(lock, async () => {
    const templates = await read(dir);
    const name = String(input.name ?? "").trim();
    if (!name || name.length > 60) throw new ValidationError("模板名称需要 1 到 60 个字符", "name");
    const template = cleanTemplate(input.template ?? input);
    // 按 id 更新（改名也不算新建）；旧调用方只给 name 时保持原来的覆盖语义。
    const id = String(input.id ?? "").trim();
    const existing = id
      ? templates.find((t) => t.id === id)
      : templates.find((t) => t.name === name);
    if (id && !existing) throw new NotFoundError("没有这个模板", { field: "id" });
    if (templates.some((t) => t.name === name && t.id !== existing?.id)) {
      throw new ValidationError(`已经有同名模板：${name}`, "name");
    }
    const entry = {
      id: existing?.id || crypto.randomBytes(6).toString("hex"),
      name,
      template,
      updatedAt: new Date().toISOString(),
    };
    const next = existing ? templates.map((t) => (t.id === entry.id ? entry : t)) : [...templates, entry];
    if (next.length > MAX_TEMPLATES) throw new ValidationError(`最多 ${MAX_TEMPLATES} 个模板`, "templates");
    await write(dir, next);
    return entry;
  });
}

export async function deleteTemplate(dir, id) {
  const lock = templatesPath(dir) + ".lock";
  await withFileLock(lock, async () => {
    const templates = await read(dir);
    const next = templates.filter((t) => t.id !== id);
    if (next.length === templates.length) throw new NotFoundError("没有这个模板", { field: "id" });
    await write(dir, next);
  });
}

// 把模板落到一把新 key 上。
export function applyTemplate(key, template, now = new Date()) {
  if (!template) return;
  if (Array.isArray(template.models) && template.models.length) key.models = template.models;
  const limits = cleanLimits(template.limits ?? [], now);
  if (limits.length) setLimits(key, limits);
  if (template.readOnly) key.readOnly = true;
  if (template.quotas) key.quotas = true;
  if (template.issues) key.issues = true;
  if (template.expiresInDays) {
    const expires = new Date(now.getTime() + template.expiresInDays * 86400000);
    key.expires = expires.toISOString();
  }
  if (template.expires) key.expires = template.expires;
}
