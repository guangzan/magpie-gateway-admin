// magpie 的数据目录、密钥文件、CLI 可执行文件的位置。
//
// 这些位置必须和 magpie 自己算出来的一致：magpie 0.1.3078 的 appdir 是
// 「可执行文件旁的 data/（portable）→ XDG_CONFIG_HOME/magpie → ~/.config/magpie」，
// Windows 的 home 是 USERPROFILE，不是 APPDATA。插件以前只认 ~/.config/magpie
// 和 %APPDATA%，在 XDG / portable / Windows 上会读写另一份文件，这里对齐
// internal/appdir/{appdir,env}.go。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP = "magpie-gateway-admin";
const DEFAULT_GATEWAY_PORT = 3425;
// magpie 判断一个 data/ 是不是自己的，看的就是这几个文件。
const MAGPIE_FILES = ["providers.json", "logins.json", "settings.json"];

function absEnv(name) {
  const value = process.env[name];
  return value && path.isAbsolute(value) ? value : "";
}

// magpie 的 Home()：Windows 看 USERPROFILE，其它看 HOME。
function homeDir() {
  const fromEnv = absEnv(process.platform === "win32" ? "USERPROFILE" : "HOME");
  return fromEnv || os.homedir();
}

function realpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

// magpie 的 Beside()：可执行文件所在目录；macOS 的 .app 是看 .app 所在的目录。
// AppImage 运行时 exe 在临时挂载点里，真正的「旁边」是 .AppImage 文件所在目录。
function beside(exe) {
  if (process.platform === "linux") {
    const image = process.env.APPIMAGE;
    const appdir = process.env.APPDIR;
    if (image && withinPath(exe, appdir)) return path.dirname(image);
  }
  let dir = path.dirname(realpath(exe));
  const mac = dir.match(/^(.*)[/\\][^/\\]+\.app[/\\]Contents[/\\]MacOS$/i);
  if (mac) dir = mac[1];
  return dir;
}

function withinPath(file, dir) {
  if (!dir || !path.isAbsolute(dir)) return false;
  const rel = path.relative(dir, path.resolve(file));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

// 每个应用/下载共享的目录：里面的 data/ 不能默认当成 magpie 的（会误伤别人）。
function sharedFolder(dir) {
  const home = homeDir();
  const list = [home, path.join(home, "Downloads"), path.join(home, "Desktop"), path.join(home, "Documents")];
  if (process.platform === "darwin") {
    list.push("/Applications", path.join(home, "Applications"));
  }
  return list.some((candidate) => samePath(candidate, dir));
}

// magpie 的 UserFolder()：系统实际保存 Downloads / Desktop / Documents 的位置。
// Linux 读 user-dirs.dirs（中文桌面是 ~/下载），Windows 读注册表已知文件夹
// （OneDrive 会把它们搬到别的盘），macOS 固定在 home/kind。
const USER_FOLDERS = {
  Downloads: { xdg: "XDG_DOWNLOAD_DIR", win: "{374DE290-123F-4565-9164-39C4925E467B}" },
  Desktop: { xdg: "XDG_DESKTOP_DIR", win: "Desktop" },
  Documents: { xdg: "XDG_DOCUMENTS_DIR", win: "Personal" },
};

function userFolder(kind) {
  const home = homeDir();
  const names = USER_FOLDERS[kind];
  if (!names) return "";
  if (process.platform === "win32") return windowsUserFolder(home, kind) || path.join(home, kind);
  if (process.platform !== "darwin") return xdgUserFolder(home, kind) || path.join(home, kind);
  return path.join(home, kind);
}

// 和 magpie 的 xdgUserDir 一致：只认带引号的 "$HOME/…" 或绝对路径，最后一行生效。
function xdgUserFolder(home, kind) {
  const name = USER_FOLDERS[kind]?.xdg;
  if (!name) return "";
  const cfg = absEnv("XDG_CONFIG_HOME") || path.join(home, ".config");
  let text = "";
  try {
    text = fs.readFileSync(path.join(cfg, "user-dirs.dirs"), "utf8");
  } catch {
    return "";
  }
  let got = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== name) continue;
    const value = xdgValue(home, line.slice(eq + 1).trim());
    if (value) got = value;
  }
  return got;
}

function xdgValue(home, quoted) {
  if (quoted.length < 2 || quoted[0] !== '"' || quoted[quoted.length - 1] !== '"') return "";
  let out = "";
  for (let i = 1; i < quoted.length - 1; i++) {
    if (quoted[i] === "\\" && i + 1 < quoted.length - 1) i++;
    out += quoted[i];
  }
  if (out === "$HOME") return home;
  if (out.startsWith("$HOME/")) return path.join(home, out.slice(6));
  if (path.isAbsolute(out)) return path.resolve(out);
  return "";
}

