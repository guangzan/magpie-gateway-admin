import React from "react";
import {
  App as AntApp,
  Alert,
  Button,
  Layout,
  Popover,
  Result,
  Space,
  Tabs,
  Tag,
  Typography,
  theme,
} from "antd";

import { hasToken } from "./api";
import KeysView from "./views/KeysView";
import TemplatesView from "./views/TemplatesView";
import UsageView from "./views/UsageView";
import {
  BatchModal,
  ConfirmModal,
  CopyModal,
  DetailModal,
  ExportModal,
  IssuedModal,
  KeyModal,
  TemplateModal,
} from "./modals";
import { useShell } from "./store";
import type { TabKey } from "./store";
import type { Health } from "./types";

const { Header, Content } = Layout;
const { Text } = Typography;

// 健康状态标签点开后的解释：出了问题要能看到路径、原因和下一步，
// 而不是只有一个红点。
function HealthPanel({ health, onRecheck }: { health: Health; onRecheck(): void }) {
  return (
    <div style={{ maxWidth: 400, fontSize: 12, lineHeight: 1.9 }}>
      <div>
        配置目录：<Text code>{health.configDir || "—"}</Text>
      </div>
      {health.configOverride ? (
        <Alert
          type="warning"
          showIcon
          message={`${health.configOverride} 只影响插件`}
          description="magpie 不读这个变量。除非 magpie 也指向同一目录，否则插件可能读写另一份 caller-keys.json。"
          style={{ margin: "6px 0" }}
        />
      ) : null}
      <div>
        密钥文件：<Text code>{health.keysFile || "—"}</Text>
        {health.keysReadable === false ? "（读不出来）" : ""}
      </div>
      {health.keysError ? (
        <Alert type="error" showIcon message={health.keysError} style={{ margin: "6px 0" }} />
      ) : null}
      <div>
        备份目录：<Text code>{health.backupsDir || "—"}</Text>
      </div>
      <div>
        magpie：<Text code>{health.cli?.path || "找不到"}</Text>
      </div>
      <div>
        网关：
        {health.gateway?.ok
          ? `正常，${health.gateway.models ?? 0} 个模型`
          : health.gateway?.error || "连不上"}
      </div>
      {health.writable === false ? (
        <Alert
          type="warning"
          showIcon
          message="密钥文件所在目录不可写，只能查看。"
          style={{ margin: "6px 0" }}
        />
      ) : null}
      <div style={{ marginTop: 8 }}>
        <Button size="small" onClick={onRecheck}>
          重新检查
        </Button>
        <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
          版本 {health.version || "—"}
        </Text>
      </div>
    </div>
  );
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "keys", label: "用户与密钥" },
  { key: "usage", label: "用量" },
  { key: "templates", label: "模板" },
];

