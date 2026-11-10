// 不经过 magpie，直接起本地服务，开发时用浏览器打开 http://127.0.0.1:3478/ 即可。
// 页面里内联了本次启动的 token，所以直接打开就能用。
import { startServer } from "./lib/server.mjs";

const port = Number(process.env.PORT || 3478);
const info = await startServer({ port });
console.log(
  `[gateway-admin] http://127.0.0.1:${info.port}/${info.reused ? "（复用了已在跑的服务）" : ""}`,
);
