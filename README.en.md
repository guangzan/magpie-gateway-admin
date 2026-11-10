<p align="center">
  <img src="./page/icon.svg" width="56" height="56" alt="magpie-gateway-admin icon">
</p>

<h1 align="center">magpie Gateway Admin</h1>

<p align="center">
  Multi-user management for the <a href="https://usemagpie.ai">magpie</a> gateway: batch key issuance, limits, model permissions, and a usage dashboard.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md"><b>English</b></a>
</p>

<p align="center">
  <img alt="magpie 0.1.3078+" src="https://img.shields.io/badge/magpie-0.1.3078%2B-6b46c1">
  <img alt="Bun 1.1+" src="https://img.shields.io/badge/Bun-1.1%2B-000000?logo=bun&logoColor=white">
</p>

magpie's built-in Gateway page is designed for a single user: one shared key that cannot be renamed or disabled. This plugin covers the other part—opening the gateway to a group of people, with per-key permissions, limits, and usage.

> [!NOTE]
> The plugin does not replace magpie's Gateway page. The default shared key is still managed by magpie itself; this plugin manages the additional multi-user keys.

## Quick Start

1. Install the plugin:

   ```bash
   # From npm
   magpie plugin add magpie-gateway-admin

   # From GitHub (no npm needed; uses the build output committed in the repo)
   magpie plugin add github:guangzan/magpie-gateway-admin

   # From a local directory
   magpie plugin add /path/to/magpie-gateway-admin
   ```

2. Open **Gateway Admin** in the sidebar.
3. Click **Batch issue keys**, set a name prefix, expiry, and permissions, then copy or export the plaintext keys.

The first open starts the plugin's local service at `http://127.0.0.1:3478/`.

## What It Does

### Users and Keys

- **Batch issuance**: issue 1–100 keys at once, numbered from a prefix (`team-a-01`, `team-a-02`, …). The whole batch is transactional: if any key fails, every key already written in the batch is removed—no half-created keys without limits.
- **Permissions**: the create form groups model allowlists (`openai/*`, `anthropic/claude-*`, `group/<route-group>`, `group/*`), upstream accounts, limits, read-only mode, permission to read upstream account balances, and permission to issue child keys.
- **Limits**: daily, weekly, monthly, every N days, or every N hours; up to five limits per key. Limits can count tokens or USD, and can include cache reads in the token count. Setting both tokens and USD to 0 means the limit is disabled. The form starts with one monthly $20 limit, which can be edited or removed.
- **Limit scope**: magpie limits are not scoped per model (`access.Limit` has no such field), so the plugin does not expose a fake "only these models" switch. A limit applies to every call made with that key.
- **Expiry and windows**: single-key creation accepts an exact expiry date; batch creation uses a number of valid days. When editing an existing key, the window start (`since`) and cache-read flag are preserved—changing a limit does not reset the current window.
- **Secret delivery**: after creation, a delivery dialog offers per-key copy, copy all, and CSV export. The list itself only shows masked keys; rotation shows the new secret once more.
- **Limit status**: each row shows the tightest active limit as used / limit / reset time. Exhausted limits are red. The detail view can zero out used amounts without changing the end of a calendar window.
- **Usage columns**: each key shows calls and estimated cost for today, the last 7 days, or the last 30 days. Unpriced calls are marked with `*` and a count.
- **Needs attention**: exhausted limits, limits at or above 80%, and keys expiring within 7 days appear as one-click filters. Keys can also be filtered by state and sorted by name, calls, cost, or limit usage.
- **Bulk actions**: select multiple keys to enable, disable, or delete them. Confirmation dialogs list the affected key names.
- **Search and pagination**: search by name, id, or masked key; pagination is local, so large key sets do not require endless scrolling.
- **CSV export**: includes usage and is generated server-side under `plugin-data/magpie-gateway-admin/exports/` in the config directory. Filenames include a timestamp. If usage cannot be fetched, export fails instead of producing a fake "0 calls / $0" report. Deleted keys with recorded traffic are kept as "deleted" rows so their cost is not lost.

### Usage

- Period summaries include total calls, errors, tokens, cache reads/writes, estimated cost, and unpriced calls.
- Usage is grouped by key. Columns can be sorted by calls, errors, input, output, cache reads, or cost. Click a group to filter recent requests to that key; clear the filter with the × on the tag.
- A request shows time, model, status, latency, input/output tokens, and cost. Requests can be filtered to failed or retried calls and searched.
- If the gateway is unreachable or an endpoint fails, the page keeps a visible error and a **Retry** action instead of rendering zeros and empty tables. Changing the period clears stale numbers first so two periods cannot be mixed together.

> [!NOTE]
> Cost is estimated from gateway pricing. Unpriced calls count as $0 and do not consume USD limits. Periods follow the timezone of the machine running the gateway.

### Templates

