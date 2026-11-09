// 网关用户管理的前端。没有构建步骤，全部用相对地址，
// 这样在 magpie web 的反代路径下也能用。

const TOKEN = window.__MPA_TOKEN__ || "";
const $ = (id) => document.getElementById(id);

const state = {
  view: "keys",
  keys: [],
  period: localStorageSafe("mpa.period") || "today",
  catalog: { models: [], providers: [], quotas: [] },
  templates: [],
  editing: null,
  requests: { offset: 0, rows: [], total: 0 },
};

function localStorageSafe(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 沙箱里没有 localStorage，忽略
  }
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      "x-magpie-admin-token": TOKEN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.field = data?.error?.field;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- 小工具 ----------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer = null;
function toast(text) {
  const node = $("toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

// magpie 的插件页跑在 sandbox="allow-scripts" 的框架里：没有 allow-forms，
// 表单的 submit 事件根本不会触发；没有 allow-modals，confirm() 直接返回 false；
// 没有 allow-downloads，a[download] 静默失败。所以下面这些都自己实现。

function bindDialog(dialogId, primaryId, run) {
  const dlg = $(dialogId);
  const primary = $(primaryId);
  primary.addEventListener("click", run);
  for (const btn of dlg.querySelectorAll("[data-close]")) btn.addEventListener("click", () => dlg.close());
  dlg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (!e.target.matches("input")) return;
    e.preventDefault();
    run();
  });
}

let confirmResolve = null;
function askConfirm(text, { title = "确认", danger = true } = {}) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  $("confirm-yes").className = danger ? "danger" : "primary";
  const dlg = $("dlg-confirm");
  dlg.showModal();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

$("confirm-yes").onclick = () => {
  $("dlg-confirm").close();
  confirmResolve?.(true);
  confirmResolve = null;
};
$("confirm-no").onclick = () => {
  $("dlg-confirm").close();
  confirmResolve?.(false);
  confirmResolve = null;
};
$("dlg-confirm").addEventListener("close", () => {
  confirmResolve?.(false);
  confirmResolve = null;
});

// 沙箱里 clipboard.writeText 和 execCommand("copy") 都被拒；退回到
// “把内容全选，让用户自己按 ⌘C”。
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
    return;
  } catch {}
  const box = $("copy-text");
  box.value = text;
  $("dlg-copy").showModal();
  box.focus();
  box.select();
}

$("copy-select").onclick = () => {
  const box = $("copy-text");
  box.focus();
  box.select();
};
$("copy-close").onclick = () => $("dlg-copy").close();

// 导出：页面下载不了，让宿主的本地服务把文件写到磁盘上，再把路径给用户。
async function saveExport(name, csv) {
  const data = await api("api/export", { method: "POST", body: { name, csv } });
  $("export-path").textContent = data.path;
  $("dlg-export").showModal();
}

$("export-copy").onclick = () => copyText($("export-path").textContent);
$("export-close").onclick = () => $("dlg-export").close();

