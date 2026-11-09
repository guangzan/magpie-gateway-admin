import { Input, Tag, Typography } from "antd";

import type { CatalogModel } from "../types";

interface Props {
  value: string;
  onChange(value: string): void;
  providers: string[];
  groups: CatalogModel[];
  onGroup(id: string): void;
}

export default function ModelField({ value, onChange, providers, groups, onGroup }: Props) {
  const add = (model: string) => {
    const current = String(value || "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(model)) return;
    onChange([...current, model].join(", "));
  };

  return (
    <div>
      <Input.TextArea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="openai/gpt-5, anthropic/* —— 留空表示全部"
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {providers.slice(0, 12).map((p) => (
          <Tag key={p} style={{ margin: 0, cursor: "pointer" }} onClick={() => add(`${p}/*`)}>
            {p}/*
          </Tag>
        ))}
        {groups.slice(0, 6).map((g) => (
          <Tag
            key={g.id}
            style={{ margin: 0, cursor: "help", opacity: 0.7 }}
            onClick={() => onGroup(g.id)}
          >
            <Typography.Text delete type="secondary" style={{ fontSize: 12 }}>
              {g.id}
            </Typography.Text>
          </Tag>
        ))}
      </div>
    </div>
  );
}