- Save a common combination of models, accounts, limits, expiry, read-only mode, and child-key permission as a template, then apply it to single or batch key creation. Every limit window and cache-read flag is preserved.
- Templates can be renamed or deleted, and **Issue keys with this template** jumps to batch creation with the template preselected.
- Templates live in `plugin-data/magpie-gateway-admin/templates.json` under the config directory and never touch magpie's own config. Templates store relative window definitions, not a specific key's `since`.
- Up to 40 templates can be stored; template names are limited to 60 characters.

## Installation

Requires magpie ≥ 0.1.3078 (older versions do not have plugin pages). The plugin targets the Bun runtime and declares Bun ≥ 1.1 in `package.json`; Bun is also needed for development and for running the local service directly.

```bash
# From npm
magpie plugin add magpie-gateway-admin

# From GitHub (no npm needed; uses the build output committed in the repo)
magpie plugin add github:guangzan/magpie-gateway-admin

# From a local directory
magpie plugin add /path/to/magpie-gateway-admin
```

After installation, **Gateway Admin** appears in the sidebar. The first open starts the plugin's local service (default `127.0.0.1:3478`) and navigates the page to it.

### Config Directory

The plugin resolves the config directory using magpie's own rules, so it reads and writes the same `caller-keys.json`:

1. `data/` beside the magpie executable (portable install, or a `.portable` marker); shared folders and system-moved Downloads / Desktop / Documents follow magpie's `shared` / `movedFolder` rules;
2. `XDG_CONFIG_HOME/magpie`;
3. `~/.config/magpie` (on Windows, `USERPROFILE`, not `APPDATA`).

`MAGPIE_ADMIN_CONFIG_DIR` (or `MAGPIE_CONFIG_DIR`) forces the plugin to use a different config directory, but **magpie itself does not read either variable**. The plugin and magpie will probably be looking at different data; the page shows a warning at the top. Only use this when you know magpie points at the same directory.

> [!WARNING]
> Do not use a config directory override to "isolate a test environment" unless magpie is pointed at that directory too. Keys and limits written by the plugin may be invisible to magpie.

The gateway address comes from `MAGPIE_ADDR`; otherwise the plugin reads `port` from `settings.json`, then falls back to `3425`.

### Port and Uninstall

If the default port is occupied, change it in the plugin options:

```bash
magpie plugin options magpie-gateway-admin '{"port": 3479}'
```

Uninstall:

```bash
magpie plugin rm magpie-gateway-admin
```

## How It Works

magpie plugin pages run inside an iframe with `sandbox="allow-scripts"` and a `connect-src 'none'` CSP. The iframe has an opaque origin: the page cannot make requests, has no cookies or localStorage, and cannot reach `/api`.

So the page does exactly one thing—it navigates to a local HTTP service started by the plugin host (`magpie.page.service` in `package.json`). The real UI and API live on that service:

```text
magpie window
└── iframe (sandbox=allow-scripts, can only load its own files)
    └── location.replace → http://127.0.0.1:3478/
        ├── ui/            UI (React + Ant Design, built into ui/dist)
        └── lib/server.mjs local API
            ├── magpie gateway-key …   issue / rotate / remove keys, set accounts, reset usage
            ├── <config-dir>/caller-keys.json  limits, models, accounts, expiry
            └── gateway (settings.json port, default 127.0.0.1:3425)  limits, usage, requests, model catalog
```

