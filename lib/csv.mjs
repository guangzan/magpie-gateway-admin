// 导出用 CSV：按 key 一行，够 Excel / Numbers 直接打开。

function cell(value) {
  const text = value == null ? "" : String(value);
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
    "concurrency",
    "expires",
    period ? `calls_${period}` : "calls",
    period ? `cost_${period}` : "cost",
    period ? `tokens_${period}` : "tokens",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.off ? "disabled" : "enabled",
        r.masked,
        r.readOnly ? "read-only" : "full",
        (r.models || []).join(" "),
        (r.accounts || []).join(" "),
        (r.limits || []).map(limitWord).join("; "),
        r.maxConcurrency || 0,
        r.expires || "",
        r.usage?.calls ?? 0,
        r.usage?.cost != null ? Number(r.usage.cost).toFixed(4) : "",
        (r.usage?.input ?? 0) + (r.usage?.output ?? 0),
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
  if (l.models?.length) parts.push(l.models.join("|"));
  return `${window}:${parts.join("+") || "-"}`;
}

export function issuedCSV(created) {
  const lines = ["name,secret"];
  for (const k of created) lines.push([k.name, k.secret].map(cell).join(","));
  return lines.join("\n") + "\n";
}
