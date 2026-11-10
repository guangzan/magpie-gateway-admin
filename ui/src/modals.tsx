import React from "react";
import {
  Alert,
  Button,
  Checkbox,
  Col,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import dayjs from "dayjs";

import LimitEditor from "./components/LimitEditor";
import ModelField from "./components/ModelField";
import { blankLimits, budgetWindow, fmtCost, fmtDate, fmtNum, readLimits, toLimitRows } from "./format";
import type {
  BatchPayload,
  CatalogModel,
  IssuedKey,
  KeyPayload,
  KeyRow,
  LimitRow,
  Template,
  TemplateItem,
} from "./types";

const { Text } = Typography;

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {children}
      </Text>
      {hint ? (
        <Text type="secondary" style={{ fontSize: 12, opacity: 0.75 }}>
          {" "}
          {hint}
        </Text>
      ) : null}
    </div>
  );
}

function Err({ text }: { text: string }) {
  if (!text) return null;
  return <Alert type="error" showIcon message={text} style={{ marginTop: 12 }} />;
}

const expiresBody = (value: string): string | null =>
  value ? `${value}T23:59:59` : null;

function templateOptions(templates: TemplateItem[]) {
  return [
    { value: "", label: "不用模板" },
    ...templates.map((t) => ({ value: t.id, label: t.name })),
  ];
}

interface CommonProps {
  providers: string[];
  groups: CatalogModel[];
}

// ---------- 新建单个 key ----------

interface KeyModalProps extends CommonProps {
  open: boolean;
  templates: TemplateItem[];
  onClose(): void;
  onSubmit(body: KeyPayload): Promise<void>;
}

interface KeyForm {
  name: string;
  expires: string;
  models: string;
  accounts: string;
  limits: LimitRow[];
  readOnly: boolean;
  quotas: boolean;
  issues: boolean;
  off: boolean;
  templateId: string;
}

const blankKey = (): KeyForm => ({
  name: "",
  expires: "",
  models: "",
  accounts: "",
  limits: blankLimits(),
  readOnly: false,
  quotas: false,
  issues: false,
  off: false,
  templateId: "",
});

export function KeyModal({ open, onClose, onSubmit, templates, providers, groups }: KeyModalProps) {
  const [form, setForm] = React.useState<KeyForm>(blankKey);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(blankKey());
      setErr("");
      setBusy(false);
    }
  }, [open]);

  const set = (patch: Partial<KeyForm>) => setForm((f) => ({ ...f, ...patch }));

  const pickTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id)?.template;
    set({
      templateId: id,
      ...(tpl
        ? {
            models: (tpl.models || []).join(", "),
            accounts: (tpl.accounts || []).join(", "),
            limits: toLimitRows(tpl.limits),
            readOnly: !!tpl.readOnly,
            quotas: !!tpl.quotas,
            issues: !!tpl.issues,
            expires: tpl.expiresInDays
              ? dayjs().add(tpl.expiresInDays, "day").format("YYYY-MM-DD")
              : "",
          }
        : {}),
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit({
        name: form.name,
        expires: expiresBody(form.expires),
        models: form.models,
        accounts: form.accounts,
        limits: readLimits(form.limits),
        readOnly: form.readOnly,
        quotas: form.quotas,
        issues: form.issues,
        off: form.off,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新建 key"
      width={640}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} onClick={submit}>
            创建
          </Button>
        </Space>
      }
    >
      <Row gutter={12}>
        <Col span={12}>
          <Label>名称</Label>
          <Input
            value={form.name}
            maxLength={120}
            placeholder="team-a-01"
            onChange={(e) => set({ name: e.target.value })}
            onPressEnter={submit}
          />
        </Col>
        <Col span={6}>
          <Label>到期</Label>
          <DatePicker
            style={{ width: "100%" }}
            value={form.expires ? dayjs(form.expires) : null}
            onChange={(d) => set({ expires: d ? d.format("YYYY-MM-DD") : "" })}
          />
        </Col>
        <Col span={6}>
          <Label>模板</Label>
          <Select
            style={{ width: "100%" }}
            value={form.templateId}
            options={templateOptions(templates)}
            onChange={pickTemplate}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 14 }}>
        <Text strong>权限配置</Text>
      </div>

      <div style={{ marginTop: 12 }}>
        <Label hint="（provider/* 表示整个厂商）">能用模型</Label>
        <ModelField
          value={form.models}
          onChange={(models) => set({ models })}
          providers={providers}
          groups={groups}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（逗号分隔；留空 = 不限）">上游账号</Label>
        <Input
          value={form.accounts}
          placeholder="openai/acct_xxx, anthropic/…"
          onChange={(e) => set({ accounts: e.target.value })}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（tokens 和美元都填 0 表示这条不限）">限额</Label>
        <LimitEditor rows={form.limits} onChange={(limits) => set({ limits })} />
      </div>

      <Space size={16} wrap style={{ marginTop: 14 }}>
        <Tooltip title="只读 key 只能查用量和余额，不能调用任何模型或写接口。">
          <Checkbox checked={form.readOnly} onChange={(e) => set({ readOnly: e.target.checked })}>
            只读
          </Checkbox>
        </Tooltip>
        <Checkbox checked={form.quotas} onChange={(e) => set({ quotas: e.target.checked })}>
          允许查看上游账号余额
        </Checkbox>
        <Checkbox checked={form.issues} onChange={(e) => set({ issues: e.target.checked })}>
          允许签发子 key
        </Checkbox>
        <Checkbox checked={form.off} onChange={(e) => set({ off: e.target.checked })}>
          先停用
        </Checkbox>
      </Space>

      <Err text={err} />
    </Modal>
  );
}

