import { create } from "zustand";

import { api, rawExport } from "./api";
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
  summary: UsageSummary;
  groups: UsageGroup[];
  requests: UsageRequest[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
}

const EMPTY_USAGE: UsageState = {
  period: "today",
  filter: "",
  q: "",
  summary: {},
  groups: [],
  requests: [],
  total: 0,
  loading: false,
  loadingMore: false,
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
  loading: boolean;
  tplLoading: boolean;

  keyOpen: boolean;
  batchOpen: boolean;
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
  openBatch(): void;
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
  saveExport(name: string, csv: string): Promise<void>;
  exportKeys(): Promise<void>;
  exportIssued(): Promise<void>;

  createKey(body: KeyPayload): Promise<void>;
  batchKeys(body: BatchPayload): Promise<void>;
  toggleKey(key: KeyRow): Promise<void>;
  saveDetail(body: KeyPayload): Promise<void>;
  rotateKey(): Promise<void>;
  deleteKey(): Promise<void>;
  copySecret(): Promise<void>;

  saveTemplate(name: string, template: unknown): Promise<void>;
  deleteTemplate(item: TemplateItem): Promise<void>;

  setUsagePeriod(period: Period): void;
  setUsageFilter(filter: UsageFilter): void;
  setUsageQuery(q: string): void;
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
  loading: false,
  tplLoading: false,

  keyOpen: false,
  batchOpen: false,
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
      const data = await api<{ keys: KeyRow[]; warning?: string }>(
        `api/keys?usage=${encodeURIComponent(p)}`,
      );
      set({ keys: data.keys || [], warning: data.warning || "" });
    } catch (err) {
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
    } catch {
      set({ health: { gateway: { ok: false }, cli: { ok: false } } });
    }
  },

  openKey: () => set({ keyOpen: true }),
  closeKey: () => set({ keyOpen: false }),
  openBatch: () => set({ batchOpen: true }),
  closeBatch: () => set({ batchOpen: false }),
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

  saveExport: async (name, csv) => {
    const data = await api<{ path: string }>("api/export", {
      method: "POST",
      body: { name, csv },
    });
    set({ exportPath: data.path });
  },

  exportKeys: async () => {
    const p = get().period === "off" ? "today" : get().period;
    try {
      const csv = await rawExport(p);
      await get().saveExport(`magpie-keys-${p}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  exportIssued: async () => {
    const rows = get().issued || [];
    const csv = `name,secret\n${rows.map((k) => `${k.name},${k.secret}`).join("\n")}\n`;
    try {
      await get().saveExport(
        `magpie-keys-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
    } catch (err) {
      get().notify.error(messageOf(err));
    }
  },

  createKey: async (body) => {
    const data = await api<{ keys: IssuedKey[] }>("api/keys", { method: "POST", body });
    set({ keyOpen: false });
    await get().refreshKeys();
    if (data.keys?.length) set({ issued: data.keys });
  },

  batchKeys: async (body) => {
    const data = await api<{ keys: IssuedKey[] }>("api/keys/batch", { method: "POST", body });
    set({ batchOpen: false });
    await get().refreshKeys();
    if (data.keys?.length) set({ issued: data.keys });
  },

  toggleKey: async (key) => {
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
    if (!(await get().ask("轮换后旧密钥立即失效，继续？", "轮换密钥"))) return;
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
    if (!(await get().ask(`删除「${key.name}」？这个 key 会立刻失效。`, "删除 key"))) return;
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

  saveTemplate: async (name, template) => {
    await api("api/templates", { method: "POST", body: { name, template } });
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
    set((s) => ({ usage: { ...s.usage, period } }));
    void get().loadUsage();
  },

  setUsageFilter: (filter) => {
    set((s) => ({ usage: { ...s.usage, filter } }));
    void get().loadRequests(true);
  },

  setUsageQuery: (q) => set((s) => ({ usage: { ...s.usage, q } })),

  loadUsage: async () => {
    const { period } = get().usage;
    set((s) => ({ usage: { ...s.usage, loading: true } }));
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
        },
      }));
      await get().loadRequests(true);
    } catch (err) {
      set((s) => ({ usage: { ...s.usage, loading: false } }));
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
        },
      }));
    } catch (err) {
      set((s) => ({ usage: { ...s.usage, loadingMore: false } }));
      get().notify.error(messageOf(err));
    }
  },
}));
