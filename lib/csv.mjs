// 导出用 CSV：按 key 一行，够 Excel / Numbers 直接打开。

function cell(value) {
  let text = value == null ? "" : String(value);
  // Excel / Numbers 会把 =、+、-、@ 开头的单元格当公式；名称来自用户输入，
  // 加一个前导单引号让它保持文本。
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function keysCSV(rows, { period = "" } = {}) {
  const head = [
    "id",
    "name",
    "state",
    "masked",
    "access",
    "models",
    "accounts",
    "limits",
    "expires",
    period ? `calls_${period}` : "calls",
    period ? `cost_${period}` : "cost",
    period ? `tokens_${period}` : "tokens",
    // 网关不知道价格的调用按 $0 计，不单列出来会让美元一列看起来比实际低。
    period ? `unpriced_${period}` : "unpriced",
    period ? `cache_read_${period}` : "cache_read",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.state || (r.off ? "disabled" : "enabled"),
        r.masked,
        r.readOnly ? "read-only" : "full",
        (r.models || []).join(" "),
        (r.accounts || []).join(" "),
        (r.limits || []).map(limitWord).join("; "),
        r.expires || "",
        r.usage?.calls ?? 0,
        r.usage?.cost != null ? Number(r.usage.cost).toFixed(4) : "",
        (r.usage?.input ?? 0) + (r.usage?.output ?? 0),
        r.usage?.unpriced ?? 0,
        r.usage?.cache_read ?? 0,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function limitWord(l) {
  if (!l) return "";
  const window =
    l.period === "days" ? `${l.days}d` : l.period === "hours" ? `${l.hours}h` : l.period;
  const parts = [];
  if (l.tokens) parts.push(`${l.tokens} tokens`);
  if (l.cost) parts.push(`$${l.cost}`);
  return `${window}:${parts.join("+") || "-"}`;
}

export function issuedCSV(created) {
  const lines = ["name,secret"];
  for (const k of created) lines.push([k.name, k.secret].map(cell).join(","));
  return lines.join("\n") + "\n";
}
