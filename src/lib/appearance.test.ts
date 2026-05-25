import { describe, expect, it } from "vitest";
import { createAppearanceCssVariables, DEFAULT_APP_APPEARANCE_SETTINGS, normalizeAppAppearanceSettings } from "./appearance";

describe("appearance settings", () => {
  it("normalizes chat width controls for legacy and out-of-range stored settings", () => {
    expect(normalizeAppAppearanceSettings({}).chatResponseWidth).toBe(DEFAULT_APP_APPEARANCE_SETTINGS.chatResponseWidth);
    expect(normalizeAppAppearanceSettings({}).composerWidth).toBe(DEFAULT_APP_APPEARANCE_SETTINGS.composerWidth);
    expect(normalizeAppAppearanceSettings({}).userMessageWidth).toBe(DEFAULT_APP_APPEARANCE_SETTINGS.userMessageWidth);

    expect(
      normalizeAppAppearanceSettings({
        chatResponseWidth: 320,
        composerWidth: 240,
        userMessageWidth: 1200,
      }).chatResponseWidth,
    ).toBe(640);
    expect(
      normalizeAppAppearanceSettings({
        chatResponseWidth: 320,
        composerWidth: 240,
        userMessageWidth: 1200,
      }).composerWidth,
    ).toBe(560);
    expect(
      normalizeAppAppearanceSettings({
        composerWidth: 240,
        userMessageWidth: 1200,
      }).userMessageWidth,
    ).toBe(920);
  });

  it("exposes font and width choices as document CSS variables", () => {
    const settings = normalizeAppAppearanceSettings({
      ...DEFAULT_APP_APPEARANCE_SETTINGS,
      chatResponseWidth: 900,
      codeFontSize: 16,
      composerWidth: 760,
      uiFontSize: 18,
      userMessageWidth: 520,
    });

    expect(createAppearanceCssVariables("dark", settings)).toMatchObject({
      "--chat-response-max-width": "900px",
      "--chat-user-message-max-width": "520px",
      "--code-font-size": "16px",
      "--composer-max-width": "760px",
      "--font-size-12": "15.429px",
      "--font-size-14": "18px",
      "--ui-font-size": "18px",
    });
  });
});
