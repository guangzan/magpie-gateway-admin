import { create } from "zustand";

import { api, ApiError } from "./api";
import { limitWord } from "./format";
import type {
  BatchPayload,
  Catalog,
  Health,
  IssuedKey,
  KeyPayload,
  KeyRow,
  Period,
  RequestsPage,
  TemplateItem,
  UsageGroup,
  UsageRequest,
  UsageSummary,
} from "./types";

export type TabKey = "keys" | "usage" | "templates";
export type UsageFilter = "" | "failed" | "retried";

export interface Notifier {
  success(text: string): void;
  error(text: string): void;
  info(text: string): void;
}

interface ConfirmState {
  title: string;
  text: string;
  danger: boolean;
  resolve(ok: boolean): void;
}

interface UsageState {
  period: Period;
  filter: UsageFilter;
  q: string;
  callerKey: string;
  summary: UsageSummary;
  groups: UsageGroup[];
  requests: UsageRequest[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  // error 非空时页面显示可重试的失败态；旧数据保留，并标明是上次成功的结果。
  error: string;
  loaded: boolean;
  updatedAt: number;
}

const EMPTY_USAGE: UsageState = {
  period: "today",
  filter: "",
  q: "",
  callerKey: "",
  summary: {},
  groups: [],
  requests: [],
  total: 0,
  loading: false,
  loadingMore: false,
  error: "",
  loaded: false,
  updatedAt: 0,
};

const EMPTY_CATALOG: Catalog = { models: [], providers: [] };

interface ShellState {
  tab: TabKey;
  period: Period | "off";
  keys: KeyRow[];
  templates: TemplateItem[];
  catalog: Catalog;
  health: Health | null;
  warning: string;
  // 读不到 caller-keys.json 时 keysError 有值：页面必须说「读不到」，
  // 不能显示成「还没有 key」。
  keysError: string;
  keysLoaded: boolean;
  keysUsageOk: boolean;
  updatedAt: number;
  // 本地服务不可用/令牌失效时的阻断页文案。
  fatal: string;
  loading: boolean;
  tplLoading: boolean;

  keyOpen: boolean;
  batchOpen: boolean;
  batchTemplateId: string | null;
  issued: IssuedKey[] | null;
  detail: KeyRow | null;
  tplDialog: { template: TemplateItem | null } | null;
  confirm: ConfirmState | null;
  copyText: string | null;
  exportPath: string | null;

  usage: UsageState;
  notify: Notifier;

  setNotifier(notify: Notifier): void;
  boot(): Promise<void>;
  setTab(tab: TabKey): void;
  setPeriod(period: Period | "off"): void;
  refreshKeys(period?: Period | "off"): Promise<void>;
  refreshTemplates(): Promise<void>;
  refreshHealth(): Promise<void>;

  openKey(): void;
  closeKey(): void;
  openBatch(templateId?: string): void;
  closeBatch(): void;
  openDetail(key: KeyRow): void;
  closeDetail(): void;
  openTemplate(template?: TemplateItem | null): void;
  closeTemplate(): void;
  closeIssued(): void;
  closeCopy(): void;
  closeExport(): void;

  ask(text: string, title?: string): Promise<boolean>;
  finishConfirm(ok: boolean): void;
  copy(text: string): Promise<void>;
  saveExport(
    body:
      | { kind: "keys"; period: Period; name?: string }
      | { kind: "issued"; keys: IssuedKey[]; name?: string },
  ): Promise<void>;
  exportKeys(): Promise<void>;
  exportIssued(): Promise<void>;

  createKey(body: KeyPayload): Promise<void>;
  batchKeys(body: BatchPayload): Promise<void>;
  bulkAction(action: "off" | "on" | "delete", ids: string[]): Promise<void>;
  toggleKey(key: KeyRow): Promise<void>;
  saveDetail(body: KeyPayload): Promise<void>;
  rotateKey(): Promise<void>;
  deleteKey(): Promise<void>;
  copySecret(): Promise<void>;
  copySecretById(id: string): Promise<void>;
  resetLimits(): Promise<void>;

  saveTemplate(name: string, template: unknown, id?: string): Promise<void>;
  deleteTemplate(item: TemplateItem): Promise<void>;

