export type Period = "today" | "7d" | "30d" | "all";
export type UsagePeriod = Period | "off";
export type LimitPeriod = "day" | "week" | "month" | "days" | "hours";

export interface Limit {
  period: LimitPeriod;
  tokens: number;
  cost: number;
  days?: number;
  hours?: number;
  models?: string[];
  since?: string;
  cacheReads?: boolean;
}

export interface LimitRow {
  period: LimitPeriod;
  n: number;
  tokens: number;
  cost: number;
  models: string;
}

export interface KeyUsage {
  calls: number;
  errors: number;
  cost: number;
  input: number;
  output: number;
  cache_read: number;
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
  maxConcurrency: number;
  models: string[];
  accounts: string[];
  limits: Limit[];
  usage?: KeyUsage;
}

export interface Template {
  models: string[];
  limits: Limit[];
  maxConcurrency: number;
  expiresInDays?: number;
  readOnly: boolean;
  quotas: boolean;
  issues?: boolean;
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
  keysFile?: string;
  keysReadable?: boolean;
  writable?: boolean;
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
  input?: number;
  output?: number;
  cache_read?: number;
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
  maxConcurrency?: number;
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
    limits: Limit[];
    maxConcurrency: number;
    expiresInDays?: number;
    readOnly: boolean;
  };
}
