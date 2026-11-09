import { useEffect } from "react";
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";

import { fmtCost, fmtDate, fmtNum } from "../format";
import { useShell } from "../store";
import type { Period, UsageGroup, UsageRequest } from "../types";

const { Text } = Typography;

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
];

export default function UsageView() {
  const usage = useShell((s) => s.usage);
  const keys = useShell((s) => s.keys);
  const loadUsage = useShell((s) => s.loadUsage);
  const loadRequests = useShell((s) => s.loadRequests);
  const setUsagePeriod = useShell((s) => s.setUsagePeriod);
  const setUsageFilter = useShell((s) => s.setUsageFilter);
  const setUsageQuery = useShell((s) => s.setUsageQuery);

  useEffect(() => {
    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = new Map(keys.map((k) => [k.id, k.name]));
  const summary = usage.summary;

  const cards: [string, string][] = [
    ["调用", fmtNum(summary.calls)],
    ["错误", fmtNum(summary.errors)],
    ["花费", fmtCost(summary.cost)],
    ["输入", fmtNum(summary.input)],
    ["输出", fmtNum(summary.output)],
    ["缓存读", fmtNum(summary.cache_read)],
  ];

  const groupColumns: TableProps<UsageGroup>["columns"] = [
    {
      title: "key",
      render: (_, row) => {
        const id = row.callerKeyId || row.id || "";
        return (
          <div>
            <div className="rowtitle">{names.get(id) || row.callerKeyName || id}</div>
            <div className="sub mono">{id}</div>
          </div>
        );
      },
    },
    { title: "调用", dataIndex: "calls", width: 90, align: "right", render: (v) => fmtNum(v) },
    { title: "错误", dataIndex: "errors", width: 90, align: "right", render: (v) => fmtNum(v) },
    { title: "输入", dataIndex: "input", width: 100, align: "right", render: (v) => fmtNum(v) },
    { title: "输出", dataIndex: "output", width: 100, align: "right", render: (v) => fmtNum(v) },
    {
      title: "缓存读",
      dataIndex: "cache_read",
      width: 100,
      align: "right",
      render: (v) => fmtNum(v),
    },
    {
      title: "花费",
      dataIndex: "cost",
      width: 100,
      align: "right",
      render: (v) => fmtCost(v),
    },
  ];

  const requestColumns: TableProps<UsageRequest>["columns"] = [
    {
      title: "时间",
      dataIndex: "t",
      width: 140,
      render: (v: string) => <span className="sub">{fmtDate(v)}</span>,
    },
    {
      title: "key",
      width: 160,
      render: (_, row) => (
        <span className="sub">{row.callerKeyName || row.callerKeyId || "—"}</span>
      ),
    },
    {
      title: "模型",
      render: (_, row) => (
        <div>
          <div>{row.req || row.model || ""}</div>
          <div className="sub">{row.providerName || row.provider || ""}</div>
        </div>
      ),
    },
    {
      title: "状态",
      width: 80,
      render: (_, row) => (
        <Tag color={(row.status || 0) >= 400 ? "red" : "green"} style={{ margin: 0 }}>
          {row.status || ""}
        </Tag>
      ),
    },
    {
      title: "耗时",
      width: 80,
      align: "right",
      render: (_, row) => (row.ms ? `${Math.round(row.ms / 100) / 10}s` : ""),
    },
    { title: "输入", dataIndex: "in", width: 90, align: "right", render: (v) => fmtNum(v) },
    { title: "输出", dataIndex: "out", width: 90, align: "right", render: (v) => fmtNum(v) },
    {
      title: "花费",
      dataIndex: "cost",
      width: 90,
      align: "right",
      render: (v) => fmtCost(v),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <Select
          value={usage.period}
          options={PERIODS}
          style={{ width: 120 }}
          onChange={setUsagePeriod}
          aria-label="区间"
        />
        <Button icon={<ReloadOutlined />} loading={usage.loading} onClick={() => void loadUsage()}>
          刷新
        </Button>
      </div>

      <Row gutter={[12, 12]}>
        {cards.map(([label, value]) => (
          <Col key={label} xs={12} sm={8} xl={4}>
            <Card size="small">
              <Statistic title={label} value={value} />
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ margin: "18px 0 10px" }}>
        <Text strong>按 key</Text>
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<UsageGroup>
          rowKey={(row) => row.callerKeyId || row.id || ""}
          size="middle"
          dataSource={usage.groups}
          columns={groupColumns}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: "这段时间没有按 key 归集的调用。" }}
        />
      </Card>

      <div style={{ margin: "18px 0 10px" }}>
        <Text strong>最近请求</Text>
      </div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          value={usage.filter}
          style={{ width: 120 }}
          aria-label="只看"
          options={[
            { value: "", label: "全部" },
            { value: "failed", label: "失败" },
            { value: "retried", label: "重试过" },
          ]}
          onChange={setUsageFilter}
        />
        <Input
          value={usage.q}
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索模型 / key / 会话"
          style={{ width: 260 }}
          onChange={(e) => setUsageQuery(e.target.value)}
          onPressEnter={() => void loadRequests(true)}
        />
        <Button onClick={() => void loadRequests(true)}>查询</Button>
      </Space>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<UsageRequest>
          rowKey={(row, i) => `${row.t || ""}-${row.model || ""}-${i}`}
          size="small"
          dataSource={usage.requests}
          columns={requestColumns}
          pagination={false}
          scroll={{ x: 960 }}
          locale={{ emptyText: "没有请求。" }}
        />
      </Card>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <Button
          disabled={usage.requests.length >= usage.total}
          loading={usage.loadingMore}
          onClick={() => void loadRequests(false)}
        >
          加载更多
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          已显示 {usage.requests.length} / {usage.total}
        </Text>
      </div>
    </div>
  );
}