  setUsagePeriod(period: Period): void;
  setUsageFilter(filter: UsageFilter): void;
  setUsageQuery(q: string): void;
  setUsageCallerKey(callerKey: string): void;
  loadUsage(): Promise<void>;
  loadRequests(reset: boolean): Promise<void>;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useShell = create<ShellState>((set, get) => ({
  tab: "keys",
  period: "today",
  keys: [],
  templates: [],
  catalog: EMPTY_CATALOG,
  health: null,
  warning: "",
  keysError: "",
  keysLoaded: false,
  keysUsageOk: true,
  updatedAt: 0,
  fatal: "",
  loading: false,
  tplLoading: false,

  keyOpen: false,
  batchOpen: false,
  batchTemplateId: null,
  issued: null,
  detail: null,
  tplDialog: null,
  confirm: null,
  copyText: null,
  exportPath: null,

  usage: EMPTY_USAGE,
  notify: { success: () => {}, error: () => {}, info: () => {} },

  setNotifier: (notify) => set({ notify }),

  boot: async () => {
    await Promise.all([
      get().refreshHealth(),
      get().refreshTemplates(),
      api<Catalog>("api/catalog")
        .then((catalog) => set({ catalog: catalog || EMPTY_CATALOG }))
        .catch(() => set({ catalog: EMPTY_CATALOG })),
    ]);
    await get().refreshKeys();
  },

  setTab: (tab) => set({ tab }),
  setPeriod: (period) => {
    set({ period });
    void get().refreshKeys(period);
  },

  refreshKeys: async (period) => {
    const p = period ?? get().period;
    set({ loading: true });
    try {
      const data = await api<{ keys: KeyRow[]; warning?: string; usageOk?: boolean }>(
        `api/keys?usage=${encodeURIComponent(p)}`,
      );
      set({
        keys: data.keys || [],
        warning: data.warning || "",
        keysError: "",
        keysLoaded: true,
        keysUsageOk: data.usageOk !== false,
        updatedAt: Date.now(),
      });
    } catch (err) {
      // 保留上一次的列表：读失败时清空会被误认为「key 都没了」。
      const fatal = err instanceof ApiError && err.status === 401
        ? "管理服务的访问令牌已失效（服务可能重启过）。请关闭这一页，从 magpie 的插件页面重新打开。"
        : "";
      set({ keysError: messageOf(err), fatal: fatal || get().fatal });
      get().notify.error(messageOf(err));
    } finally {
      set({ loading: false });
    }
  },

  refreshTemplates: async () => {
    set({ tplLoading: true });
    try {
      const data = await api<{ templates: TemplateItem[] }>("api/templates");
      set({ templates: data.templates || [] });
    } catch (err) {
      get().notify.error(messageOf(err));
    } finally {
      set({ tplLoading: false });
    }
  },

  refreshHealth: async () => {
    try {
      set({ health: await api<Health>("api/health") });
    } catch (err) {
      // 不要把「连不上本地服务」伪造成「网关和 CLI 都坏了」：那会误导排查。
      const fatal = err instanceof ApiError && err.status === 401
        ? "管理服务的访问令牌已失效（服务可能重启过）。请关闭这一页，从 magpie 的插件页面重新打开。"
        : "";
      set({ health: null, fatal: fatal || get().fatal });
    }
  },

  openKey: () => set({ keyOpen: true }),
  closeKey: () => set({ keyOpen: false }),
  openBatch: (templateId) => set({ batchOpen: true, batchTemplateId: templateId || null }),
  closeBatch: () => set({ batchOpen: false, batchTemplateId: null }),
  openDetail: (detail) => set({ detail }),
  closeDetail: () => set({ detail: null }),
  openTemplate: (template = null) => set({ tplDialog: { template } }),
  closeTemplate: () => set({ tplDialog: null }),
  closeIssued: () => set({ issued: null }),
  closeCopy: () => set({ copyText: null }),
  closeExport: () => set({ exportPath: null }),

  ask: (text, title = "确认") =>
    new Promise<boolean>((resolve) => set({ confirm: { text, title, danger: true, resolve } })),

  finishConfirm: (ok) => {
    get().confirm?.resolve(ok);
    set({ confirm: null });
  },

  copy: async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      get().notify.success("已复制");
    } catch {
      // 沙箱里剪贴板被禁用，退回到「全选 + ⌘C」
      set({ copyText: text });
    }
  },

  saveExport: async (body) => {
    const data = await api<{ path: string }>("api/export", { method: "POST", body });
    set({ exportPath: data.path });
  },

  exportKeys: async () => {
    const current = get().period;
    const p: Period = current === "off" ? "today" : current;
    try {
      await get().saveExport({ kind: "keys", period: p, name: `magpie-keys-${p}.csv` });
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  exportIssued: async () => {
    const keys = get().issued || [];
    if (!keys.length) return;
    try {
      await get().saveExport({ kind: "issued", keys, name: "magpie-issued-keys.csv" });
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  createKey: async (body) => {
    const data = await api<{ keys: IssuedKey[] }>("api/keys", { method: "POST", body });
    // 明文只出现这一次：直接打开交付弹窗（可复制全部 / 导出 CSV），不要
    // 让用户再去列表里逐把点「复制」。
    set({ keyOpen: false, ...(data.keys?.length ? { issued: data.keys } : {}) });
    await get().refreshKeys();
    get().notify.success(`创建成功${data.keys?.length ? `：${data.keys[0].name}` : ""}`);
  },

  batchKeys: async (body) => {
    const data = await api<{ keys: IssuedKey[] }>("api/keys/batch", { method: "POST", body });
    set({ batchOpen: false, ...(data.keys?.length ? { issued: data.keys } : {}) });
    await get().refreshKeys();
    get().notify.success(`创建成功：${data.keys?.length || 0} 把`);
  },

  bulkAction: async (action, ids) => {
    if (!ids.length) return;
    const names = get()
      .keys.filter((k) => ids.includes(k.id))
      .map((k) => k.name || k.id);
    const label = action === "off" ? "停用" : action === "on" ? "启用" : "删除";
    if (action !== "on") {
      const detail =
        action === "delete"
          ? `删除后立即失效，没有撤销。\n${names.slice(0, 12).join("、")}${names.length > 12 ? ` 等 ${names.length} 把` : ""}`
          : `用它们的请求会立刻被拒。\n${names.slice(0, 12).join("、")}${names.length > 12 ? ` 等 ${names.length} 把` : ""}`;
      if (!(await get().ask(`要${label}选中的 ${ids.length} 把 key 吗？\n${detail}`, `${label} key`))) {
        return;
      }
    }
    try {
      const data = await api<{
        succeeded: string[];
        failed: { id: string; message: string }[];
        skipped: { id: string; message: string }[];
      }>("api/keys/bulk", { method: "POST", body: { action, ids } });
      await get().refreshKeys();
      const done = data.succeeded?.length || 0;
      const nameOf = new Map(get().keys.map((k) => [k.id, k.name || k.id]));
      const names = (list: { id: string }[]) =>
        list
          .slice(0, 5)
          .map((item) => nameOf.get(item.id) || item.id)
          .join("、") + (list.length > 5 ? ` 等 ${list.length} 把` : "");
      if (data.failed?.length) {
        // 失败时把具体是哪几把写出来：只报「有 2 把失败」等于让人回列表里猜。
        get().notify.error(
          `${label}完成 ${done} 把，${data.failed.length} 把失败：${names(data.failed)}。${data.failed[0].message}`,
        );
        if (data.skipped?.length) get().notify.info(`${data.skipped.length} 把跳过：${names(data.skipped)}`);
      } else if (data.skipped?.length && !done) {
        get().notify.info(data.skipped[0].message);
      } else {
        get().notify.success(`已${label} ${done} 把`);
        if (data.skipped?.length) get().notify.info(`${data.skipped.length} 把跳过：${names(data.skipped)}`);
      }
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  toggleKey: async (key) => {
    if (
      !key.off &&
      !(await get().ask(`停用「${key.name || key.id}」？用它的请求会立刻被拒。`, "停用 key"))
    ) {
      return;
    }
    try {
      await api(`api/keys/${key.id}`, { method: "PATCH", body: { off: !key.off } });
      await get().refreshKeys();
      get().notify.success(key.off ? "已启用" : "已停用");
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  saveDetail: async (body) => {
    const key = get().detail;
    if (!key) return;
    await api(`api/keys/${key.id}`, { method: "PATCH", body });
    set({ detail: null });
    await get().refreshKeys();
    get().notify.success("已保存");
  },

  rotateKey: async () => {
    const key = get().detail;
    if (!key) return;
    const who = `${key.name || key.id}${key.masked ? `（${key.masked}）` : ""}`;
    if (
      !(await get().ask(
        `轮换「${who}」？旧密钥立即失效，正在使用它的调用方会全部报错。新密钥只显示这一次。`,
        "轮换密钥",
      ))
    ) {
      return;
    }
    try {
      const data = await api<{ secret: string; warning?: string }>(`api/keys/${key.id}/rotate`, {
        method: "POST",
      });
      set({ detail: null });
      await get().refreshKeys();
      set({ issued: [{ name: key.name, secret: data.secret }] });
      if (data.warning) get().notify.info(data.warning);
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  deleteKey: async () => {
    const key = get().detail;
    if (!key) return;
    const who = `${key.name || key.id}${key.masked ? `（${key.masked}）` : ""}`;
    if (
      !(await get().ask(
        `删除「${who}」？这个 key 会立刻失效，没有撤销。插件会先留一份 caller-keys.json 备份，但恢复需要手动操作。`,
        "删除 key",
      ))
    ) {
      return;
    }
    try {
      await api(`api/keys/${key.id}`, { method: "DELETE" });
      set({ detail: null });
      await get().refreshKeys();
      get().notify.success("已删除");
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  copySecret: async () => {
    const key = get().detail;
    if (!key) return;
    try {
      const data = await api<{ secret: string }>(`api/keys/${key.id}/secret`);
      await get().copy(data.secret);
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  copySecretById: async (id) => {
    try {
      const data = await api<{ secret: string }>(`api/keys/${id}/secret`);
      await get().copy(data.secret);
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  resetLimits: async () => {
    const key = get().detail;
    if (!key) return;
    const windows = (key.limits || []).map(limitWord);
    const text =
      `把「${key.name}」所有限额的已用量清零？\n` +
      (windows.length ? `将清零：${windows.join("；")}\n` : "") +
      "每天 / 每周 / 每月窗口的结束时间不变；N 天 / N 小时的窗口从现在重新计时。\n" +
      "清掉的用量不能恢复。";
    if (!(await get().ask(text, "清零已用量"))) return;
    try {
      await api(`api/keys/${key.id}/limits/reset`, { method: "POST" });
      set({ detail: null });
      await get().refreshKeys();
      get().notify.success("已用量已清零");
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  saveTemplate: async (name, template, id) => {
    await api("api/templates", { method: "POST", body: { name, template, ...(id ? { id } : {}) } });
    set({ tplDialog: null });
    await get().refreshTemplates();
    get().notify.success("模板已保存");
  },

  deleteTemplate: async (item) => {
    if (!(await get().ask(`删除模板「${item.name}」？`, "删除模板"))) return;
    try {
      await api(`api/templates/${item.id}`, { method: "DELETE" });
      await get().refreshTemplates();
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  setUsagePeriod: (period) => {
    // 切区间先把旧数字清掉：加载失败时不能把上个区间的数挂在新区间标签下。
    set((s) => ({
      usage: {
        ...s.usage,
        period,
        summary: {},
        groups: [],
        requests: [],
        total: 0,
        loaded: false,
        error: "",
        updatedAt: 0,
      },
    }));
    void get().loadUsage();
  },

  setUsageFilter: (filter) => {
    set((s) => ({ usage: { ...s.usage, filter } }));
    void get().loadRequests(true);
  },

  setUsageQuery: (q) => set((s) => ({ usage: { ...s.usage, q } })),

  setUsageCallerKey: (callerKey) => {
    set((s) => ({ usage: { ...s.usage, callerKey } }));
    void get().loadRequests(true);
  },

  loadUsage: async () => {
    const { period } = get().usage;
    set((s) => ({ usage: { ...s.usage, loading: true, error: "" } }));
    try {
      const data = await api<{ summary: UsageSummary; groups: UsageGroup[] }>(
        `api/usage?period=${encodeURIComponent(period)}`,
      );
      set((s) => ({
        usage: {
          ...s.usage,
          summary: data.summary || {},
          groups: data.groups || [],
          loading: false,
          loaded: true,
          error: "",
          updatedAt: Date.now(),
        },
      }));
      await get().loadRequests(true);
    } catch (err) {
      const fatal = err instanceof ApiError && err.status === 401
        ? "管理服务的访问令牌已失效（服务可能重启过）。请关闭这一页，从 magpie 的插件页面重新打开。"
        : "";
      set((s) => ({ usage: { ...s.usage, loading: false, error: messageOf(err) }, fatal: fatal || s.fatal }));
      get().notify.error(messageOf(err));
    }
  },

  loadRequests: async (reset) => {
    const { usage } = get();
    const offset = reset ? 0 : usage.requests.length;
    const params = new URLSearchParams({
      period: usage.period,
      offset: String(offset),
      limit: "50",
    });
    if (usage.filter === "failed") params.set("failed", "1");
    if (usage.filter === "retried") params.set("retried", "1");
    if (usage.q.trim()) params.set("q", usage.q.trim());
    if (usage.callerKey) params.set("callerKey", usage.callerKey);

    set((s) => ({ usage: { ...s.usage, loadingMore: !reset } }));
    try {
      const data = await api<RequestsPage>(`api/usage/requests?${params}`);
      const rows = data.rows || [];
      set((s) => ({
        usage: {
          ...s.usage,
          requests: reset ? rows : [...s.usage.requests, ...rows],
          total: data.total || 0,
          loadingMore: false,
          error: "",
        },
      }));
    } catch (err) {
      set((s) => ({ usage: { ...s.usage, loadingMore: false, error: messageOf(err) } }));
      get().notify.error(messageOf(err));
    }
  },
}));
