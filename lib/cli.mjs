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
export async function addKey(name, { readOnly = false } = {}) {
  const args = ["add", name];
  if (readOnly) args.push("--read-only");
  const { stdout } = await gatewayKey(args);
  const secret = stdout.split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
  if (!secret.startsWith("sk-magpie-")) {
    throw new CliError(`magpie 没有返回密钥：${stdout || "(空)"}`);
  }
  return secret;
}

export async function rotateKey(id) {
  const { stdout } = await gatewayKey(["rotate", id]);
  const secret = stdout.split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
  if (!secret.startsWith("sk-magpie-")) {
    throw new CliError(`magpie 没有返回新密钥：${stdout || "(空)"}`);
  }
  return secret;
}

export async function removeKey(id) {
  await gatewayKey(["remove", id]);
}

export async function setAccounts(id, accounts) {
  await gatewayKey(["accounts", id, ...(accounts.length ? accounts : ["all"])]);
}

// listRaw 用来确认写进文件的配置 magpie 自己读得懂。
export async function listRaw() {
  const { stdout } = await gatewayKey(["list"]);
  return stdout;
}
