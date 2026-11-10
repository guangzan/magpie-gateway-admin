import { useMemo } from "react";
import { theme } from "antd";
import type { ConfigProviderProps, ThemeConfig } from "antd";

import useShadcnTheme from "./shadcnTheme";
import { DARK_TOKENS } from "./hostTheme";
import type { HostTheme } from "./hostTheme";

function pick(host: HostTheme, key: string, fallback: string): string {
  const value = host.tokens[key];
  return value || fallback;
}

// 深色主题直接取 magpie 的 token，背景、卡片、文字、边框和强调色才和窗口
// 一致；其余层级（悬浮、分割线、软色背景）用 magpie 深色调色板里的近似值。
function darkProps(host: HostTheme): ConfigProviderProps {
  const bg = pick(host, "bg", DARK_TOKENS.bg);
  const card = pick(host, "card", DARK_TOKENS.card);
  const fg = pick(host, "fg", DARK_TOKENS.fg);
  const fg2 = pick(host, "fg-2", DARK_TOKENS["fg-2"]);
  const muted = pick(host, "muted", DARK_TOKENS.muted);
  const faint = pick(host, "faint", DARK_TOKENS.faint);
  const line = pick(host, "line", DARK_TOKENS.line);
  const accent = pick(host, "accent", DARK_TOKENS.accent);
  const accentSoft = pick(host, "accent-soft", DARK_TOKENS["accent-soft"]);
  const accentFg = pick(host, "accent-fg", DARK_TOKENS["accent-fg"]);
  const green = pick(host, "green", DARK_TOKENS.green);
  const red = pick(host, "red", DARK_TOKENS.red);
  const amber = pick(host, "amber", DARK_TOKENS.amber);

  const elevated = "#29292e";
  const line2 = "#2c2c32";
  const pill = "#2d2d33";
  const hover = "#36363d";

  const config: ThemeConfig = {
    algorithm: theme.darkAlgorithm,
    token: {
      colorPrimary: accent,
      colorPrimaryBg: accentSoft,
      colorPrimaryBgHover: "#34355a",
      colorPrimaryBorder: "#4a4c7a",
      colorPrimaryBorderHover: "#6a6da8",
      colorPrimaryText: accent,
      colorSuccess: green,
      colorSuccessBg: "#1e3a2b",
      colorSuccessBorder: "#2d4d3a",
      colorSuccessText: green,
      colorWarning: amber,
      colorWarningBg: "#3f3220",
      colorWarningBorder: "#5a452a",
      colorWarningText: amber,
      colorError: red,
      colorErrorBg: "#45272a",
      colorErrorBorder: "#5c3134",
      colorErrorText: red,
      colorInfo: accent,
      colorInfoBg: "#26262b",
      colorInfoBorder: line,
      colorInfoText: fg2,
      colorTextBase: fg,
      colorBgBase: bg,
      colorText: fg,
      colorTextSecondary: muted,
      colorTextTertiary: "#6f6f79",
      colorTextQuaternary: faint,
      colorTextDisabled: faint,
      colorBgContainer: card,
      colorBgElevated: elevated,
      colorBgLayout: bg,
      colorBgSpotlight: "rgba(18, 18, 22, 0.96)",
      colorBgMask: "rgba(0, 0, 0, 0.55)",
      colorBorder: line,
      colorBorderSecondary: line2,
      colorSplit: line2,
      colorFillAlter: "rgba(255, 255, 255, 0.03)",
      colorFillSecondary: "rgba(255, 255, 255, 0.06)",
      colorFillTertiary: "rgba(255, 255, 255, 0.08)",
      colorFillQuaternary: "rgba(255, 255, 255, 0.04)",
      borderRadius: 8,
      boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.35), 0 1px 2px -1px rgba(0, 0, 0, 0.3)",
      boxShadowSecondary:
        "0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)",
    },
    components: {
      Layout: {
        bodyBg: bg,
        footerBg: bg,
        headerBg: bg,
        siderBg: bg,
        headerColor: fg,
        triggerBg: card,
        triggerColor: fg,
      },
      Button: {
        primaryColor: accentFg,
        defaultBg: "transparent",
        defaultColor: fg,
        defaultBorderColor: line,
        defaultHoverBg: pill,
        defaultHoverBorderColor: "#46464e",
        defaultHoverColor: fg,
        defaultActiveBg: "#33333a",
        defaultActiveBorderColor: "#54545c",
        primaryShadow: "none",
        defaultShadow: "none",
        dangerShadow: "none",
        borderRadius: 6,
      },
      Input: {
        activeShadow: "none",
        hoverBorderColor: "#56565f",
        activeBorderColor: accent,
        borderRadius: 6,
      },
      InputNumber: {
        activeShadow: "none",
        hoverBorderColor: "#56565f",
        activeBorderColor: accent,
      },
      Select: {
        optionSelectedBg: accentSoft,
        optionActiveBg: pill,
        optionSelectedFontWeight: 500,
        borderRadius: 6,
      },
      DatePicker: {
        activeShadow: "none",
        hoverBorderColor: "#56565f",
        activeBorderColor: accent,
      },
      Card: {
        colorBgContainer: card,
        headerBg: "transparent",
      },
      Table: {
        colorBgContainer: card,
        headerBg: "#1f1f23",
        headerColor: muted,
        headerSortActiveBg: hover,
        headerSortHoverBg: pill,
        rowHoverBg: "#28282d",
        rowSelectedBg: accentSoft,
        rowSelectedHoverBg: "#33345a",
        borderColor: line,
        headerSplitColor: "transparent",
        footerBg: "transparent",
      },
      Modal: {
        contentBg: card,
        headerBg: card,
        titleColor: fg,
        borderRadiusLG: 12,
      },
      Tabs: {
        inkBarColor: accent,
        itemColor: muted,
        itemHoverColor: fg,
        itemSelectedColor: fg,
        titleFontSize: 13,
      },
      Alert: {
        borderRadiusLG: 8,
      },
      Progress: {
        circleTextColor: fg,
        defaultColor: accent,
        remainingColor: "rgba(255, 255, 255, 0.08)",
      },
      Switch: {
        trackHeight: 22,
        trackMinWidth: 44,
        innerMinMargin: 4,
        innerMaxMargin: 24,
      },
      Checkbox: {
        borderRadiusSM: 4,
      },
      Slider: {
        trackBg: "#3a3a44",
        trackHoverBg: "#46464e",
        railBg: pill,
        railHoverBg: hover,
        handleColor: accent,
        handleActiveColor: accent,
        handleSize: 18,
        handleSizeHover: 20,
        railSize: 6,
      },
      Notification: {
        colorSuccessBg: "#1e3a2b",
        colorErrorBg: "#45272a",
        colorInfoBg: "#26262b",
        colorWarningBg: "#3f3220",
      },
    },
  };

  return { theme: config };
}

export default function useAppTheme(host: HostTheme): ConfigProviderProps {
  const light = useShadcnTheme();
  return useMemo(() => (host.dark ? darkProps(host) : light), [host, light]);
}
