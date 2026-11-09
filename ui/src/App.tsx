import React from "react";
import { App as AntApp, Layout, Space, Tabs, Tag, Tooltip, Typography, theme } from "antd";

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

const { Header, Content } = Layout;
const { Text } = Typography;

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
  const loading = useShell((s) => s.loading);
  const tplLoading = useShell((s) => s.tplLoading);

  const keyOpen = useShell((s) => s.keyOpen);
  const batchOpen = useShell((s) => s.batchOpen);
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
    if (!hasToken()) {
      message.error("没有拿到访问令牌：请从 magpie 的插件页面打开这个界面。");
      return;
    }
    void useShell.getState().boot();
  }, [message]);

  const groups = React.useMemo(
    () => (catalog.models || []).filter((m) => m.group).slice(0, 8),
    [catalog],
  );

  const groupMessage = () => message.info("路由组（auto/*）不能用于 key 的模型限制");

  const statusTags = [];
  if (health && !health.gateway?.ok && !health.cli) {
    statusTags.push(
      <Tag key="svc" color="red" style={{ margin: 0 }}>
        本地服务异常
      </Tag>,
    );
  } else if (health) {
    statusTags.push(
      <Tag key="gw" color={health.gateway?.ok ? "green" : "red"} style={{ margin: 0 }}>
        {health.gateway?.ok ? `网关正常 · ${health.gateway.models} 个模型` : "网关连不上"}
      </Tag>,
    );
    statusTags.push(
      <Tag key="cli" color={health.cli?.ok ? "green" : "red"} style={{ margin: 0 }}>
        {health.cli?.ok ? "magpie CLI 可用" : "找不到 magpie 命令"}
      </Tag>,
    );
    statusTags.push(
      <Tooltip key="file" title={health.keysFile}>
        <Tag color={health.writable ? "default" : "orange"} style={{ margin: 0 }}>
          {health.writable ? "密钥文件可写" : "密钥文件只读"}
        </Tag>
      </Tooltip>,
    );
  }

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
        <Space size={8} style={{ paddingBottom: 6 }}>
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke={token.colorPrimary}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="8" r="3.2" />
            <path d="M2.8 20c0-3.4 2.8-6.2 6.2-6.2s6.2 2.8 6.2 6.2" />
            <path d="M16.5 5.5h5M19 3v5" />
            <circle cx="18.2" cy="16.2" r="2.4" />
          </svg>
          <Text strong>网关用户管理</Text>
        </Space>
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
            onPeriod={setPeriod}
            onNew={() => useShell.getState().openKey()}
            onBatch={() => useShell.getState().openBatch()}
            onExport={() => void useShell.getState().exportKeys()}
            onRefresh={() => void useShell.getState().refreshKeys()}
            onEdit={(key) => useShell.getState().openDetail(key)}
            onToggle={(key) => void useShell.getState().toggleKey(key)}
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
        onGroup={groupMessage}
      />
      <BatchModal
        open={batchOpen}
        onClose={() => useShell.getState().closeBatch()}
        onSubmit={useShell.getState().batchKeys}
        templates={templates}
        providers={catalog.providers || []}
        groups={groups}
        onGroup={groupMessage}
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
        onDelete={() => void useShell.getState().deleteKey()}
        onCopySecret={() => void useShell.getState().copySecret()}
        providers={catalog.providers || []}
        groups={groups}
        onGroup={groupMessage}
      />
      <TemplateModal
        open={!!tplDialog}
        template={tplDialog?.template || null}
        onClose={() => useShell.getState().closeTemplate()}
        onSubmit={useShell.getState().saveTemplate}
        providers={catalog.providers || []}
        groups={groups}
        onGroup={groupMessage}
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
