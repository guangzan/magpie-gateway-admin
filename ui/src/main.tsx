import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";

import Shell from "./App";
import "./app.css";

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

// antd 的类型里没写 motion 这个 token，但 theme 的 alias 计算认它（motion: false
// 会把三档过渡时长都置成 0s）。
type MotionToken = ThemeConfig["token"] & { motion?: boolean };

function Root() {
  const dark = usePrefersDark();

  React.useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const token: MotionToken = {
    motion: false,
    borderRadius: 8,
    fontSize: 13,
  };

  return (
    <ConfigProvider
      locale={zhCN}
      wave={{ disabled: true }}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token,
      }}
    >
      <AntApp>
        <Shell />
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
