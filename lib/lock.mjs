// caller-keys.json 的互斥锁。
//
// magpie 自己用 internal/filelock 锁 caller-keys.json.lock（flock 语义），
// 所以这里也锁同一个文件、用同一种锁，跨进程才互斥。macOS 和 Linux 都
// 通过 bun:ffi 调 libc 的 flock(2)；Windows 没有 flock，退化成插件自己的
// 锁文件（只能保证本插件自身互斥，不会和 magpie 抢同一个文件）。

import fs from "node:fs";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

let flockPromise;

function loadFlock() {
  if (process.platform === "win32") return Promise.resolve(null);
  return (async () => {
    try {
      const { dlopen, FFIType } = await import("bun:ffi");
      const candidates =
        process.platform === "darwin"
          ? ["/usr/lib/libSystem.B.dylib"]
          : ["libc.so.6", "libc.so"];
      for (const lib of candidates) {
        try {
          const { symbols } = dlopen(lib, {
            flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
          });
          if (symbols.flock) return symbols.flock;
        } catch {
          // 换下一个库名
        }
      }
      return null;
    } catch {
      // 不是 Bun，或者 libc 名字对不上：走下面的退化实现
      return null;
    }
  })();
}

const flockOf = () => (flockPromise ??= loadFlock());

// 持锁的一方要 await 异步 IO，同一个事件循环里直接抢第二次会把自己锁死：
// 进程内先排一次队，只有跨进程才靠 flock。
const queues = new Map();

async function inProcessQueue(lockPath, fn) {
  const prev = queues.get(lockPath) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const tail = prev.then(() => gate);
  queues.set(lockPath, tail);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(lockPath) === tail) queues.delete(lockPath);
  }
}

export async function withFileLock(lockPath, fn, { timeoutMs = 15000, pollMs = 25 } = {}) {
  return inProcessQueue(lockPath, () => acquire(lockPath, fn, { timeoutMs, pollMs }));
}

async function acquire(lockPath, fn, { timeoutMs, pollMs }) {
  const flock = await flockOf();
  if (flock) return await withFlock(flock, lockPath, fn, { timeoutMs, pollMs });
  return await withOwnLockFile(lockPath, fn, { timeoutMs, pollMs });
}

// 和 magpie 锁同一个文件：存在就复用，不删；拿不到就轮询到超时。
async function withFlock(flock, lockPath, fn, { timeoutMs, pollMs }) {
  const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_RDWR, 0o600);
  try {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (flock(fd, LOCK_EX | LOCK_NB) === 0) break;
      if (Date.now() > deadline) throw new Error(`等待 ${lockPath} 超时`);
      await new Promise((r) => setTimeout(r, pollMs));
    }
    try {
      return await fn();
    } finally {
      try {
        flock(fd, LOCK_UN);
      } catch {
        // 进程退出时内核也会释放
      }
    }
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

// Windows（或没有 bun:ffi）退化：用插件自己的锁文件，不和 magpie 的
// caller-keys.json.lock 抢名字——那个文件是常驻的，O_EXCL 会永远失败。
async function withOwnLockFile(lockPath, fn, { timeoutMs, pollMs }) {
  const own = `${lockPath}.mpa`;
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(own, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o600);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() > deadline) throw new Error(`等待 ${own} 超时`);
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        const st = fs.statSync(own);
        if (Date.now() - st.mtimeMs > timeoutMs * 4) fs.unlinkSync(own);
      } catch {
        // 别人刚释放
      }
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(own);
    } catch {
      // ignore
    }
  }
}
