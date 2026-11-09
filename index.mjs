// magpie-gateway-admin 的宿主入口。
//
// magpie 的插件页面跑在 sandbox="allow-scripts" 的框架里，CSP 是
// connect-src 'none'，页面自己发不出任何请求。所以页面只做一件事：把自己
// 导航到本插件宿主起的本地服务（package.json 的 magpie.page.service）。
//
// 这个模块在宿主 import 时就把服务拉起来，因为页面可能比 server() 调用更早
// 需要它（magpie 的 pageHost 会先预热宿主，再让页面跳转）。

import { probeServer, startServer } from "./lib/server.mjs";

let starting = null;
let listening = null;
let watching = null;

function ensure(port) {
  if (starting) return starting;
  starting = startServer({ port })
    .then((info) => {
      listening = info;
      console.log(`[gateway-admin] listening on http://127.0.0.1:${info.port}`);
      // 端口上是另一个实例（常见于上一次的进程还没退干净）：它一消失就接管，
      // 否则页面会一直指向一个已经没人应答的地址。
      if (info.reused) watch(port);
      return info;
    })
    .catch((err) => {
      console.error("[gateway-admin] could not start:", err?.message || err);
      starting = null;
      throw err;
    });
  return starting;
}

function watch(port) {
  if (watching) return;
  watching = setInterval(async () => {
    if (await probeServer(port)) return;
    clearInterval(watching);
    watching = null;
    if (!listening?.reused) return;
    listening = null;
    starting = null;
    ensure(port).catch(() => {});
  }, 5000);
  watching.unref?.();
}

function portOf(options) {
  const raw = options && typeof options === "object" ? options.port : undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3478;
}

// 默认端口先起：页面跳转不等 server() 的调用。
ensure(3478).catch(() => {});

export default {
  id: "magpie-gateway-admin",
  server: async (_input, options) => {
    const want = portOf(options);
    if (!listening) {
      await ensure(want).catch(() => null);
    } else if (listening.port !== want) {
      // 用户在选项里改了端口：换到新端口，页面按 magpie.service / 选项跳转。
      await listening.close().catch(() => {});
      listening = null;
      starting = null;
      await ensure(want).catch(() => null);
    }
    return {};
  },
};
