import { describe, expect, test } from "bun:test";

import { cleanLimit, cleanLimits, cleanModels, cleanName, ValidationError } from "../lib/validate.mjs";

describe("cleanName", () => {
  test("trims and keeps unicode", () => {
    expect(cleanName("  张三  ")).toBe("张三");
  });

  test("rejects empty", () => {
    expect(() => cleanName("   ")).toThrow(ValidationError);
  });

  test("rejects over 120 runes", () => {
    expect(() => cleanName("字".repeat(121))).toThrow(ValidationError);
  });
});

describe("cleanModels", () => {
  test("dedupes case-insensitively and splits on commas", () => {
    expect(cleanModels("openai/gpt-5, OpenAI/GPT-5\nanthropic/*")).toEqual(["openai/gpt-5", "anthropic/*"]);
  });

  test("needs a provider slash", () => {
    expect(() => cleanModels(["gpt-5"])).toThrow(ValidationError);
    expect(() => cleanModels(["/gpt-5"])).toThrow(ValidationError);
    expect(() => cleanModels(["openai/"])).toThrow(ValidationError);
  });
});

describe("cleanLimit", () => {
  const now = new Date("2026-01-02T03:04:05.000Z");

  test("empty limits disappear", () => {
    expect(cleanLimit({ period: "day" }, now)).toBeNull();
  });

  test("calendar limits carry no since", () => {
    const l = cleanLimit({ period: "week", tokens: 100 }, now);
    expect(l).toEqual({ period: "week", tokens: 100, cost: 0 });
  });

  test("cyclic limits start now", () => {
    const l = cleanLimit({ period: "days", days: 7, cost: 1.23456 }, now);
    expect(l.since).toBe(now.toISOString());
    expect(l.cost).toBe(1.2346);
  });

  test("days need a cycle", () => {
    expect(() => cleanLimit({ period: "days", tokens: 1 }, now)).toThrow(ValidationError);
    expect(() => cleanLimit({ period: "days", days: 3651, tokens: 1 }, now)).toThrow(ValidationError);
  });

  test("rejects routing groups in a limit", () => {
    expect(() => cleanLimit({ period: "day", tokens: 1, models: ["auto/deepseek"] }, now)).toThrow(ValidationError);
  });

  test("caps at five and rejects duplicates", () => {
    const one = { period: "day", tokens: 1 };
    expect(() => cleanLimits([one, { ...one }], now)).toThrow(ValidationError);
    expect(() =>
      cleanLimits([one, { period: "week", tokens: 1 }, { period: "month", tokens: 1 }, { period: "days", days: 2, tokens: 1 }, { period: "hours", hours: 3, tokens: 1 }, { period: "hours", hours: 4, tokens: 1 }], now),
    ).toThrow(ValidationError);
  });
});
