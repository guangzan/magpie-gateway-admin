export type Period = "today" | "7d" | "30d" | "all";
export type UsagePeriod = Period | "off";
export type LimitPeriod = "day" | "week" | "month" | "days" | "hours";

export interface Limit {
  period: LimitPeriod;
  tokens: number;
  cost: number;
  days?: number;
  hours?: number;
  since?: string;
  cacheReads?: boolean;
}

export interface LimitRow {
  period: LimitPeriod;
  n: number;
  tokens: number;
  cost: number;
  // 编辑已有 key 时原样带回，窗口起点就不会被保存动作重置。
  since?: string;
  cacheReads?: boolean;
}

export interface KeyUsage {
  calls: number;
  errors: number;
  cost: number;
  // 网关不知道价格的调用：按 $0 计，不单独提示会让「花费」看起来偏低。
  unpriced?: number;
  input: number;
  output: number;
  cache_read: number;
}

// 网关 GET /v1/magpie/limit 里的一条限额窗口（budget.Status）。
export interface BudgetStatus {
  period: LimitPeriod;
  days?: number;
  hours?: number;
  start?: string;
  reset?: string;
  calls?: number;
  tokens?: number;
  cost?: number;
  unpriced?: number;
  tokenLimit?: number;
  costLimit?: number;
  tokensLeft?: number;
  costLeft?: number;
  spent?: boolean;
}

export interface BudgetInfo {
  limited: boolean;
  limits: BudgetStatus[];
  // 网关自己判定「真正卡住这把 key」的那一条。
  binding?: BudgetStatus | null;
}

export interface KeyRow {
  id: string;
  name: string;
  masked: string;
  off: boolean;
  lan: boolean;
  default: boolean;
  readOnly: boolean;
  browser: boolean;
  quotas: boolean;
  issues: boolean;
  issuer: string;
  expires: string;
  models: string[];
  accounts: string[];
  limits: Limit[];
  usage?: KeyUsage;
  budget?: BudgetInfo | null;
}

export interface Template {
  models: string[];
  limits: Limit[];
  expiresInDays?: number;
  readOnly: boolean;
  quotas: boolean;
  issues?: boolean;
  accounts?: string[];
}

export interface TemplateItem {
  id: string;
  name: string;
  template: Template;
}

export interface CatalogModel {
  id: string;
  name?: string;
  provider?: string;
  group?: boolean;
}

export interface Catalog {
  models: CatalogModel[];
  providers: string[];
  quotas?: unknown[];
}

export interface Health {
  app?: string;
  version?: string;
  configDir?: string;
  configOverride?: string;
  keysFile?: string;
  keysReadable?: boolean;
  keysCount?: number;
  keysError?: string;
  writable?: boolean;
  backupsDir?: string;
  cli?: { ok: boolean; path?: string };
  gateway?: { ok: boolean; models?: number; error?: string };
}

export interface IssuedKey {
  id?: string;
  name: string;
  secret: string;
}

export interface UsageSummary {
  calls?: number;
  errors?: number;
  cost?: number;
  unpriced?: number;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface UsageGroup extends UsageSummary {
  id?: string;
  callerKeyId?: string;
  callerKeyName?: string;
}

export interface UsageRequest {
  t?: string;
  callerKeyId?: string;
  callerKeyName?: string;
  req?: string;
  model?: string;
  provider?: string;
  providerName?: string;
  status?: number;
  ms?: number;
  in?: number;
  out?: number;
  cost?: number;
}

export interface RequestsPage {
  rows?: UsageRequest[];
  total?: number;
}

export interface KeyPayload {
  name?: string;
  expires?: string | null;
  models?: string;
  accounts?: string;
  limits?: Limit[];
  readOnly?: boolean;
  quotas?: boolean;
  issues?: boolean;
  off?: boolean;
}

export interface BatchPayload {
  count: number;
  namePrefix: string;
  startAt: number;
  off: boolean;
  template: {
    models: string;
    accounts?: string;
    limits: Limit[];
    expiresInDays?: number;
    readOnly: boolean;
    quotas?: boolean;
    issues?: boolean;
  };
}