function fmtNum(n) {
  const v = Number(n || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

function fmtCost(n) {
  const v = Number(n || 0);
  if (!v) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function limitWord(l) {
  if (!l) return "";
  const win = l.period === "days" ? `${l.days}天` : l.period === "hours" ? `${l.hours}小时` : { day: "每天", week: "每周", month: "每月" }[l.period] || l.period;
  const parts = [];
  if (l.tokens) parts.push(`${fmtNum(l.tokens)} tok`);
  if (l.cost) parts.push(fmtCost(l.cost));
  if (l.models?.length) parts.push(l.models.join("|"));
  return `${win} ${parts.join(" + ") || "—"}`;
}

function stateOf(key) {
  if (key.off) return ["off", "已停用"];
  if (key.expires && new Date(key.expires).getTime() <= Date.now()) return ["off", "已过期"];
  if (key.expires) return ["warn", `至 ${fmtDate(key.expires)}`];
  return ["on", "启用"];
}

// ---------- 限额编辑器 ----------

const PERIOD_OPTIONS = [
  ["day", "每天"],
  ["week", "每周"],
  ["month", "每月"],
  ["days", "N 天"],
  ["hours", "N 小时"],
];

function makeLimitEditor(container, initial = []) {
  container.replaceChildren();
  const rows = [];

  function addRow(limit = {}) {
    const period = el("select", {}, PERIOD_OPTIONS.map(([v, t]) => el("option", { value: v, text: t })));
    period.value = limit.period || "day";
    const n = el("input", { type: "number", min: "1", placeholder: "周期数", value: limit.period === "days" ? limit.days || "" : limit.period === "hours" ? limit.hours || "" : "" });
    const tokens = el("input", { type: "number", min: "0", placeholder: "tokens", value: limit.tokens || "" });
    const cost = el("input", { type: "number", min: "0", step: "0.01", placeholder: "USD", value: limit.cost || "" });
    const models = el("input", { placeholder: "模型（可空）", value: (limit.models || []).join(",") });
    const remove = el("button", { type: "button", class: "link", text: "删除", onclick: () => row.remove() });

    const row = el("div", { class: "limit-row" }, [period, n, tokens, cost, models, remove]);
    row.dataset.period = limit.period || "day";
    const sync = () => {
      const p = period.value;
      n.hidden = p !== "days" && p !== "hours";
      n.placeholder = p === "days" ? "天数" : "小时数";
    };
    period.addEventListener("change", sync);
    sync();
    rows.push(row);
    container.append(row);
    return row;
  }

  for (const l of initial) addRow(l);

  return {
    add: () => addRow({}),
    read() {
      const out = [];
      for (const row of rows) {
        if (!row.isConnected) continue;
        const [periodEl, nEl, tokensEl, costEl, modelsEl] = row.querySelectorAll("select, input");
        const period = periodEl.value;
        const item = {
          period,
          tokens: Number(tokensEl.value || 0),
          cost: Number(costEl.value || 0),
        };
        if (period === "days") item.days = Number(nEl.value || 0);
        if (period === "hours") item.hours = Number(nEl.value || 0);
        const models = modelsEl.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        if (models.length) item.models = models;
        if (item.tokens || item.cost) out.push(item);
      }
      return out;
    },
    set(limits) {
      container.replaceChildren();
      rows.length = 0;
      for (const l of limits || []) addRow(l);
    },
  };
}

const keyLimits = makeLimitEditor($("limit-rows"));
const batchLimits = makeLimitEditor($("b-limit-rows"));
const detailLimits = makeLimitEditor($("d-limit-rows"));
const tplLimits = makeLimitEditor($("t-limit-rows"));

$("limit-add").onclick = () => keyLimits.add();
$("b-limit-add").onclick = () => batchLimits.add();
$("d-limit-add").onclick = () => detailLimits.add();
$("t-limit-add").onclick = () => tplLimits.add();

// ---------- 状态条 ----------

async function loadHealth() {
  try {
    const h = await api("api/health");
    const bits = [];
    bits.push(el("span", { class: `chip ${h.gateway?.ok ? "ok" : "bad"}`, text: h.gateway?.ok ? `网关正常 · ${h.gateway.models} 个模型` : "网关连不上" }));
    bits.push(el("span", { class: `chip ${h.cli?.ok ? "ok" : "bad"}`, text: h.cli?.ok ? "magpie CLI 可用" : "找不到 magpie 命令" }));
    bits.push(el("span", { class: "chip", title: h.keysFile, text: h.writable ? "密钥文件可写" : "密钥文件只读" }));
    $("status").replaceChildren(...bits);
    if (!h.cli?.ok) {
      showWarn("找不到 magpie 命令：新建/轮换/删除 key 需要它。把 magpie 放进 PATH，或用 MAGPIE_BIN 指定。");
    }
  } catch (err) {
    $("status").replaceChildren(el("span", { class: "chip bad", text: "本地服务异常" }));
    showWarn(err.message);
  }
}

function showWarn(text) {
  const node = $("keys-warning");
  node.textContent = text;
  node.hidden = !text;
}

// ---------- key 列表 ----------

async function loadKeys() {
  const period = state.period === "off" ? "off" : state.period;
  const data = await api(`api/keys?usage=${encodeURIComponent(period)}`);
  state.keys = data.keys || [];
  showWarn(data.warning || "");
  renderKeys();
}

function renderKeys() {
  const body = $("keys-body");
  body.replaceChildren();
  $("keys-empty").hidden = state.keys.length > 0;
  const showUsage = state.period !== "off";

  for (const key of state.keys) {
    const [cls, label] = stateOf(key);
    const limits = key.limits || [];
    const usage = key.usage;
    const tr = el("tr", {}, [
      el("td", {}, [
        el("div", { class: "name", text: key.name || "(未命名)" }),
        key.default ? el("div", { class: "sub", text: "默认共享 key" }) : key.issuer ? el("div", { class: "sub", text: `由 ${key.issuer} 签发` }) : null,
      ]),
      el("td", {}, [el("code", { text: key.masked || "…" })]),
      el("td", {}, [
        el("span", { class: `pill ${cls}`, text: label }),
        key.readOnly ? el("span", { class: "pill", text: "只读" }) : null,
        key.maxConcurrency ? el("span", { class: "pill", text: `并发 ${key.maxConcurrency}` }) : null,
      ]),
      el("td", { class: "sub" }, limits.length ? limits.map((l) => el("div", { text: limitWord(l) })) : [el("span", { class: "muted", text: "不限" })]),
      el("td", { class: "sub" }, [
        key.models?.length ? key.models.slice(0, 3).join(", ") + (key.models.length > 3 ? ` +${key.models.length - 3}` : "") : "全部",
      ]),
      showUsage ? el("td", { class: "num", text: usage ? fmtNum(usage.calls) : "—" }) : el("td"),
      showUsage ? el("td", { class: "num", text: usage ? fmtCost(usage.cost) : "—" }) : el("td"),
      el("td", { class: "right" }, [
        el("button", { class: "link", text: "编辑", onclick: () => openDetail(key) }),
        el("button", { class: "link", text: key.off ? "启用" : "停用", onclick: () => toggleOff(key) }),
      ]),
    ]);
    body.append(tr);
  }
}

async function toggleOff(key) {
  try {
    await api(`api/keys/${key.id}`, { method: "PATCH", body: { off: !key.off } });
    await loadKeys();
    toast(key.off ? "已启用" : "已停用");
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 新建 ----------

function fillTemplateSelects() {
  for (const id of ["f-template", "b-template"]) {
    const sel = $(id);
    const current = sel.value;
    sel.replaceChildren(el("option", { value: "", text: "不用模板" }));
    for (const t of state.templates) sel.append(el("option", { value: t.id, text: t.name }));
    sel.value = current;
  }
}

function applyTemplateToNew(template) {
  if (!template) return;
  $("f-models").value = (template.models || []).join(", ");
  $("f-concurrency").value = template.maxConcurrency || "";
  $("f-readonly").checked = !!template.readOnly;
  $("f-quotas").checked = !!template.quotas;
  keyLimits.set(template.limits || []);
}

function applyTemplateToBatch(template) {
  if (!template) return;
  $("b-models").value = (template.models || []).join(", ");
  $("b-concurrency").value = template.maxConcurrency || "";
  $("b-days").value = template.expiresInDays || "";
  $("b-readonly").checked = !!template.readOnly;
  batchLimits.set(template.limits || []);
}

function templateById(id) {
  return state.templates.find((t) => t.id === id)?.template || null;
}

$("f-template").addEventListener("change", (e) => applyTemplateToNew(templateById(e.target.value)));
$("b-template").addEventListener("change", (e) => applyTemplateToBatch(templateById(e.target.value)));

$("btn-new").onclick = () => {
  $("dlg-key-title").textContent = "新建 key";
  $("f-name").value = "";
  $("f-expires").value = "";
  $("f-concurrency").value = "";
  $("f-models").value = "";
  $("f-readonly").checked = false;
  $("f-quotas").checked = false;
  $("f-off").checked = false;
  $("f-template").value = "";
  keyLimits.set([]);
  $("dlg-key-err").hidden = true;
  renderModelChips($("model-chips"), $("f-models"));
  $("dlg-key").showModal();
};

bindDialog("dlg-key", "dlg-key-ok", async () => {
  const err = $("dlg-key-err");
  err.hidden = true;
  try {
    const data = await api("api/keys", {
      method: "POST",
      body: {
        name: $("f-name").value,
        expires: $("f-expires").value ? `${$("f-expires").value}T23:59:59` : null,
        models: $("f-models").value,
        limits: keyLimits.read(),
        maxConcurrency: Number($("f-concurrency").value || 0),
        readOnly: $("f-readonly").checked,
        quotas: $("f-quotas").checked,
        off: $("f-off").checked,
      },
    });
    $("dlg-key").close();
    await loadKeys();
    showIssued(data.keys || []);
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

// ---------- 批量 ----------

$("btn-batch").onclick = () => {
  $("b-count").value = 5;
  $("b-prefix").value = "";
  $("b-start").value = 1;
  $("b-models").value = "";
  $("b-concurrency").value = "";
  $("b-days").value = "";
  $("b-readonly").checked = false;
  $("b-off").checked = false;
  $("b-template").value = "";
  batchLimits.set([]);
  $("dlg-batch-err").hidden = true;
  $("dlg-batch").showModal();
};

bindDialog("dlg-batch", "dlg-batch-ok", async () => {
  const err = $("dlg-batch-err");
  err.hidden = true;
  const ok = $("dlg-batch-ok");
  ok.disabled = true;
  ok.textContent = "生成中…";
  try {
    const data = await api("api/keys/batch", {
      method: "POST",
      body: {
        count: Number($("b-count").value || 1),
        namePrefix: $("b-prefix").value,
        startAt: Number($("b-start").value || 1),
        off: $("b-off").checked,
        template: {
          models: $("b-models").value,
          limits: batchLimits.read(),
          maxConcurrency: Number($("b-concurrency").value || 0),
          expiresInDays: $("b-days").value ? Number($("b-days").value) : undefined,
          readOnly: $("b-readonly").checked,
        },
      },
    });
    $("dlg-batch").close();
    await loadKeys();
    showIssued(data.keys || []);
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    ok.disabled = false;
    ok.textContent = "开始生成";
  }
});

// ---------- 一次性展示新密钥 ----------

function showIssued(keys) {
  if (!keys.length) return;
  state.issued = keys;
  const body = $("issued-body");
  body.replaceChildren();
  for (const k of keys) {
    body.append(
      el("tr", {}, [
        el("td", { text: k.name }),
        el("td", { class: "secret", text: k.secret }),
        el("td", { class: "right" }, [el("button", { class: "link", text: "复制", onclick: () => copyText(k.secret) })]),
      ]),
    );
  }
  $("dlg-issued").showModal();
}

$("issued-copy").onclick = () => copyText((state.issued || []).map((k) => `${k.name},${k.secret}`).join("\n"));
$("issued-download").onclick = () => {
  const csv = "name,secret\n" + (state.issued || []).map((k) => `${k.name},${k.secret}`).join("\n") + "\n";
  saveExport(`magpie-keys-${new Date().toISOString().slice(0, 10)}.csv`, csv).catch((err) => toast(err.message));
};
$("issued-close").onclick = () => {
  state.issued = [];
  $("dlg-issued").close();
};

// ---------- 详情 ----------

function openDetail(key) {
  state.editing = key;
  $("detail-title").textContent = key.name || "(未命名)";
  $("detail-sub").textContent = `${key.masked} · id ${key.id}${key.default ? " · 默认共享 key" : ""}`;
  $("d-name").value = key.name || "";
  $("d-name").disabled = !!key.default;
  $("d-expires").value = dateInputValue(key.expires);
  $("d-concurrency").value = key.maxConcurrency || "";
  $("d-off").value = key.off ? "1" : "0";
  $("d-off").disabled = !!key.default;
  $("d-models").value = (key.models || []).join(", ");
  $("d-accounts").value = (key.accounts || []).join(", ");
  $("d-mcp").value = (key.mcp || []).join(", ");
  $("d-readonly").checked = !!key.readOnly;
  $("d-readonly").disabled = !!key.default;
  $("d-quotas").checked = !!key.quotas;
  $("d-issues").checked = !!key.issues;
  $("detail-err").hidden = true;
  detailLimits.set(key.limits || []);
  renderModelChips($("d-model-chips"), $("d-models"));
  $("dlg-detail").showModal();
}

bindDialog("dlg-detail", "d-save", async () => {
  const key = state.editing;
  if (!key) return;
  const err = $("detail-err");
  err.hidden = true;
  try {
    const body = {
      limits: detailLimits.read(),
      models: $("d-models").value,
      accounts: $("d-accounts").value,
      mcp: $("d-mcp").value,
      maxConcurrency: Number($("d-concurrency").value || 0),
      quotas: $("d-quotas").checked,
      issues: $("d-issues").checked,
      expires: $("d-expires").value ? `${$("d-expires").value}T23:59:59` : null,
    };
    if (!key.default) {
      body.name = $("d-name").value;
      body.off = $("d-off").value === "1";
      body.readOnly = $("d-readonly").checked;
    }
    await api(`api/keys/${key.id}`, { method: "PATCH", body });
    $("dlg-detail").close();
    await loadKeys();
    toast("已保存");
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

$("d-copy").onclick = async () => {
  try {
    const data = await api(`api/keys/${state.editing.id}/secret`);
    await copyText(data.secret);
  } catch (err) {
    toast(err.message);
  }
};

$("d-rotate").onclick = async () => {
  if (!(await askConfirm("轮换后旧密钥立即失效。继续？", { title: "轮换密钥" }))) return;
  try {
    const data = await api(`api/keys/${state.editing.id}/rotate`, { method: "POST" });
    $("dlg-detail").close();
    await loadKeys();
    showIssued([{ name: state.editing.name, secret: data.secret }]);
  } catch (err) {
    toast(err.message);
  }
};

$("d-delete").onclick = async () => {
  const key = state.editing;
  if (!(await askConfirm(`删除“${key.name}”？这个 key 会立刻失效。`, { title: "删除 key" }))) return;
  try {
    await api(`api/keys/${key.id}`, { method: "DELETE" });
    $("dlg-detail").close();
    await loadKeys();
    toast("已删除");
  } catch (err) {
    toast(err.message);
  }
};

// ---------- 模型快捷选择 ----------

function renderModelChips(container, target) {
  container.replaceChildren();
  const providers = state.catalog.providers || [];
  for (const p of providers.slice(0, 14)) {
    container.append(
      el("button", {
        type: "button",
        text: `${p}/*`,
        onclick: () => {
          const cur = target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
          const value = `${p}/*`;
          if (!cur.includes(value)) cur.push(value);
          target.value = cur.join(", ");
        },
      }),
    );
  }
  const groups = (state.catalog.models || []).filter((m) => m.group).slice(0, 8);
  for (const m of groups) {
    container.append(el("button", { type: "button", text: m.id, onclick: () => toast("路由组（auto/*）不能用于 key 的模型限制") }));
  }
}

// ---------- 用量 ----------

async function loadUsage() {
  const period = $("usage-period").value;
  const data = await api(`api/usage?period=${period}`);
  const s = data.summary || {};
  const cards = [
    ["调用", fmtNum(s.calls)],
    ["错误", fmtNum(s.errors)],
    ["花费", fmtCost(s.cost)],
    ["输入", fmtNum(s.input)],
    ["输出", fmtNum(s.output)],
    ["缓存读", fmtNum(s.cache_read)],
  ];
  $("usage-cards").replaceChildren(
    ...cards.map(([label, value]) => el("div", { class: "card" }, [el("b", { text: value }), el("span", { text: label })])),
  );

  const groups = data.groups || [];
  const body = $("usage-body");
  body.replaceChildren();
  $("usage-empty").hidden = groups.length > 0;
  const names = new Map(state.keys.map((k) => [k.id, k.name]));
  for (const g of groups) {
    const id = g.callerKeyId || g.id;
    body.append(
      el("tr", {}, [
        el("td", {}, [el("div", { class: "name", text: names.get(id) || g.callerKeyName || id }), el("div", { class: "sub mono", text: id })]),
        el("td", { class: "num", text: fmtNum(g.calls) }),
        el("td", { class: "num", text: fmtNum(g.errors) }),
        el("td", { class: "num", text: fmtNum(g.input) }),
        el("td", { class: "num", text: fmtNum(g.output) }),
        el("td", { class: "num", text: fmtNum(g.cache_read) }),
        el("td", { class: "num", text: fmtCost(g.cost) }),
      ]),
    );
  }
  await loadRequests(true);
}

async function loadRequests(reset = false) {
  if (reset) {
    state.requests = { offset: 0, rows: [], total: 0 };
  }
  const period = $("usage-period").value;
  const filter = $("req-filter").value;
  const params = new URLSearchParams({
    period,
    offset: String(state.requests.offset),
    limit: "50",
  });
  if (filter === "failed") params.set("failed", "1");
  if (filter === "retried") params.set("retried", "1");
  const q = $("req-q").value.trim();
  if (q) params.set("q", q);

  const data = await api(`api/usage/requests?${params}`);
  state.requests.rows = reset ? data.rows || [] : [...state.requests.rows, ...(data.rows || [])];
  state.requests.total = data.total || 0;
  state.requests.offset = state.requests.rows.length;

  const body = $("req-body");
  body.replaceChildren();
  for (const r of state.requests.rows) {
    const failed = r.status >= 400;
    body.append(
      el("tr", {}, [
        el("td", { class: "sub", text: fmtDate(r.t) }),
        el("td", { class: "sub", text: r.callerKeyName || r.callerKeyId || "—" }),
        el("td", {}, [el("div", { text: r.req || r.model || "" }), el("div", { class: "sub", text: r.providerName || r.provider || "" })]),
        el("td", {}, [el("span", { class: `pill ${failed ? "off" : "on"}`, text: String(r.status || "") })]),
        el("td", { class: "num", text: r.ms ? `${Math.round(r.ms / 100) / 10}s` : "" }),
        el("td", { class: "num", text: fmtNum(r.in) }),
        el("td", { class: "num", text: fmtNum(r.out) }),
        el("td", { class: "num", text: fmtCost(r.cost) }),
      ]),
    );
  }
  $("req-total").textContent = `已显示 ${state.requests.rows.length} / ${state.requests.total}`;
  $("req-more").disabled = state.requests.rows.length >= state.requests.total;
}

$("req-more").onclick = () => loadRequests(false);
$("req-refresh").onclick = () => loadRequests(true);
$("req-filter").onchange = () => loadRequests(true);
$("usage-refresh").onclick = () => loadUsage();
$("usage-period").onchange = () => loadUsage();

// ---------- 模板 ----------

async function loadTemplates() {
  const data = await api("api/templates");
  state.templates = data.templates || [];
  fillTemplateSelects();
  renderTemplates();
}

function renderTemplates() {
  const body = $("tpl-body");
  body.replaceChildren();
  $("tpl-empty").hidden = state.templates.length > 0;
  for (const t of state.templates) {
    const tpl = t.template || {};
    body.append(
      el("tr", {}, [
        el("td", { class: "name", text: t.name }),
        el("td", { class: "sub", text: (tpl.models || []).join(", ") || "全部" }),
        el("td", { class: "sub" }, (tpl.limits || []).length ? (tpl.limits || []).map((l) => el("div", { text: limitWord(l) })) : [el("span", { class: "muted", text: "不限" })]),
        el("td", { class: "num", text: tpl.maxConcurrency || "—" }),
        el("td", { class: "num", text: tpl.expiresInDays ? `${tpl.expiresInDays} 天` : "—" }),
        el("td", { class: "right" }, [
          el("button", { class: "link", text: "编辑", onclick: () => openTemplate(t) }),
          el("button", { class: "link", text: "删除", onclick: () => removeTemplate(t) }),
        ]),
      ]),
    );
  }
}

function openTemplate(t) {
  state.tplEditing = t || null;
  $("tpl-title").textContent = t ? "编辑模板" : "新建模板";
  $("t-name").value = t?.name || "";
  $("t-name").disabled = !!t;
  $("t-models").value = (t?.template?.models || []).join(", ");
  $("t-concurrency").value = t?.template?.maxConcurrency || "";
  $("t-days").value = t?.template?.expiresInDays || "";
  $("t-readonly").checked = !!t?.template?.readOnly;
  $("t-quotas").checked = !!t?.template?.quotas;
  tplLimits.set(t?.template?.limits || []);
  $("tpl-err").hidden = true;
  $("dlg-template").showModal();
}

$("tpl-new").onclick = () => openTemplate(null);

bindDialog("dlg-template", "t-save", async () => {
  const err = $("tpl-err");
  err.hidden = true;
  try {
    await api("api/templates", {
      method: "POST",
      body: {
        name: $("t-name").value,
        template: {
          models: $("t-models").value,
          limits: tplLimits.read(),
          maxConcurrency: Number($("t-concurrency").value || 0),
          expiresInDays: $("t-days").value ? Number($("t-days").value) : undefined,
          readOnly: $("t-readonly").checked,
          quotas: $("t-quotas").checked,
        },
      },
    });
    $("dlg-template").close();
    await loadTemplates();
    toast("模板已保存");
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  }
});

async function removeTemplate(t) {
  if (!(await askConfirm(`删除模板“${t.name}”？`, { title: "删除模板" }))) return;
  try {
    await api(`api/templates/${t.id}`, { method: "DELETE" });
    await loadTemplates();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 视图切换 ----------

$("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  switchView(btn.dataset.view);
});

function switchView(view) {
  state.view = view;
  for (const btn of $("tabs").querySelectorAll("button")) btn.classList.toggle("on", btn.dataset.view === view);
  for (const name of ["keys", "usage", "templates"]) $(`view-${name}`).hidden = name !== view;
  if (view === "usage") loadUsage().catch((err) => toast(err.message));
  if (view === "templates") loadTemplates().catch((err) => toast(err.message));
}

// ---------- 启动 ----------

async function boot() {
  $("period").value = state.period;
  try {
    state.catalog = await api("api/catalog");
  } catch {
    state.catalog = { models: [], providers: [], quotas: [] };
  }
  await loadTemplates().catch(() => {});
  await loadKeys().catch((err) => showWarn(err.message));
  await loadHealth();
}

$("period").addEventListener("change", (e) => {
  state.period = e.target.value;
  saveLocal("mpa.period", state.period);
  loadKeys().catch((err) => toast(err.message));
});
$("btn-refresh").onclick = () => loadKeys().catch((err) => toast(err.message));
$("btn-export").onclick = async () => {
  const period = state.period === "off" ? "today" : state.period;
  try {
    const res = await fetch(`api/export?period=${period}`, { headers: { "x-magpie-admin-token": TOKEN } });
    if (!res.ok) throw new Error(`导出失败：HTTP ${res.status}`);
    const text = await res.text();
    await saveExport(`magpie-keys-${period}-${new Date().toISOString().slice(0, 10)}.csv`, text);
  } catch (err) {
    toast(err.message);
  }
};

boot();
