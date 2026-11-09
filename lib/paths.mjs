// magpie 的数据目录、密钥文件、CLI 可执行文件的位置。
//
// magpie 自己把配置放在 appdir.Config()：macOS / Linux 是 ~/.config/magpie，
// Windows 是 %APPDATA%\magpie。插件宿主是普通用户进程，直接读同一份文件。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP = "magpie-gateway-admin";

export function configDir() {
  const override = process.env.MAGPIE_ADMIN_CONFIG_DIR || process.env.MAGPIE_CONFIG_DIR;
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "magpie");
  }
  return path.join(os.homedir(), ".config", "magpie");
}

export function keysPath(dir = configDir()) {
  return path.join(dir, "caller-keys.json");
}

export function settingsPath(dir = configDir()) {
  return path.join(dir, "settings.json");
}

// 插件自己的数据（模板、备份）放在 magpie 目录下单独的子目录，便于备份与清理。
export function dataDir(dir = configDir()) {
  return path.join(dir, "plugin-data", APP);
}

export function templatesPath(dir = configDir()) {
  return path.join(dataDir(dir), "templates.json");
}

export function backupDir(dir = configDir()) {
  return path.join(dataDir(dir), "backups");
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// magpieBin 找 magpie 的 CLI。插件宿主继承的是用户环境，PATH 里通常有
// ~/.local/bin/magpie；找不到再试几个常见位置。
export function magpieBin() {
  const explicit = process.env.MAGPIE_BIN;
  if (explicit && isExecutable(explicit)) return explicit;

  const pathEnv = process.env.PATH || "";
  const names = process.platform === "win32" ? ["magpie.exe", "magpie.cmd"] : ["magpie"];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  const home = os.homedir();
  const fallbacks = [
    path.join(home, ".local", "bin", "magpie"),
    "/Applications/magpie.app/Contents/MacOS/magpie",
    "/usr/local/bin/magpie",
    "/opt/homebrew/bin/magpie",
    path.join(home, "Applications", "magpie.app", "Contents", "MacOS", "magpie"),
  ];
  for (const candidate of fallbacks) {
    if (isExecutable(candidate)) return candidate;
  }
  return "";
}

export function gatewayAddr() {
  const raw = (process.env.MAGPIE_ADDR || "127.0.0.1:3425").trim();
  const addr = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return addr.replace(/\/+$/, "");
}
