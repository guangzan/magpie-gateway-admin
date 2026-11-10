import { useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, ReloadOutlined, SearchOutlined, TeamOutlined } from "@ant-design/icons";

import { budgetDisplay, budgetRatio, fmtCost, fmtNum, limitWord, stateOf } from "../format";
import type { KeyRow, Period } from "../types";

const { Text } = Typography;

const PERIODS: { value: Period | "off"; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
  { value: "off", label: "不显示" },
];

type StatusFilter = "" | "enabled" | "off" | "expired" | "exhausted" | "near" | "expiring";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "全部状态" },
  { value: "enabled", label: "启用中" },
  { value: "off", label: "已停用" },
  { value: "expired", label: "已过期" },
  { value: "exhausted", label: "限额已用尽" },
  { value: "near", label: "限额 ≥80%" },
  { value: "expiring", label: "7 天内到期" },
];

const WEEK = 7 * 24 * 60 * 60 * 1000;

function expiringSoon(key: KeyRow): boolean {
  if (key.off || !key.expires) return false;
  const at = new Date(key.expires).getTime();
  return at > Date.now() && at <= Date.now() + WEEK;
}

interface Props {
  keys: KeyRow[];
  period: Period | "off";
  loading: boolean;
  warning: string;
  error: string;
  usageOk: boolean;
  updatedAt: number;
  onPeriod(period: Period | "off"): void;
  onNew(): void;
  onBatch(): void;
  onExport(): void;
  onRefresh(): void;
  onCopy(key: KeyRow): void;
  onEdit(key: KeyRow): void;
  onToggle(key: KeyRow): void;
  onUsage(key: KeyRow): void;
  onBulk(action: "off" | "on" | "delete", ids: string[]): Promise<void>;
}