// ---------- 批量 ----------

interface BatchModalProps extends CommonProps {
  open: boolean;
  templates: TemplateItem[];
  initialTemplateId?: string | null;
  onClose(): void;
  onSubmit(body: BatchPayload): Promise<void>;
}

interface BatchForm {
  count: number;
  prefix: string;
  start: number;
  models: string;
  accounts: string;
  limits: LimitRow[];
  days: number;
  readOnly: boolean;
  quotas: boolean;
  issues: boolean;
  off: boolean;
  templateId: string;
}

const blankBatch = (): BatchForm => ({
  count: 5,
  prefix: "",
  start: 1,
  models: "",
  accounts: "",
  limits: blankLimits(),
  days: 0,
  readOnly: false,
  quotas: false,
  issues: false,
  off: false,
  templateId: "",
});

export function BatchModal({
  open,
  onClose,
  onSubmit,
  templates,
  providers,
  groups,
  initialTemplateId,
}: BatchModalProps) {
  const [form, setForm] = React.useState<BatchForm>(blankBatch);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    // 从模板页点「用这个模板发 key」进来时，直接把模板填好。
    const picked = initialTemplateId
      ? templates.find((t) => t.id === initialTemplateId)?.template
      : null;
    if (!picked) {
      setForm(blankBatch());
    } else {
      setForm({
        ...blankBatch(),
        templateId: initialTemplateId || "",
        models: (picked.models || []).join(", "),
        accounts: (picked.accounts || []).join(", "),
        limits: toLimitRows(picked.limits),
        days: picked.expiresInDays || 0,
        readOnly: !!picked.readOnly,
        quotas: !!picked.quotas,
        issues: !!picked.issues,
      });
    }
    setErr("");
    setBusy(false);
  }, [open, initialTemplateId, templates]);

  const set = (patch: Partial<BatchForm>) => setForm((f) => ({ ...f, ...patch }));

  const pickTemplate = (id: string) => {
    if (!id) {
      // 选回「不用模板」要把模板带进来的权限配置清掉，否则会以为没套模板、
      // 实际仍按上一份模板发。
      setForm((f) => ({ ...blankBatch(), count: f.count, prefix: f.prefix, start: f.start }));
      return;
    }
    const tpl = templates.find((x) => x.id === id)?.template;
    set({
      templateId: id,
      ...(tpl
        ? {
            models: (tpl.models || []).join(", "),
            accounts: (tpl.accounts || []).join(", "),
            limits: toLimitRows(tpl.limits),
            days: tpl.expiresInDays || 0,
            readOnly: !!tpl.readOnly,
            quotas: !!tpl.quotas,
            issues: !!tpl.issues,
          }
        : {}),
    });
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit({
        count: Number(form.count || 1),
        namePrefix: form.prefix,
        startAt: Number(form.start || 1),
        off: form.off,
        template: {
          models: form.models,
          accounts: form.accounts,
          limits: readLimits(form.limits),
          expiresInDays: form.days ? Number(form.days) : undefined,
          readOnly: form.readOnly,
          quotas: form.quotas,
          issues: form.issues,
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="批量发 key"
      width={660}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} onClick={submit}>
            开始生成
          </Button>
        </Space>
      }
    >
      <Row gutter={12}>
        <Col span={6}>
          <Label>数量</Label>
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            max={100}
            controls={false}
            value={form.count}
            onChange={(count) => set({ count: Number(count ?? 1) })}
          />
        </Col>
        <Col span={9}>
          <Label>名称前缀</Label>
          <Input
            value={form.prefix}
            placeholder="team-a"
            onChange={(e) => set({ prefix: e.target.value })}
            onPressEnter={submit}
          />
        </Col>
        <Col span={4}>
          <Label>起始编号</Label>
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            controls={false}
            value={form.start}
            onChange={(start) => set({ start: Number(start ?? 1) })}
          />
        </Col>
        <Col span={5}>
          <Label>模板</Label>
          <Select
            style={{ width: "100%" }}
            value={form.templateId}
            options={templateOptions(templates)}
            onChange={pickTemplate}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 14 }}>
        <Text strong>权限配置</Text>
      </div>

      <div style={{ marginTop: 12 }}>
        <Label>能用模型</Label>
        <ModelField
          value={form.models}
          onChange={(models) => set({ models })}
          providers={providers}
          groups={groups}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（逗号分隔；留空 = 不限）">上游账号</Label>
        <Input
          value={form.accounts}
          placeholder="openai/acct_xxx, anthropic/…"
          onChange={(e) => set({ accounts: e.target.value })}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（tokens 和美元都填 0 表示这条不限）">限额</Label>
        <LimitEditor rows={form.limits} onChange={(limits) => set({ limits })} />
      </div>

      <Row gutter={12} style={{ marginTop: 14 }}>
        <Col span={8}>
          <Label>有效期（天）</Label>
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            max={3650}
            controls={false}
            placeholder="留空 = 不过期"
            value={form.days || null}
            onChange={(days) => set({ days: Number(days ?? 0) })}
          />
        </Col>
        <Col span={16} style={{ display: "flex", alignItems: "flex-end", paddingBottom: 4 }}>
          <Space size={16} wrap>
            <Tooltip title="只读 key 只能查用量和余额，不能调用任何模型或写接口。">
              <Checkbox checked={form.readOnly} onChange={(e) => set({ readOnly: e.target.checked })}>
                只读
              </Checkbox>
            </Tooltip>
            <Checkbox checked={form.quotas} onChange={(e) => set({ quotas: e.target.checked })}>
              允许查看上游账号余额
            </Checkbox>
            <Checkbox checked={form.issues} onChange={(e) => set({ issues: e.target.checked })}>
              允许签发子 key
            </Checkbox>
            <Checkbox checked={form.off} onChange={(e) => set({ off: e.target.checked })}>
              先停用
            </Checkbox>
          </Space>
        </Col>
      </Row>
      <Err text={err} />
    </Modal>
  );
}

