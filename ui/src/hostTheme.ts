import React from "react";

// magpie 的主题从窗口发给插件页：`{ dark, lang, tokens }`，token 是
// 窗口根元素上的 --bg / --card / --fg / --line / --accent 等颜色
//（docs/subsystems/plugin-runtime.md）。页面用 location.replace 跳到
// 本地服务后，bridge 已经没了，所以要自己跟窗口再说一次 hello，并在
// 主题切换时继续接收 theme 事件。
//
// 下面两份是 magpie 的默认调色板：窗口还没回答、或者页面被单独打开时
// 用它们，颜色和 magpie 的浅色 / 深色主题一致。

export type ThemeTokens = Record<string, string>;

export interface HostTheme {
  dark: boolean;
  lang: string;
  tokens: ThemeTokens;
}

export const LIGHT_TOKENS: ThemeTokens = {
  bg: "#f4f4f6",
  card: "#ffffff",
  fg: "#1c1c21",
  "fg-2": "#4b4b53",
  muted: "#85858d",
  faint: "#b9b9c2",
  line: "#e3e3e8",
  accent: "#4f46e5",
  "accent-soft": "#eeedfd",
  "accent-fg": "#ffffff",
  green: "#189a58",
  red: "#d64545",
  amber: "#b45309",
};

export const DARK_TOKENS: ThemeTokens = {
  bg: "#1a1a1e",
  card: "#232327",
  fg: "#ededf1",
  "fg-2": "#b9b9c1",
  muted: "#8b8b94",
  faint: "#56565f",
  line: "#333339",
  accent: "#a5b4fc",
  "accent-soft": "#2b2c47",
  "accent-fg": "#14142a",
  green: "#6fd99b",
  red: "#f28b82",
  amber: "#f2b544",
};

const HELLO_ID = 1;

function hashMode(): "dark" | "light" | undefined {
  try {
    const mode = new URLSearchParams(window.location.hash.slice(1)).get("t");
    return mode === "dark" || mode === "light" ? mode : undefined;
  } catch {
    return undefined;
  }
}

function initialTheme(): HostTheme {
  const mode = hashMode();
  const dark = mode ? mode === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return { dark, lang: "zh", tokens: dark ? DARK_TOKENS : LIGHT_TOKENS };
}

function normalize(value: unknown): HostTheme | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { dark?: unknown; lang?: unknown; tokens?: unknown };
  if (typeof raw.dark !== "boolean") return null;
  const tokens: ThemeTokens = { ...(raw.dark ? DARK_TOKENS : LIGHT_TOKENS) };
  if (raw.tokens && typeof raw.tokens === "object") {
    for (const [key, token] of Object.entries(raw.tokens as Record<string, unknown>)) {
      if (typeof token === "string" && token.trim()) tokens[key] = token.trim();
    }
  }
  return {
    dark: raw.dark,
    lang: typeof raw.lang === "string" ? raw.lang : "zh",
    tokens,
  };
}

export function applyTheme(theme: HostTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.dark ? "dark" : "light";
  root.style.colorScheme = theme.dark ? "dark" : "light";
  for (const [key, value] of Object.entries(theme.tokens)) {
    if (value) root.style.setProperty(`--magpie-${key}`, value);
  }
}

export function useHostTheme(): HostTheme {
  const [theme, setTheme] = React.useState<HostTheme>(initialTheme);
  // 窗口回答过 hello 之后，主题由窗口推来；只有在没有窗口回答时才听系统。
  const hosted = React.useRef(false);

  React.useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  React.useEffect(() => {
    let alive = true;
    const receive = (value: unknown) => {
      const next = normalize(value);
      if (!next || !alive) return;
      hosted.current = true;
      setTheme(next);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data as
        | { magpie?: number; id?: number; event?: string; data?: unknown; result?: unknown; error?: string }
        | null;
      if (!message || message.magpie !== 1) return;
      if (message.event === "theme") {
        receive(message.data);
        return;
      }
      if (message.id === HELLO_ID) {
        if (message.error) return;
        receive(message.result);
      }
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ magpie: 1, id: HELLO_ID, method: "hello" }, "*");
    }
    return () => {
      alive = false;
      window.removeEventListener("message", onMessage);
    };
  }, []);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      if (hosted.current) return;
      setTheme({
        dark: event.matches,
        lang: "zh",
        tokens: event.matches ? DARK_TOKENS : LIGHT_TOKENS,
      });
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return theme;
}
