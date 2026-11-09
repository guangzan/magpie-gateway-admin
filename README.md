# magpie 网关用户管理

给 [magpie](https://usemagpie.ai) 的网关加一个「多用户」页面：批量发 key、给每把 key 定限额和模型白名单、看每个人的用量、随时停用或轮换。

magpie 自带的 Gateway 页面是给自己用的：一把共享 key，改不了名、停不了用。这个插件补的是「把网关开给一群人」的那部分。

## 能力

**用户与密钥**

- 一次发 1–100 把 key，名称按前缀自动编号（`team-a-01`、`team-a-02`…）。
- 每把 key 可以设：模型白名单（`openai/*`、`anthropic/claude-*`）、限额（每天 / 每周 / 每月 / N 天 / N 小时，按 tokens 或美元，最多 5 条）、并发上限、到期时间、只读、是否允许读额度卡片、是否允许签发短期 key、绑定的账号。
- 新建后**明文只显示一次**，可以逐条复制或整批导出。
- 列表里能直接看到每把 key 今天 / 近 7 天 / 近 30 天的调用数、错误数、花费。
- 随时改名、改限额、改模型、停用 / 启用、轮换密钥、删除。轮换和删除都有二次确认。
- 导出 CSV（含用量），文件写在 `~/.config/magpie/plugin-data/magpie-gateway-admin/exports/`。

**用量**

- 按区间汇总：总调用、错误、tokens、缓存命中、花费。
- 按 key 分组，能下钻到单条请求（时间、模型、状态、耗时、输入输出、花费），支持失败 / 重试过滤和搜索。

**模板**

- 把常用的「模型 + 限额 + 并发 + 有效期 + 只读」存成模板，批量发 key 时选一下就行。
- 模板存在 `~/.config/magpie/plugin-data/magpie-gateway-admin/templates.json`，不碰 magpie 自己的配置。

## 安装

需要 magpie ≥ 0.1.3078（更早的版本没有插件页面）。

```bash
# 本地目录
magpie plugin add /path/to/magpie-gateway-admin

# 或者 GitHub
magpie plugin add github:guangzan/magpie-gateway-admin
```

装好之后侧边栏会多出「网关用户管理」。第一次打开会启动插件自己的本地服务（默认 `127.0.0.1:3478`），页面跳到它上面跑。

端口被占用时可以在插件选项里改：

```bash
magpie plugin options magpie-gateway-admin '{"port": 3479}'
```

卸载：`magpie plugin rm magpie-gateway-admin`。

## 它是怎么工作的

magpie 的插件页面跑在 `sandbox="allow-scripts"` 的 iframe 里，CSP 是 `connect-src 'none'`，源是不透明的：页面发不出请求，也没有 cookie 和 localStorage，更拿不到 `/api`。

所以页面只做一件事——把自己导航到插件宿主起的本地 HTTP 服务（`package.json` 里的 `magpie.page.service`）。真正的界面和接口都在那个服务上：

```
magpie 窗口
└── iframe（sandbox=allow-scripts，只能加载自己的文件）
    └── location.replace → http://127.0.0.1:3478/
        ├── ui/            界面（React + Ant Design，构建产物在 ui/dist）
        └── lib/server.mjs 本地接口
            ├── magpie gateway-key …   发 key / 轮换 / 删 key / 改账号
            ├── ~/.config/magpie/caller-keys.json  限额、模型、并发、到期
            └── 网关 127.0.0.1:3425     用量、请求明细、模型目录
```

读走网关的只读接口（`/v1/magpie/usage`、`/v1/magpie/usage/requests`、`/v1/models`、`/v1/magpie/quotas`），写在 `caller-keys.json` 上，文件锁用 `O_EXLOCK`，写入是「临时文件 + rename」，权限 `0600`，改之前留一份备份。

## 安全

- 服务只监听 `127.0.0.1`，不对外网开放。
- 每次启动生成一个随机 token，内联进 HTML，接口用 `x-magpie-admin-token` 校验（`timingSafeEqual`）。别的网页拿不到这个 token，也就调不动接口。
- 页面有严格的 CSP（`default-src 'none'`、`script-src 'nonce-…'`），只加载自己的脚本和样式。
- 明文密钥只在「刚发出来」那一次返回，列表接口只给 `sk-…后四位`。想再拿一次明文，只能轮换。
- 导出的 CSV 和备份都是 `0600`，和 `caller-keys.json` 同目录权限。

## 沙箱里做不了的几件事

这几个不是 bug，是 magpie 的 iframe 策略决定的，插件里都做了替代方案：

| 能力 | 沙箱里的结果 | 这里的做法 |
| --- | --- | --- |
| `<form>` 提交 | 没有 `allow-forms`，`submit` 事件不触发 | 全部用按钮点击，回车在输入框里手动接管 |
| `confirm()` | 没有 `allow-modals`，直接返回 `false` | 自己画确认弹窗 |
| `navigator.clipboard` / `execCommand('copy')` | 被拒（`NotAllowedError`） | 弹窗里把内容全选，提示按 ⌘C |
| `a[download]` | 没有 `allow-downloads`，静默失败 | 让宿主服务把文件写到磁盘，界面给出路径 |
| `localStorage` | 不透明源，`SecurityError` | 用量区间这类偏好不持久化 |

## 已知限制

- `magpie.page.service` 目前没有写进公开文档（社区插件 `@magpie-community/page-chat` 用的也是它）。magpie 改了这个字段的话，页面会退化成一张静态说明页。
- 默认的共享 key（LAN key）不能在插件里改名、停用或设只读——那是 magpie 自己 Gateway 页面管的。插件里会明确拒绝并提示。
- 账号绑定走 `magpie gateway-key accounts`，由 magpie 自己校验 provider 是否存在。magpie 0.1.3078 的 `gateway-key` 没有 `mcp` 子命令，所以插件不提供 per-key 的 MCP 绑定。
- 导出落在运行 magpie 的那台机器上。沙箱页面不能直接下载，这是取舍。

## 开发

```bash
npm install       # React / Ant Design / zustand / vite / typescript
npm run build     # tsc 检查 + vite 打包到 ui/dist（提交了构建产物，装插件时不用再 build）
npm run dev:ui    # vite dev server，/api 代理到 127.0.0.1:3478

bun test          # 29 个测试：校验、文件读写、HTTP 接口、静态页
bun run serve     # 不起 magpie，直接跑服务，浏览器开 http://127.0.0.1:3478/
```

测试用假的 `magpie` CLI 和一个临时配置目录，不会碰你真实的 key。环境变量 `MAGPIE_ADMIN_CONFIG_DIR`、`MAGPIE_BIN`、`MAGPIE_ADDR` 可以覆盖配置目录、CLI 路径和网关地址。

界面是 React 19 + Ant Design 6 + TypeScript，状态用 zustand，打包用 vite。主题跟随系统的 `prefers-color-scheme`（Ant Design 的 darkAlgorithm），并关掉了 Ant Design 的所有动效（`wave` 和 `token.motion`），因为插件页在 magpie 的沙箱 iframe 里，动画只会让人等。

目录：

```
index.mjs          插件宿主入口（import 时起服务）
page/              在 magpie 里跑的那一页，只负责跳转
ui/src/            界面源码（App / views / modals / store / api / types）
ui/dist/           vite 构建产物，服务直接托管
ui/vite.config.ts  base "./"、target safari17、dev 代理
lib/server.mjs     本地 HTTP 接口
lib/store.mjs      caller-keys.json 的读写与加锁
lib/cli.mjs        magpie gateway-key 的封装
lib/gateway.mjs    网关只读接口
lib/validate.mjs   与 magpie access 包对齐的校验
lib/templates.mjs  模板
```
