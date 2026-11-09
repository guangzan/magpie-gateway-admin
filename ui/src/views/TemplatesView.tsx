import { Button, Card, Space, Table, Typography } from "antd";
import type { TableProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { limitWord } from "../format";
import type { TemplateItem } from "../types";

const { Text } = Typography;

interface Props {
  templates: TemplateItem[];
  loading: boolean;
  onNew(): void;
  onEdit(item: TemplateItem): void;
  onDelete(item: TemplateItem): void;
}

export default function TemplatesView({ templates, loading, onNew, onEdit, onDelete }: Props) {
  const columns: TableProps<TemplateItem>["columns"] = [
    { title: "名称", dataIndex: "name", width: 200 },
    {
      title: "模型",
      width: 240,
      render: (_, row) => {
        const models = row.template?.models || [];
        return models.length ? <span className="sub">{models.join(", ")}</span> : "全部";
      },
    },
    {
      title: "限额",
      render: (_, row) => {
        const limits = row.template?.limits || [];
        if (!limits.length) return <Text type="secondary">不限</Text>;
        return (
          <div>
            {limits.map((l, i) => (
              <div key={i} className="sub">
                {limitWord(l)}
              </div>
            ))}
          </div>
        );
      },
    },
    {
      title: "并发",
      width: 90,
      align: "right",
      render: (_, row) => row.template?.maxConcurrency || "—",
    },
    {
      title: "到期",
      width: 100,
      align: "right",
      render: (_, row) =>
        row.template?.expiresInDays ? `${row.template.expiresInDays} 天` : "—",
    },
    {
      title: "操作",
      width: 130,
      align: "right",
      render: (_, row) => (
        <Space size={2}>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => onDelete(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>
          新建模板
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          模板决定批量发 key 时的模型、限额、并发与到期。
        </Text>
      </div>
      <Card styles={{ body: { padding: 0 } }}>
        <Table<TemplateItem>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={templates}
          columns={columns}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: "还没有模板。" }}
        />
      </Card>
    </div>
  );
}