The plugin reads gateway endpoints (`/v1/magpie/limit`, `/v1/magpie/usage`, `/v1/magpie/usage/requests`, `/v1/models`, `/v1/magpie/quotas`) and writes `caller-keys.json`. It uses the same `caller-keys.json.lock` as magpie (`flock`; Windows falls back to the plugin's own lock file), performs atomic writes via temporary file + rename, keeps permissions at `0600`, and takes a backup before each write.

## Security

- **Loopback only**: the server binds to `127.0.0.1`. Requests must use a `Host` of `127.0.0.1`, `localhost`, or `[::1]`—anything else gets a 421, which also blocks DNS rebinding.
- **Per-start token**: each start generates a random token, inlines it into the HTML, and requires it in `x-magpie-admin-token` (compared with `timingSafeEqual`). Other web pages cannot obtain the token and therefore cannot call the API.
- **Origin checks**: non-local `Origin` values get a 403. CORS reflects only a local origin and never uses a wildcard.
- **Strict CSP**: `default-src 'none'`, `script-src 'nonce-…'`, and `connect-src 'self'`, with explicit allowances for `http://127.0.0.1:<port>` / `localhost` / `[::1]`. The page cannot send `X-Frame-Options` / `frame-ancestors 'none'`: it intentionally runs inside magpie's sandbox iframe, and framing protection would break the entire plugin. Cross-site protection comes from Host and Origin checks plus the per-start token. For the same reason the server does not send `Cross-Origin-Resource-Policy: same-origin`; an opaque-origin iframe would be blocked from loading its own assets.
- **Secrets on demand**: list responses contain only masked keys (last 4–6 characters). Clicking **Copy** fetches the plaintext once from the local service, and only a page holding the admin token can do that. Rotation shows the new secret once more.
- **File permissions**: exported CSVs and backups are `0600`, matching `caller-keys.json`. Delivery CSVs contain plaintext keys—delete them after distribution; they do not expire automatically.

## Sandbox Limitations

These are not bugs; they are consequences of magpie's iframe policy. The plugin provides a workaround for each:

| Capability | Result in the sandbox | Workaround |
| --- | --- | --- |
| `<form>` submission | No `allow-forms`; `submit` does not fire | All actions use buttons; Enter is handled manually in inputs |
| `confirm()` | No `allow-modals`; returns `false` | Custom confirmation dialogs |
| `navigator.clipboard` / `execCommand('copy')` | Rejected (`NotAllowedError`) | Show the content selected in a dialog and prompt for ⌘C |
| `a[download]` | No `allow-downloads`; fails silently | The host service writes the file to disk and the UI shows the path |
| `localStorage` | Opaque origin; `SecurityError` | Preferences such as the usage period are not persisted |

## Known Limitations

- `magpie.page.service` is not yet in the public docs (the community plugin `@magpie-community/page-chat` uses it too). If magpie changes this field, the page falls back to a static explanation page.
- The default shared key (LAN key) cannot be renamed, disabled, re-expired, made read-only, deleted, or rotated here—it belongs to magpie's own Gateway page. Changing its expiry would effectively disable it, so that is blocked too. The plugin rejects these actions explicitly and disables the corresponding row actions.
- If another admin instance occupies the port, the plugin only reuses it when both the config directory and version match. Otherwise it refuses to start and prints a command for changing the port, so the page cannot silently manage a different `caller-keys.json`.
- Account binding goes through `magpie gateway-key accounts`, and magpie validates the provider. magpie 0.1.3078's `gateway-key` has no `mcp` subcommand, so the plugin does not offer per-key MCP binding.
- Exports are written on the machine running magpie. The sandbox page cannot download files directly; this is a deliberate tradeoff.

## Development

```bash
pnpm install      # React / Ant Design / zustand / vite / typescript
pnpm build        # tsc check + vite build into ui/dist (build output is committed, no build needed on install)
pnpm dev:ui       # vite dev server, /api proxied to 127.0.0.1:3478

bun test          # 62 tests: paths, validation, file I/O, HTTP API, batch operations, static page, security headers
bun run serve     # run the service without magpie, then open http://127.0.0.1:3478/
```

Tests use a fake `magpie` CLI and a temporary config directory, so they never touch real keys.

`ui/dist` is committed: magpie does not run build scripts when installing from git or npm, so rebuild with `pnpm build` and commit the output after changing the UI.

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `MAGPIE_ADMIN_CONFIG_DIR` / `MAGPIE_CONFIG_DIR` | Force the plugin to use another config directory. **magpie does not read either variable**; only use this when magpie points there too. |
| `MAGPIE_ADDR` | Gateway address, such as `127.0.0.1:3425` or `http://127.0.0.1:3425`; `http://` is added when the scheme is omitted. |
| `MAGPIE_BIN` | Path to the magpie CLI; otherwise the plugin searches `PATH` and common install locations. |
| `MAGPIE_ADMIN_ORIGINS` | Extra allowed browser origins, comma-separated; development only. |
| `PORT` | Port for `bun run serve`, default `3478`. |

### Stack and Layout

The UI uses React 19, Ant Design 6, and TypeScript, with zustand for state and vite for bundling. It follows magpie's own theme setting (light, dark, or system), not just macOS's appearance: the navigation carries the current mode in the URL hash, and the page then keeps receiving theme changes and `--magpie-*` color tokens through magpie's page bridge. Opened directly in a browser, it falls back to the system `prefers-color-scheme`. It also disables all Ant Design motion (`wave` and `token.motion`) because the page runs inside magpie's sandbox iframe—animation only makes people wait.

```text
index.mjs          plugin host entry (starts the service on import)
page/              the page loaded inside magpie; it only navigates
ui/src/            UI source (App / views / modals / store / api / types)
ui/dist/           vite build output, served directly
ui/vite.config.ts  base "./", target safari17, dev proxy
lib/server.mjs     local HTTP API (Origin/Host checks, batch transaction rollback)
lib/store.mjs      caller-keys.json read/write and locking
lib/cli.mjs        magpie gateway-key wrapper
lib/gateway.mjs    gateway read-only API (short TTL cache)
lib/validate.mjs   validation aligned with magpie's access package
lib/templates.mjs  templates
lib/csv.mjs        CSV generation (formula injection escaping)
lib/errors.mjs     standard HTTP errors
lib/lock.mjs       cross-process flock
lib/paths.mjs      magpie config directory, gateway address, CLI path
```

### Releasing

Pushing a `v*` tag runs `.github/workflows/ci.yml`: tests and build first, then `npm publish` through npm Trusted Publishing (OIDC). No `NPM_TOKEN` is stored in the repository. Bump `package.json` before tagging; the tag must match the version.

---

## License

[Apache-2.0](./LICENSE). See [NOTICE](./NOTICE) for copyright and attribution.

---

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./README.en.md"><b>English</b></a>
</p>