// ---------- 一次性密钥 ----------

interface IssuedProps {
  open: boolean;
  keys: IssuedKey[];
  onClose(): void;
  onCopy(text: string): void;
  onExport(): void;
}

export function IssuedModal({ open, keys, onClose, onCopy, onExport }: IssuedProps) {
  const columns: TableProps<IssuedKey>["columns"] = [
    { title: "名称", dataIndex: "name", width: 180 },
    {
      title: "密钥",
      dataIndex: "secret",
      render: (value: string) => (
        <Text code style={{ wordBreak: "break-all" }}>
          {value}
        </Text>
      ),
    },
    {
      title: "",
      width: 80,
      align: "right",
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => onCopy(row.secret)}>
          复制
        </Button>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title="新 key 已生成"
      width={780}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => onCopy(keys.map((k) => `${k.name},${k.secret}`).join("\n"))}>
            复制全部
          </Button>
          <Button onClick={onExport}>导出 CSV</Button>
          <span style={{ flex: 1 }} />
          <Button type="primary" onClick={onClose}>
            我已保存
          </Button>
        </div>
      }
    >
      <Table<IssuedKey>
        size="small"
        rowKey="secret"
        dataSource={keys}
        columns={columns}
        pagination={false}
        scroll={{ y: 320 }}
      />
      <Alert
        type="warning"
        showIcon
        message="密钥只在这里显示一次，关掉之前先复制或导出。"
        style={{ marginTop: 12 }}
      />
    </Modal>
  );
}

// ---------- 详情 ----------

