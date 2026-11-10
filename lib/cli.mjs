// 走 magpie 自己的 CLI 做“只有它知道怎么做”的写操作：
// 生成密钥、轮换、删除（含默认 key 的镜像处理）、账号/MCP 校验。

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { magpieBin } from "./paths.mjs";

const run = promisify(execFile);

export class CliError extends Error {
  constructor(message, { stdout = "", stderr = "", code = 0 } = {}) {
    super(message);
    this.name = "CliError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

export function cliAvailable() {
  return magpieBin() !== "";
}

export async function gatewayKey(args, { timeout = 30000 } = {}) {
  const bin = magpieBin();
  if (!bin) {
    throw new CliError("找不到 magpie 命令：把 magpie 放进 PATH，或用 MAGPIE_BIN 指定路径");
  }
  try {
    const { stdout, stderr } = await run(bin, ["gateway-key", ...args], {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const stderr = String(err.stderr || "").trim();
    const stdout = String(err.stdout || "").trim();
    const message = firstLine(stderr) || firstLine(stdout) || err.message;
    throw new CliError(message, { stdout, stderr, code: err.code || 0 });
  }
}

function firstLine(text) {
  const line = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  return line.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /, "");
}

// add 只打印密钥本身；id 由调用方回读文件按 secret 找。
// 密钥前缀各版本不同（旧版 sk-magpie-key-…，新版 sk-<id>-<word>-…），
// 所以只要求最后一行像一把 key，不锁死前缀。
function lastSecret(stdout) {
  const secret = stdout.split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
  return secret.startsWith("sk-") && !/\s/.test(secret) ? secret : "";
}

export async function addKey(name, { readOnly = false } = {}) {
  const args = ["add", name];
  if (readOnly) args.push("--read-only");
  const { stdout } = await gatewayKey(args);
  const secret = lastSecret(stdout);
  if (!secret) {
    throw new CliError(`magpie 没有返回密钥：${stdout || "(空)"}`);
  }
  return secret;
}

export async function rotateKey(id) {
  const { stdout } = await gatewayKey(["rotate", id]);
  const secret = lastSecret(stdout);
  if (!secret) {
    throw new CliError(`magpie 没有返回新密钥：${stdout || "(空)"}`);
  }
  return secret;
}

export async function removeKey(id) {
  await gatewayKey(["remove", id]);
}

// magpie 实际认的 key（id → 名称）。创建/回滚时用它核对「CLI 写进的
// 是不是插件读的那个 caller-keys.json」：两边目录不一致时，不能只按本地
// 文件回滚，否则 magpie 那边会留下没有限额的孤儿 key。
export async function listKeys() {
  const { stdout } = await gatewayKey(["list"]);
  const keys = new Map();
  for (const line of stdout.split("\n").slice(1)) {
    const cols = line.split(/\t+|\s{2,}/).map((s) => s.trim());
    if (cols[0]) keys.set(cols[0], cols[1] || "");
  }
  return keys;
}

// resetLimits 把每一条限额的已用量清零；日历窗口（每天/每月）的结束时间不变。
export async function resetLimits(id) {
  await gatewayKey(["limit", id, "reset"]);
}

export async function setAccounts(id, accounts) {
  await gatewayKey(["accounts", id, ...(accounts.length ? accounts : ["all"])]);
}
