import { useEffect } from "react";
import {
  Alert,
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
  const setUsageCallerKey = useShell((s) => s.setUsageCallerKey);

  useEffect(() => {
    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = new Map(keys.map((k) => [k.id, k.name]));
  const summary = usage.summary;
  // 没加载成功时显示「—」，不能显示 0：0 和「取不到」在报表上是两件事。
  const value = (n?: number) => (usage.loaded && n != null ? fmtNum(n) : "—");
  const money = (n?: number) => (usage.loaded && n != null ? fmtCost(n) : "—");

  const cards: [string, string][] = [
    ["调用", value(summary.calls)],
    ["错误", value(summary.errors)],
    ["花费（估算）", money(summary.cost)],
    ["未计价调用", value(summary.unpriced)],
    ["输入", value(summary.input)],
    ["输出", value(summary.output)],
    ["缓存读", value(summary.cache_read)],
    ["缓存写", value(summary.cache_write)],
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
    {
      title: "调用",
      dataIndex: "calls",
      width: 90,
      align: "right",
      sorter: (a, b) => (a.calls || 0) - (b.calls || 0),
      render: (v) => fmtNum(v),
    },
    {
      title: "错误",
      dataIndex: "errors",
      width: 90,
      align: "right",
      sorter: (a, b) => (a.errors || 0) - (b.errors || 0),
      render: (v) => fmtNum(v),
    },
    {
      title: "输入",
      dataIndex: "input",
      width: 100,
      align: "right",
      sorter: (a, b) => (a.input || 0) - (b.input || 0),
      render: (v) => fmtNum(v),
    },
    {
      title: "输出",
      dataIndex: "output",
      width: 100,
      align: "right",
      sorter: (a, b) => (a.output || 0) - (b.output || 0),
      render: (v) => fmtNum(v),
    },
    {
      title: "缓存读",
      dataIndex: "cache_read",
      width: 100,
      align: "right",
      sorter: (a, b) => (a.cache_read || 0) - (b.cache_read || 0),
      render: (v) => fmtNum(v),
    },
    {
      title: "花费（估算）",
      dataIndex: "cost",
      width: 110,
      align: "right",
      sorter: (a, b) => (a.cost || 0) - (b.cost || 0),
      render: (v, row) => (
        <span>
          {fmtCost(v)}
          {(row.unpriced || 0) > 0 ? (
            <Typography.Text type="warning" style={{ fontSize: 11, marginLeft: 2 }}>
              *
            </Typography.Text>
          ) : null}
        </span>
      ),
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
        {usage.updatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新于 {new Date(usage.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}
          </Text>
        ) : null}
      </div>

      {usage.error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="用量取不到"
          description={
            <span>
              {usage.error}
              {usage.loaded ? " 下面显示的是上一次成功加载的数据。" : ""}
            </span>
          }
          action={
            <Button size="small" onClick={() => void loadUsage()}>
              重试
            </Button>
          }
        />
      ) : null}

      <Row gutter={[12, 12]}>
        {cards.map(([label, value]) => (
          <Col key={label} xs={12} sm={8} xl={4}>
            <Card size="small">
              <Statistic title={label} value={value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
        花费按网关价格估算；未计价调用按 $0 计，不计入美元限额。统计区间以运行网关的机器时区为准。
      </Text>

      <div style={{ margin: "18px 0 10px" }}>
        <Text strong>按 key</Text>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          点一行，下面只看这把 key 的请求
        </Text>
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<UsageGroup>
          rowKey={(row) => row.callerKeyId || row.id || ""}
          size="small"
          dataSource={usage.groups}
          columns={groupColumns}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{
            emptyText: usage.error
              ? "用量取不到，见上方提示。"
              : usage.loaded
                ? "这段时间没有按 key 归集的调用。"
                : "加载中…",
          }}
          onRow={(row) => {
            const id = row.callerKeyId || row.id || "";
            if (!id) return {};
            return {
              onClick: () => setUsageCallerKey(id),
              style: { cursor: "pointer" },
              title: "只看这把 key 的请求",
            };
          }}
          rowClassName={(row) =>
            (row.callerKeyId || row.id || "") === usage.callerKey ? "ant-table-row-selected" : ""
          }
        />
      </Card>

      <div style={{ margin: "18px 0 10px" }}>
        <Text strong>最近请求</Text>
      </div>
      <Space wrap style={{ marginBottom: 12 }}>
        {usage.callerKey ? (
          <Tag
            closable
            color="blue"
            onClose={(e) => {
              e.preventDefault();
              setUsageCallerKey("");
            }}
          >
            只看 {names.get(usage.callerKey) || usage.callerKey}
          </Tag>
        ) : null}
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
          loading={usage.loading}
          locale={{
            emptyText: usage.error
              ? "请求明细取不到，见上方提示。"
              : usage.loaded
                ? "没有请求。"
                : "加载中…",
          }}
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
