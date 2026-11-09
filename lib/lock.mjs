// caller-keys.json 的互斥锁。
//
// magpie 自己用 internal/filelock（flock 语义）锁 caller-keys.json.lock，
// 所以这里也必须锁同一个文件、用同一套语义，否则会互相踩。
// macOS/BSD 上 O_EXLOCK 打开即加排他锁，关掉即释放，和 flock 互斥。

import fs from "node:fs";

const O_EXLOCK = 0x20; // macOS / FreeBSD
const hasExclusiveOpen = process.platform === "darwin" || process.platform === "freebsd";

// O_EXLOCK 是阻塞的，而持锁的一方要 await 异步 IO：同一个事件循环里直接
// 抢第二次会把自己锁死。所以进程内先排一次队，只有跨进程才靠 flock。
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
  if (hasExclusiveOpen) {
    const fd = fs.openSync(
      lockPath,
      fs.constants.O_CREAT | fs.constants.O_RDWR | O_EXLOCK,
      0o600,
    );
    try {
      return await fn();
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // 进程退出时内核也会释放
      }
    }
  }

  // 其它平台没有 O_EXLOCK：用 O_EXCL 建锁文件 + 超时重试的退化实现。
  // 只保证本插件自身互斥；和 magpie 的 flock 不互斥，README 里写明了。
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o600);
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (Date.now() > deadline) throw new Error(`等待 ${lockPath} 超时`);
      await new Promise((r) => setTimeout(r, pollMs));
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > timeoutMs * 4) fs.unlinkSync(lockPath);
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
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}