export default function Shell() {
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();

  const tab = useShell((s) => s.tab);
  const setTab = useShell((s) => s.setTab);
  const period = useShell((s) => s.period);
  const setPeriod = useShell((s) => s.setPeriod);
  const keys = useShell((s) => s.keys);
  const templates = useShell((s) => s.templates);
  const catalog = useShell((s) => s.catalog);
  const health = useShell((s) => s.health);
  const warning = useShell((s) => s.warning);
  const keysError = useShell((s) => s.keysError);
  const keysUsageOk = useShell((s) => s.keysUsageOk);
  const updatedAt = useShell((s) => s.updatedAt);
  const fatal = useShell((s) => s.fatal);
  const loading = useShell((s) => s.loading);
  const tplLoading = useShell((s) => s.tplLoading);

  const keyOpen = useShell((s) => s.keyOpen);
  const batchOpen = useShell((s) => s.batchOpen);
  const batchTemplateId = useShell((s) => s.batchTemplateId);
  const issued = useShell((s) => s.issued);
  const detail = useShell((s) => s.detail);
  const tplDialog = useShell((s) => s.tplDialog);
  const confirm = useShell((s) => s.confirm);
  const copyText = useShell((s) => s.copyText);
  const exportPath = useShell((s) => s.exportPath);

  const setNotifier = useShell((s) => s.setNotifier);

  React.useEffect(() => {
    setNotifier({
      success: (text) => message.success(text),
      error: (text) => message.error(text),
      info: (text) => message.info(text),
    });
  }, [message, setNotifier]);

  React.useEffect(() => {
    if (!hasToken()) return;
    void useShell.getState().boot();
  }, []);

  const groups = React.useMemo(
    () => (catalog.models || []).filter((m) => m.group).slice(0, 8),
    [catalog],
  );

  const recheck = () => void useShell.getState().refreshHealth();

  if (!hasToken()) {
    return (
      <Result
        status="warning"
        title="没有拿到访问令牌"
        subTitle="请从 magpie 的插件页面打开这个界面。直接打开 127.0.0.1 上的地址不会带上本次启动的令牌。"
        extra={
          <Button type="primary" onClick={() => location.reload()}>
            重新加载
          </Button>
        }
      />
    );
  }

  if (fatal) {
    return (
      <Result
        status="error"
        title="管理界面连接已断开"
        subTitle={fatal}
        extra={
          <Button type="primary" onClick={() => location.reload()}>
            重新连接
          </Button>
        }
      />
    );
  }

  const panel = health ? (
    <HealthPanel health={health} onRecheck={recheck} />
  ) : (
    <div style={{ maxWidth: 340, fontSize: 12, lineHeight: 1.8 }}>
      连不上本地管理服务。它可能刚重启过。
      <div style={{ marginTop: 8 }}>
        <Button size="small" onClick={recheck}>
          重新检查
        </Button>
      </div>
    </div>
  );

  const statusTags = [
    <Popover key="gw" title="本地服务状态" content={panel} trigger="click">
      <Tag
        color={health ? (health.gateway?.ok ? "green" : "red") : "orange"}
        style={{ margin: 0, cursor: "pointer" }}
      >
        {health
          ? health.gateway?.ok
            ? `网关正常 · ${health.gateway.models} 个模型`
            : "网关连不上"
          : "状态未知"}
      </Tag>
    </Popover>,
    <Popover key="cli" title="本地服务状态" content={panel} trigger="click">
      <Tag
        color={health ? (health.cli?.ok ? "green" : "red") : "orange"}
        style={{ margin: 0, cursor: "pointer" }}
      >
        {health ? (health.cli?.ok ? "magpie CLI 可用" : "找不到 magpie 命令") : "CLI 状态未知"}
      </Tag>
    </Popover>,
    <Popover key="file" title="本地服务状态" content={panel} trigger="click">
      <Tag
        color={health ? (health.writable ? "default" : "orange") : "orange"}
        style={{ margin: 0, cursor: "pointer" }}
      >
        {health ? (health.writable ? "密钥文件可写" : "密钥文件只读") : "文件状态未知"}
      </Tag>
    </Popover>,
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          height: "auto",
          lineHeight: "normal",
          padding: "8px 20px 0",
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as TabKey)}
          items={TABS}
          style={{ flex: 1, minWidth: 260 }}
          tabBarStyle={{ marginBottom: 0 }}
        />
        <Space size={6} wrap style={{ paddingBottom: 6 }}>
          {statusTags}
        </Space>
      </Header>

      <Content style={{ padding: 16, maxWidth: 1600, width: "100%", margin: "0 auto" }}>
        {tab === "keys" ? (
          <KeysView
            keys={keys}
            period={period}
            loading={loading}
            warning={warning}
            error={keysError}
            usageOk={keysUsageOk}
            updatedAt={updatedAt}
            onPeriod={setPeriod}
            onNew={() => useShell.getState().openKey()}
            onBatch={() => useShell.getState().openBatch()}
            onExport={() => void useShell.getState().exportKeys()}
            onRefresh={() => void useShell.getState().refreshKeys()}
            onCopy={(key) => void useShell.getState().copySecretById(key.id)}
            onEdit={(key) => useShell.getState().openDetail(key)}
            onToggle={(key) => void useShell.getState().toggleKey(key)}
            onUsage={(key) => {
              useShell.getState().setTab("usage");
              if (period !== "off") useShell.getState().setUsagePeriod(period);
              useShell.getState().setUsageCallerKey(key.id);
            }}
            onBulk={(action, ids) => useShell.getState().bulkAction(action, ids)}
          />
        ) : null}
        {tab === "usage" ? <UsageView /> : null}
        {tab === "templates" ? (
          <TemplatesView
            templates={templates}
            loading={tplLoading}
            onNew={() => useShell.getState().openTemplate(null)}
            onEdit={(item) => useShell.getState().openTemplate(item)}
            onDelete={(item) => void useShell.getState().deleteTemplate(item)}
            onUse={(item) => useShell.getState().openBatch(item.id)}
          />
        ) : null}
      </Content>

      <KeyModal
        open={keyOpen}
        onClose={() => useShell.getState().closeKey()}
        onSubmit={useShell.getState().createKey}
        templates={templates}
        providers={catalog.providers || []}
        groups={groups}
      />
      <BatchModal
        open={batchOpen}
        initialTemplateId={batchTemplateId}
        onClose={() => useShell.getState().closeBatch()}
        onSubmit={useShell.getState().batchKeys}
        templates={templates}
        providers={catalog.providers || []}
        groups={groups}
      />
      <IssuedModal
        open={!!issued}
        keys={issued || []}
        onClose={() => useShell.getState().closeIssued()}
        onCopy={(text) => void useShell.getState().copy(text)}
        onExport={() => void useShell.getState().exportIssued()}
      />
      <DetailModal
        open={!!detail}
        record={detail}
        onClose={() => useShell.getState().closeDetail()}
        onSave={useShell.getState().saveDetail}
        onRotate={() => void useShell.getState().rotateKey()}
        onResetLimits={() => void useShell.getState().resetLimits()}
        onDelete={() => void useShell.getState().deleteKey()}
        onCopySecret={() => void useShell.getState().copySecret()}
        providers={catalog.providers || []}
        groups={groups}
      />
      <TemplateModal
        open={!!tplDialog}
        template={tplDialog?.template || null}
        onClose={() => useShell.getState().closeTemplate()}
        onSubmit={useShell.getState().saveTemplate}
        providers={catalog.providers || []}
        groups={groups}
      />
      <ConfirmModal state={confirm} onDone={(ok) => useShell.getState().finishConfirm(ok)} />
      <CopyModal
        open={!!copyText}
        text={copyText || ""}
        onClose={() => useShell.getState().closeCopy()}
      />
      <ExportModal
        open={!!exportPath}
        path={exportPath || ""}
        onClose={() => useShell.getState().closeExport()}
        onCopy={(text) => void useShell.getState().copy(text)}
      />
    </Layout>
  );
}