interface DetailProps extends CommonProps {
  open: boolean;
  record: KeyRow | null;
  onClose(): void;
  onSave(body: KeyPayload): Promise<void>;
  onRotate(): void;
  onResetLimits(): void;
  onDelete(): void;
  onCopySecret(): void;
}

interface DetailForm {
  name: string;
  expires: string;
  models: string;
  accounts: string;
  limits: LimitRow[];
  off: boolean;
  readOnly: boolean;
  quotas: boolean;
  issues: boolean;
}

function detailForm(key: KeyRow | null): DetailForm {
  return {
    name: key?.name || "",
    expires: key?.expires ? key.expires.slice(0, 10) : "",
    models: (key?.models || []).join(", "),
    accounts: (key?.accounts || []).join(", "),
    limits: toLimitRows(key?.limits),
    off: !!key?.off,
    readOnly: !!key?.readOnly,
    quotas: !!key?.quotas,
    issues: !!key?.issues,
  };
}

export function DetailModal({
  open,
  record,
  onClose,
  onSave,
  onRotate,
  onResetLimits,
  onDelete,
  onCopySecret,
  providers,
  groups,
}: DetailProps) {
  const [form, setForm] = React.useState<DetailForm>(() => detailForm(record));
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(detailForm(record));
      setErr("");
      setBusy(false);
      setConfirmClose(false);
    }
  }, [open, record]);

  if (!record) return null;
  const isDefault = !!record.default;
  const set = (patch: Partial<DetailForm>) => setForm((f) => ({ ...f, ...patch }));
  // 点关闭时如果表单改过，先确认一次：这个弹窗里的改动没有自动保存。
  const dirty = JSON.stringify(form) !== JSON.stringify(detailForm(record));
  const requestClose = () => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    setConfirmClose(true);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const body: KeyPayload = {
        limits: readLimits(form.limits),
        models: form.models,
        accounts: form.accounts,
        quotas: form.quotas,
        issues: form.issues,
        ...(isDefault ? {} : { name: form.name, off: form.off, readOnly: form.readOnly }),
      };
      // 没动到期时间就不发：已过期的 key 也能保存，日期不会被改写成过去。
      const before = record.expires ? record.expires.slice(0, 10) : "";
      if (form.expires !== before) body.expires = expiresBody(form.expires);
      await onSave(body);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        title={record.name || "(未命名)"}
        width={680}
        onCancel={requestClose}
        maskClosable={false}
        destroyOnHidden
        footer={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tooltip title={isDefault ? "默认共享 key 请到 magpie 的 Gateway 页面删除" : undefined}>
              <Button danger onClick={onDelete} disabled={isDefault}>
                删除
              </Button>
            </Tooltip>
            <Button onClick={onResetLimits}>清零已用量</Button>
            <Tooltip title={isDefault ? "默认共享 key 请到 magpie 的 Gateway 页面轮换" : undefined}>
              <Button onClick={onRotate} disabled={isDefault}>
                轮换密钥
              </Button>
            </Tooltip>
            <Button onClick={onCopySecret}>复制密钥</Button>
            <span style={{ flex: 1 }} />
            <Button onClick={requestClose}>关闭</Button>
            <Button type="primary" loading={busy} onClick={save}>
              保存
            </Button>
          </div>
        }
      >
      <div style={{ marginBottom: 14 }}>
        <Text code>{record.masked}</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          id {record.id}
          {isDefault ? " · 默认共享 key" : ""}
        </Text>
      </div>

      <Row gutter={12}>
        <Col span={12}>
          <Label>{isDefault ? "名称（默认共享 key 改名请去 magpie）" : "名称"}</Label>
          <Input
            value={form.name}
            disabled={isDefault}
            onChange={(e) => set({ name: e.target.value })}
            onPressEnter={save}
          />
        </Col>
        <Col span={6}>
          <Label hint={isDefault ? "（默认共享 key 的到期由 magpie 管理）" : undefined}>到期</Label>
          <DatePicker
            style={{ width: "100%" }}
            disabled={isDefault}
            value={form.expires ? dayjs(form.expires) : null}
            onChange={(d) => set({ expires: d ? d.format("YYYY-MM-DD") : "" })}
          />
        </Col>
        <Col span={6}>
          <Label>状态</Label>
          <Select
            style={{ width: "100%" }}
            disabled={isDefault}
            value={form.off ? "off" : "on"}
            options={[
              { value: "on", label: "启用" },
              { value: "off", label: "停用" },
            ]}
            onChange={(v: string) => set({ off: v === "off" })}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 14 }}>
        <Label>限额</Label>
        <LimitEditor rows={form.limits} onChange={(limits) => set({ limits })} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label>当前用量</Label>
        {record.off ? (
          <Text type="secondary">已停用，网关不统计用量。</Text>
        ) : record.budget?.limits?.length ? (
          <div
            style={{
              border: "1px solid rgba(128,128,128,.25)",
              borderRadius: 8,
              padding: "6px 10px",
            }}
          >
            {record.budget.limits.map((l, i) => (
              <div key={i} className="sub" style={{ lineHeight: 1.8 }}>
                {budgetWindow(l)} ·{" "}
                {l.costLimit
                  ? `${fmtCost(l.cost)} / ${fmtCost(l.costLimit)}`
                  : `${fmtNum(l.tokens)} / ${fmtNum(l.tokenLimit)} tok`}
                {l.reset ? ` · ${fmtDate(l.reset)} 重置` : ""}
                {l.spent ? " · 已用尽" : ""}
                {l.unpriced ? ` · ${fmtNum(l.unpriced)} 次未计价` : ""}
              </div>
            ))}
          </div>
        ) : record.limits?.length ? (
          <Text type="secondary">用量暂时取不到（网关连不上或还没认出这把 key）。</Text>
        ) : (
          <Text type="secondary">不限</Text>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Label>模型</Label>
        <ModelField
          value={form.models}
          onChange={(models) => set({ models })}
          providers={providers}
          groups={groups}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（逗号分隔；留空 = 不限）">上游账号</Label>
        <Input
          value={form.accounts}
          placeholder="openai/acct_xxx, anthropic/…"
          onChange={(e) => set({ accounts: e.target.value })}
        />
      </div>

      <Space size={16} wrap style={{ marginTop: 14 }}>
        <Tooltip title="只读 key 只能查用量和余额，不能调用任何模型或写接口。">
          <Checkbox
            checked={form.readOnly}
            disabled={isDefault}
            onChange={(e) => set({ readOnly: e.target.checked })}
          >
            只读
          </Checkbox>
        </Tooltip>
        <Checkbox checked={form.quotas} onChange={(e) => set({ quotas: e.target.checked })}>
          允许查看上游账号余额
        </Checkbox>
        <Checkbox
          checked={form.issues}
          disabled={isDefault}
          onChange={(e) => set({ issues: e.target.checked })}
        >
          允许签发子 key
        </Checkbox>
      </Space>
      <Err text={err} />
      </Modal>
      <Modal
        open={confirmClose}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmClose(false)}
        maskClosable={false}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setConfirmClose(false)}>继续编辑</Button>
            <Button
              danger
              type="primary"
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              放弃修改
            </Button>
          </Space>
        }
      >
        <div>「{record.name || record.id}」的改动还没保存，关闭后会丢失。</div>
      </Modal>
    </>
  );
}