export default function KeysView({
  keys,
  period,
  loading,
  warning,
  error,
  usageOk,
  updatedAt,
  onPeriod,
  onNew,
  onBatch,
  onExport,
  onRefresh,
  onCopy,
  onEdit,
  onToggle,
  onUsage,
  onBulk,
}: Props) {
  const { token } = theme.useToken();
  // 用量取不到时整列隐藏：宁可没有这一列，也不要把「不知道」显示成 0。
  const showUsage = period !== "off" && usageOk;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);

  const ratioOf = (key: KeyRow) => budgetRatio(key.budget?.limits, key.budget?.binding);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return keys.filter((key) => {
      if (needle) {
        const hay = [key.name, key.id, key.masked, key.issuer]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
        if (!hay) return false;
      }
      if (status === "off") return key.off;
      if (status === "expired") return stateOf(key).label === "已过期";
      if (status === "enabled") return !key.off && stateOf(key).label !== "已过期";
      if (status === "expiring") return expiringSoon(key);
      if (status === "exhausted") return !!budgetDisplay(key.budget?.limits, key.budget?.binding)?.spent;
      if (status === "near") {
        const ratio = ratioOf(key);
        return ratio >= 0.8 && ratio < 1;
      }
      return true;
    });
  }, [keys, query, status]);

  // 「需要关注」直接回答管理员每天的两个问题：谁快用完了、谁要到期了。
  const attention = useMemo(() => {
    const out = { exhausted: 0, near: 0, expiring: 0, off: 0, expired: 0 };
    for (const key of keys) {
      if (key.off) out.off += 1;
      if (stateOf(key).label === "已过期") out.expired += 1;
      if (expiringSoon(key)) out.expiring += 1;
      const display = budgetDisplay(key.budget?.limits, key.budget?.binding);
      const ratio = ratioOf(key);
      if (display?.spent) out.exhausted += 1;
      else if (ratio >= 0.8) out.near += 1;
    }
    return out;
  }, [keys]);

  const runBulk = (action: "off" | "on" | "delete") => {
    const ids = selected.filter((id) => !keys.find((key) => key.id === id)?.default);
    if (!ids.length) return;
    void Promise.resolve(onBulk(action, ids)).finally(() => setSelected([]));
  };

  const columns: NonNullable<TableProps<KeyRow>["columns"]> = [
    {
      title: "名称",
      dataIndex: "name",
      width: 200,
      fixed: "left",
      sorter: (a, b) => (a.name || "").localeCompare(b.name || "", "zh-CN"),
      render: (_, row) => (
        <div>
          <div className="rowtitle">{row.name || "(未命名)"}</div>
          {row.default ? <div className="sub">默认共享 key</div> : null}
          {!row.default && row.issuer ? <div className="sub">由 {row.issuer} 签发</div> : null}
        </div>
      ),
    },
    {
      title: "密钥",
      dataIndex: "masked",
      width: 190,
      render: (value: string) => (
        <Text code style={{ fontSize: 12 }}>
          {value || "…"}
        </Text>
      ),
    },
    {
      title: "状态",
      width: 170,
      render: (_, row) => {
        const state = stateOf(row);
        return (
          <Space size={4} wrap>
            <Tag color={state.color} style={{ margin: 0 }}>
              {state.label}
            </Tag>
            {row.readOnly ? (
              <Tooltip title="只读 key 只能查用量和余额，不能调用模型">
                <Tag style={{ margin: 0 }}>只读</Tag>
              </Tooltip>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "限额",
      width: 230,
      render: (_, row) => {
        const limits = row.limits || [];
        if (!limits.length) return <Text type="secondary">不限</Text>;
        return (
          <div>
            {limits.slice(0, 2).map((l, i) => (
              <div key={i} className="sub">
                {limitWord(l)}
              </div>
            ))}
            {limits.length > 2 ? <div className="sub">+{limits.length - 2}</div> : null}
          </div>
        );
      },
    },
    {
      title: "限额",
      width: 260,
      sorter: (a, b) => ratioOf(a) - ratioOf(b),
      render: (_, row) => {
        if (row.off) return <Text type="secondary">已停用</Text>;
        const budget = budgetDisplay(row.budget?.limits, row.budget?.binding);
        if (!budget) {
          if (!row.limits?.length) return <Text type="secondary">不限</Text>;
          return (
            <Tooltip title="限额读取超时，或网关还没认出这把 key。点「刷新」再试。">
              <Text type="secondary">限额未知</Text>
            </Tooltip>
          );
        }
        const color = budget.spent
          ? token.colorErrorText
          : budget.warning
            ? token.colorWarningText
            : undefined;
        return (
          <span style={{ color }}>
            {budget.spent ? "已用尽 · " : ""}
            {budget.text}
          </span>
        );
      },
    },
    ...(showUsage
      ? [
          {
            title: "调用",
            width: 90,
            align: "right" as const,
            sorter: (a: KeyRow, b: KeyRow) => (a.usage?.calls || 0) - (b.usage?.calls || 0),
            render: (_: unknown, row: KeyRow) =>
              row.usage ? fmtNum(row.usage.calls) : <Text type="secondary">—</Text>,
          },
          {
            title: "花费（估算）",
            width: 120,
            align: "right" as const,
            sorter: (a: KeyRow, b: KeyRow) => (a.usage?.cost || 0) - (b.usage?.cost || 0),
            render: (_: unknown, row: KeyRow) => {
              if (!row.usage) return <Text type="secondary">—</Text>;
              const unpriced = row.usage.unpriced || 0;
              return (
                <span>
                  {fmtCost(row.usage.cost)}
                  {unpriced ? (
                    <Tooltip title={`含 ${unpriced} 次未计价调用，按 $0 计，实际花费可能更高`}>
                      <span style={{ color: token.colorWarningText }}> *</span>
                    </Tooltip>
                  ) : null}
                </span>
              );
            },
          },
        ]
      : []),
    {
      title: "操作",
      width: 200,
      align: "right",
      fixed: "right",
      render: (_, row) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => onCopy(row)}>
            复制
          </Button>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => onUsage(row)}>
            用量
          </Button>
          <Tooltip
            title={row.default ? "默认共享 key 请在 magpie 的 Gateway 页面停用" : undefined}
          >
            <Button
              type="link"
              size="small"
              disabled={row.default}
              onClick={() => onToggle(row)}
            >
              {row.off ? "启用" : "停用"}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const nothingToShow = !keys.length && !error && !query && !status;
  const emptyText = error
    ? "读不到 key 列表，见上方提示。"
    : query || status
      ? "没有符合筛选条件的 key。"
      : "还没有 key。点「新建 key」或「批量发 key」开始。";

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>
          新建 key
        </Button>
        <Button icon={<TeamOutlined />} onClick={onBatch}>
          批量发 key
        </Button>
        <Button onClick={onExport}>导出 CSV</Button>
        <Input
          value={query}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜名称 / id / 密钥"
          style={{ width: 220 }}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <Select
          value={status}
          options={STATUS_FILTERS}
          onChange={(value: StatusFilter) => {
            setStatus(value);
            setPage(1);
          }}
          style={{ width: 132 }}
          aria-label="状态筛选"
        />
        <span style={{ flex: 1 }} />
        <Select
          value={period}
          options={PERIODS}
          onChange={onPeriod}
          style={{ width: 120 }}
          aria-label="用量区间"
        />
        <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>
          刷新
        </Button>
        {updatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新于 {new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}
          </Text>
        ) : null}
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="读不到 key 列表"
          description={
            <span>
              {error}
              {keys.length ? " 下面是上一次成功加载的数据。" : ""}
            </span>
          }
          action={
            <Button size="small" onClick={onRefresh}>
              重试
            </Button>
          }
        />
      ) : null}

      {warning ? (
        <Alert type="warning" showIcon message={warning} style={{ marginBottom: 12 }} />
      ) : null}

      {attention.exhausted + attention.near + attention.expiring > 0 ? (
        <Space wrap size={[6, 6]} style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            需要关注
          </Text>
          {attention.exhausted ? (
            <Tag color="red" style={{ margin: 0, cursor: "pointer" }} onClick={() => setStatus("exhausted")}>
              限额用尽 {attention.exhausted}
            </Tag>
          ) : null}
          {attention.near ? (
            <Tag color="orange" style={{ margin: 0, cursor: "pointer" }} onClick={() => setStatus("near")}>
              接近上限 {attention.near}
            </Tag>
          ) : null}
          {attention.expiring ? (
            <Tag color="gold" style={{ margin: 0, cursor: "pointer" }} onClick={() => setStatus("expiring")}>
              7 天内到期 {attention.expiring}
            </Tag>
          ) : null}
        </Space>
      ) : null}

      {selected.length ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "8px 12px",
            marginBottom: 12,
            border: "1px solid rgba(128,128,128,.25)",
            borderRadius: 8,
          }}
        >
          <Text>已选 {selected.length} 把</Text>
          <Button size="small" onClick={() => runBulk("on")}>
            启用
          </Button>
          <Button size="small" onClick={() => runBulk("off")}>
            停用
          </Button>
          <Button size="small" danger onClick={() => runBulk("delete")}>
            删除
          </Button>
          <Button size="small" type="link" onClick={() => setSelected([])}>
            取消选择
          </Button>
        </div>
      ) : null}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<KeyRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={filtered}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (next) => setSelected(next.map(String)),
            getCheckboxProps: (row) => ({ disabled: row.default }),
          }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            showTotal: (total) => `共 ${total} 把 key`,
            // Card 的 body padding 是 0，表格要通栏；分页器得自己留出左右边距，
            // 否则「条/页」选择器会贴在卡片边框上。
            styles: { root: { paddingInline: 16 } },
            onChange: (next, size) => {
              setPage(next);
              setPageSize(size);
            },
          }}
          scroll={{ x: 1360 }}
          locale={{ emptyText: nothingToShow ? "还没有 key。点「新建 key」或「批量发 key」开始。" : emptyText }}
        />
      </Card>
    </div>
  );
}
