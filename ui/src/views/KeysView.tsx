import { Alert, Button, Card, Select, Space, Table, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined, ReloadOutlined, TeamOutlined } from "@ant-design/icons";

import { fmtCost, fmtNum, limitWord, stateOf } from "../format";
import type { KeyRow, Period } from "../types";

const { Text } = Typography;

const PERIODS: { value: Period | "off"; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
  { value: "off", label: "不显示" },
];

interface Props {
  keys: KeyRow[];
  period: Period | "off";
  loading: boolean;
  warning: string;
  onPeriod(period: Period | "off"): void;
  onNew(): void;
  onBatch(): void;
  onExport(): void;
  onRefresh(): void;
  onEdit(key: KeyRow): void;
  onToggle(key: KeyRow): void;
}

export default function KeysView({
  keys,
  period,
  loading,
  warning,
  onPeriod,
  onNew,
  onBatch,
  onExport,
  onRefresh,
  onEdit,
  onToggle,
}: Props) {
  const showUsage = period !== "off";

  const columns: NonNullable<TableProps<KeyRow>["columns"]> = [
    {
      title: "名称",
      dataIndex: "name",
      width: 200,
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
            {row.readOnly ? <Tag style={{ margin: 0 }}>只读</Tag> : null}
            {row.maxConcurrency ? (
              <Tag style={{ margin: 0 }}>并发 {row.maxConcurrency}</Tag>
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
      title: "模型",
      width: 200,
      render: (_, row) => {
        const models = row.models || [];
        if (!models.length) return <Text type="secondary">全部</Text>;
        return (
          <div className="sub">
            {models.slice(0, 3).join(", ")}
            {models.length > 3 ? ` +${models.length - 3}` : ""}
          </div>
        );
      },
    },
    ...(showUsage
      ? [
          {
            title: "调用",
            width: 90,
            align: "right" as const,
            render: (_: unknown, row: KeyRow) => (row.usage ? fmtNum(row.usage.calls) : "—"),
          },
          {
            title: "花费",
            width: 100,
            align: "right" as const,
            render: (_: unknown, row: KeyRow) => (row.usage ? fmtCost(row.usage.cost) : "—"),
          },
        ]
      : []),
    {
      title: "操作",
      width: 120,
      align: "right",
      render: (_, row) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => onToggle(row)}>
            {row.off ? "启用" : "停用"}
          </Button>
        </Space>
      ),
    },
  ];

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
      </div>

      {warning ? (
        <Alert type="warning" showIcon message={warning} style={{ marginBottom: 12 }} />
      ) : null}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<KeyRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={keys}
          columns={columns}
          pagination={false}
          scroll={{ x: 1180 }}
          locale={{ emptyText: "还没有 key。点「新建 key」或「批量发 key」开始。" }}
        />
      </Card>
    </div>
  );
}