// ---------- 模板 ----------

interface TemplateModalProps extends CommonProps {
  open: boolean;
  template: TemplateItem | null;
  onClose(): void;
  onSubmit(name: string, template: Template, id?: string): Promise<void>;
}

interface TemplateForm {
  name: string;
  models: string;
  accounts: string;
  limits: LimitRow[];
  days: number;
  readOnly: boolean;
  quotas: boolean;
  issues: boolean;
}

const blankTemplate = (): TemplateForm => ({
  name: "",
  models: "",
  accounts: "",
  limits: blankLimits(),
  days: 0,
  readOnly: false,
  quotas: false,
  issues: false,
});

export function TemplateModal({
  open,
  template,
  onClose,
  onSubmit,
  providers,
  groups,
}: TemplateModalProps) {
  const [form, setForm] = React.useState<TemplateForm>(blankTemplate);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (!template) {
      setForm(blankTemplate());
    } else {
      const tpl = template.template;
      setForm({
        name: template.name,
        models: (tpl?.models || []).join(", "),
        accounts: (tpl?.accounts || []).join(", "),
        limits: toLimitRows(tpl?.limits),
        days: tpl?.expiresInDays || 0,
        readOnly: !!tpl?.readOnly,
        quotas: !!tpl?.quotas,
        issues: !!tpl?.issues,
      });
    }
    setErr("");
    setBusy(false);
  }, [open, template]);

  const set = (patch: Partial<TemplateForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(
        form.name,
        {
          models: form.models.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          accounts: form.accounts.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
          limits: readLimits(form.limits),
          expiresInDays: form.days ? Number(form.days) : undefined,
          readOnly: form.readOnly,
          quotas: form.quotas,
          issues: form.issues,
        },
        template?.id,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={template ? "编辑模板" : "新建模板"}
      width={620}
      onCancel={onClose}
      maskClosable={false}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={busy} onClick={submit}>
            保存
          </Button>
        </Space>
      }
    >
      <Row gutter={12}>
        <Col span={14}>
          <Label>名称</Label>
          <Input
            value={form.name}
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
            onPressEnter={submit}
          />
        </Col>
        <Col span={10}>
          <Label>有效期（天）</Label>
          <InputNumber
            style={{ width: "100%" }}
            min={1}
            max={3650}
            controls={false}
            value={form.days || null}
            onChange={(days) => set({ days: Number(days ?? 0) })}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 14 }}>
        <Label>模型</Label>
        <ModelField
          value={form.models}
          onChange={(models) => set({ models })}
          providers={providers}
          groups={groups}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label hint="（逗号分隔；留空 = 不限）">上游账号</Label>
        <Input
          value={form.accounts}
          placeholder="openai/acct_xxx, anthropic/…"
          onChange={(e) => set({ accounts: e.target.value })}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Label>限额</Label>
        <LimitEditor rows={form.limits} onChange={(limits) => set({ limits })} />
      </div>

      <Space size={16} style={{ marginTop: 14 }}>
        <Tooltip title="只读 key 只能查用量和余额，不能调用任何模型或写接口。">
          <Checkbox checked={form.readOnly} onChange={(e) => set({ readOnly: e.target.checked })}>
            只读
          </Checkbox>
        </Tooltip>
        <Checkbox checked={form.quotas} onChange={(e) => set({ quotas: e.target.checked })}>
          允许查看上游账号余额
        </Checkbox>
        <Checkbox checked={form.issues} onChange={(e) => set({ issues: e.target.checked })}>
          允许签发子 key
        </Checkbox>
      </Space>
      <Err text={err} />
    </Modal>
  );
}

