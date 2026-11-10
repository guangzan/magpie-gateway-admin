import { Input, Tag } from "antd";

import type { CatalogModel } from "../types";

interface Props {
  value: string;
  onChange(value: string): void;
  providers: string[];
  groups: CatalogModel[];
}

export default function ModelField({ value, onChange, providers, groups }: Props) {
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
        {/* magpie 的 key 模型白名单接受 group/<id> 和 group/*，auto/* 也能用；
            点一下直接加进白名单，别再把人劝退去手写。 */}
        {groups.slice(0, 8).map((g) => (
          <Tag
            key={g.id}
            style={{ margin: 0, cursor: "pointer", color: "inherit" }}
            onClick={() => add(g.id)}
          >
            {g.id}
          </Tag>
        ))}
      </div>
    </div>
  );
}
