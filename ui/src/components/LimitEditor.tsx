import { Button, Input, InputNumber, Select, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

import type { LimitPeriod, LimitRow } from "../types";

const PERIODS: { value: LimitPeriod; label: string }[] = [
  { value: "day", label: "每天" },
  { value: "week", label: "每周" },
  { value: "month", label: "每月" },
  { value: "days", label: "N 天" },
  { value: "hours", label: "N 小时" },
];

const GRID = "96px 92px minmax(96px,1fr) minmax(96px,1fr) minmax(120px,1.3fr) 32px";

interface Props {
  rows: LimitRow[];
  onChange(rows: LimitRow[]): void;
  max?: number;
}

export default function LimitEditor({ rows, onChange, max = 5 }: Props) {
  const list = rows || [];
  const update = (index: number, patch: Partial<LimitRow>) =>
    onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(list.filter((_, i) => i !== index));
  const add = () =>
    onChange([...list, { period: "day", n: 1, tokens: 0, cost: 0, models: "" }]);

  return (
    <div>
      {list.map((row, index) => {
        const needsN = row.period === "days" || row.period === "hours";
        return (
          <div
            key={index}
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 8,
              marginBottom: 8,
              alignItems: "center",
            }}
          >
            <Select
              value={row.period}
              options={PERIODS}
              onChange={(period: LimitPeriod) => update(index, { period })}
            />
            {needsN ? (
              <InputNumber
                min={1}
                max={row.period === "days" ? 3650 : 8760}
                controls={false}
                style={{ width: "100%" }}
                placeholder={row.period === "days" ? "天数" : "小时"}
                value={row.n}
                onChange={(n) => update(index, { n: Number(n ?? 0) })}
              />
            ) : (
              <span />
            )}
            <InputNumber
              min={0}
              controls={false}
              style={{ width: "100%" }}
              placeholder="tokens"
              value={row.tokens || null}
              onChange={(tokens) => update(index, { tokens: Number(tokens ?? 0) })}
            />
            <InputNumber
              min={0}
              step={0.1}
              controls={false}
              style={{ width: "100%" }}
              placeholder="USD"
              value={row.cost || null}
              onChange={(cost) => update(index, { cost: Number(cost ?? 0) })}
            />
            <Input
              placeholder="只算这些模型（可空）"
              value={row.models}
              onChange={(e) => update(index, { models: e.target.value })}
            />
            <Tooltip title="删掉这条">
              <Button
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => remove(index)}
                aria-label="删除这条限额"
              />
            </Tooltip>
          </div>
        );
      })}
      <Button
        type="dashed"
        size="small"
        icon={<PlusOutlined />}
        disabled={list.length >= max}
        onClick={add}
      >
        加一条限额
      </Button>
    </div>
  );
}
