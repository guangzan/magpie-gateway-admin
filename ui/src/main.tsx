import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import type { ConfigProviderProps, ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";

import Shell from "./App";
import useAppTheme from "./appTheme";
import { useHostTheme } from "./hostTheme";
import "./app.css";

// antd 的类型里没写 motion 这个 token，但 theme 的 alias 计算认它（motion: false
// 会把三档过渡时长都置成 0s）。
type MotionToken = ThemeConfig["token"] & { motion?: boolean };

function Root() {
  const host = useHostTheme();
  const app = useAppTheme(host);

  const token: MotionToken = {
    motion: false,
    fontSize: 13,
  };

  const componentProps: ConfigProviderProps = {
    ...app,
    theme: { ...app.theme, token: { ...app.theme?.token, ...token } },
  };

  return (
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      {...componentProps}
      wave={{ ...componentProps.wave, disabled: true }}
      button={{ ...componentProps.button, autoInsertSpace: false }}
    >
      <AntApp>
        <Shell />
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