// reg query 读已知文件夹；值里可能有 %USERPROFILE% / %OneDrive%，按当前环境展开。
function windowsFolderValue(id) {
  let out = "";
  try {
    out = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
        "/v",
        id,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 3000 },
    );
  } catch {
    return "";
  }
  const line = out.split(/\r?\n/).find((l) => l.includes("REG_"));
  if (!line) return "";
  const value = line.split(/\s{2,}|\t/).filter(Boolean).pop() || "";
  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const found = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return found ? process.env[found] : whole;
  });
}

// magpie 只在「已知文件夹属于当前 home」时才用它；USERPROFILE 被指到别处时
// 已知文件夹是另一个用户的，要回落到 home/kind。
function windowsUserFolder(home, kind) {
  const id = USER_FOLDERS[kind]?.win;
  if (!id) return "";
  const profile = windowsFolderValue("{5E6C858F-0E22-4760-9AFE-EA3317B67173}");
  if (profile && !samePath(profile, home)) return "";
  const dir = windowsFolderValue(id);
  return dir && path.isAbsolute(dir) ? dir : "";
}

// magpie 的 movedFolder()：系统把用户文件夹搬离 home 时的实际位置。
// 这类目录里的 data/ 只有在装着 magpie 自己的文件时才当成 portable。
function movedFolder(dir) {
  return Object.keys(USER_FOLDERS).some((kind) => {
    const candidate = userFolder(kind);
    return candidate !== "" && samePath(candidate, dir);
  });
}

// magpie 的 shared()：共享目录里的 data/ 默认不是 magpie 的，除非它已经装着
// magpie 的文件且安装目录没有；被系统搬走的用户文件夹则只看 data/ 里有没有文件。
function sharedData(base, data) {
  if (sharedFolder(base)) {
    if (!holdsMagpieFiles(data)) return true;
    const installed = installedDir();
    return installed !== "" && holdsMagpieFiles(installed);
  }
  if (movedFolder(base)) return !holdsMagpieFiles(data);
  return false;
}

function holdsMagpieFiles(dir) {
  return MAGPIE_FILES.some((name) => {
    try {
      return fs.statSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}

function installedDir() {
  const xdg = absEnv("XDG_CONFIG_HOME");
  return xdg ? path.join(xdg, "magpie") : path.join(homeDir(), ".config", "magpie");
}

// portableDir 是 magpie 的 data 文件夹，没有 portable 时是 ""。
export function portableDir() {
  const bin = magpieBin();
  if (!bin) return "";
  const base = beside(bin);
  const data = path.join(base, "data");
  const marker = (() => {
    try {
      return fs.statSync(path.join(base, ".portable")).isFile();
    } catch {
      return false;
    }
  })();
  const hasData = (() => {
    try {
      return fs.statSync(data).isDirectory();
    } catch {
      return false;
    }
  })();
  if (marker) return data;
  if (!hasData) return "";
  return sharedData(base, data) ? "" : data;
}

export function configDir() {
  const override = absEnv("MAGPIE_ADMIN_CONFIG_DIR") || absEnv("MAGPIE_CONFIG_DIR");
  if (override) return path.resolve(override);
  const portable = portableDir();
  if (portable) return portable;
  return installedDir();
}

export function keysPath(dir = configDir()) {
  return path.join(dir, "caller-keys.json");
}

export function settingsPath(dir = configDir()) {
  return path.join(dir, "settings.json");
}

// 插件自己的数据（模板、备份、导出）放在 magpie 目录下单独的子目录，便于备份与清理。
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

  const home = homeDir();
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

// settingsPort 读 magpie 的 settings.json；用户把网关换过端口（3425 被占）时
// 插件必须跟着换，否则用量/限额全部静默失败。短缓存：列表会为每把 key 取地址。
let portMemo = { at: 0, dir: "", port: 0 };

function settingsPort(dir) {
  const now = Date.now();
  if (portMemo.dir === dir && now - portMemo.at < 2000) return portMemo.port;
  let port = 0;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(dir), "utf8"));
    const n = Math.trunc(Number(settings?.port));
    if (Number.isInteger(n) && n > 0 && n < 65536) port = n;
  } catch {
    // 没有 settings.json 或读不懂：用默认端口
  }
  portMemo = { at: now, dir, port };
  return port;
}

function normalizeGatewayAddr(raw) {
  let text = raw.trim();
  if (/^:\d+$/.test(text)) text = `127.0.0.1${text}`;
  if (!/^[a-z]+:\/\//i.test(text)) text = `http://${text}`;
  try {
    const url = new URL(text);
    // MAGPIE_ADDR=0.0.0.0:3425 时，本机客户端应该连 127.0.0.1。
    if (url.hostname === "0.0.0.0" || url.hostname === "::" || url.hostname === "[::]") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return text.replace(/\/+$/, "");
  }
}

export function gatewayAddr() {
  const raw = (process.env.MAGPIE_ADDR || "").trim();
  if (raw) return normalizeGatewayAddr(raw);
  const port = settingsPort(configDir()) || DEFAULT_GATEWAY_PORT;
  return `http://127.0.0.1:${port}`;
}