// ---------- 确认 ----------

export interface ConfirmState {
  title: string;
  text: string;
  danger: boolean;
}

export function ConfirmModal({
  state,
  onDone,
}: {
  state: ConfirmState | null;
  onDone(ok: boolean): void;
}) {
  return (
    <Modal
      open={!!state}
      title={state?.title || "确认"}
      onCancel={() => onDone(false)}
      maskClosable={false}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={() => onDone(false)}>取消</Button>
          <Button danger={state?.danger !== false} type="primary" onClick={() => onDone(true)}>
            确定
          </Button>
        </Space>
      }
    >
      <div style={{ padding: "4px 0", whiteSpace: "pre-line" }}>{state?.text}</div>
    </Modal>
  );
}

// ---------- 手动复制 ----------

export function CopyModal({
  open,
  text,
  onClose,
}: {
  open: boolean;
  text: string;
  onClose(): void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const select = () => {
    ref.current?.focus();
    ref.current?.select();
  };
  React.useEffect(() => {
    if (open) setTimeout(select, 0);
  }, [open]);

  return (
    <Modal
      open={open}
      title="手动复制"
      width={520}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={select}>重新全选</Button>
          <Button type="primary" onClick={onClose}>
            关闭
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="这个页面跑在 magpie 的沙箱里，剪贴板被禁用。内容已经全选，按 ⌘C（Windows 上 Ctrl+C）复制。"
      />
      <textarea ref={ref} className="copybox" readOnly value={text} rows={5} />
    </Modal>
  );
}

// ---------- 导出结果 ----------

export function ExportModal({
  open,
  path,
  onClose,
  onCopy,
}: {
  open: boolean;
  path: string;
  onClose(): void;
  onCopy(text: string): void;
}) {
  return (
    <Modal
      open={open}
      title="已导出"
      width={560}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={() => onCopy(path)}>复制路径</Button>
          <Button type="primary" onClick={onClose}>
            好
          </Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        文件写在运行 magpie 的这台机器上：
      </Text>
      <div style={{ margin: "8px 0 12px" }}>
        <Text code style={{ wordBreak: "break-all" }}>
          {path}
        </Text>
      </div>
      <Alert
        type="info"
        showIcon
        message="沙箱页面不能直接下载文件。可以复制上面的路径，在 Finder 里按 ⌘⇧G 打开。"
      />
    </Modal>
  );
}
