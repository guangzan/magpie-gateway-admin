// 批量发 key 的模板：存在插件自己的数据目录，不碰 magpie 的配置。

import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

import { templatesPath } from "./paths.mjs";
import { cleanConcurrency, cleanExpires, cleanLimits, cleanModels, ValidationError } from "./validate.mjs";

const MAX_TEMPLATES = 40;

async function read(dir) {
  try {
    const text = await fsp.readFile(templatesPath(dir), "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

async function write(dir, templates) {
  const file = templatesPath(dir);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify({ templates }, null, 2) + "\n", { mode: 0o600 });
  await fsp.rename(tmp, file);
}

export function cleanTemplate(input = {}) {
  const template = {
    models: cleanModels(input.models ?? []),
    limits: cleanLimits(input.limits ?? []),
    maxConcurrency: cleanConcurrency(input.maxConcurrency ?? 0),
    readOnly: !!input.readOnly,
    quotas: !!input.quotas,
    issues: !!input.issues,
  };
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (accounts.length) template.accounts = accounts;
  const mcp = (Array.isArray(input.mcp) ? input.mcp : [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (mcp.length) template.mcp = mcp;
  if (input.expiresInDays != null && input.expiresInDays !== "") {
    const days = Number(input.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw new ValidationError("有效天数需要 1 到 3650", "expiresInDays");
    }
    template.expiresInDays = Math.round(days);
  }
  return template;
}

export async function listTemplates(dir) {
  return read(dir);
}

export async function saveTemplate(dir, input) {
  const templates = await read(dir);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw new ValidationError("模板名称需要 1 到 60 个字符", "name");
  const template = cleanTemplate(input.template ?? input);
  const existing = templates.find((t) => t.name === name);
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
}

export async function deleteTemplate(dir, id) {
  const templates = await read(dir);
  const next = templates.filter((t) => t.id !== id);
  if (next.length === templates.length) throw new ValidationError("没有这个模板", "id");
  await write(dir, next);
}

// 把模板落到一把新 key 上。
export function applyTemplate(key, template, now = new Date()) {
  if (!template) return;
  if (Array.isArray(template.models) && template.models.length) key.models = template.models;
  const limits = cleanLimits(template.limits ?? [], now);
  if (limits.length) {
    key.limit = limits[0];
    if (limits.length > 1) key.moreLimits = limits.slice(1);
  }
  if (template.maxConcurrency) key.maxConcurrency = template.maxConcurrency;
  if (template.readOnly) key.readOnly = true;
  if (template.quotas) key.quotas = true;
  if (template.issues) key.issues = true;
  if (template.expiresInDays) {
    const expires = new Date(now.getTime() + template.expiresInDays * 86400000);
    key.expires = expires.toISOString();
  }
}
