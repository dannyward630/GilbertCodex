export type HostPlatform = "linux" | "macos" | "unknown" | "windows";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function getHostPlatform(): HostPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  return normalizeHostPlatform(
    `${(navigator as NavigatorWithUserAgentData).userAgentData?.platform ?? navigator.platform ?? ""} ${navigator.userAgent ?? ""}`,
  );
}

export function normalizeHostPlatform(value: string | null | undefined): HostPlatform {
  const platformSource = String(value ?? "").toLowerCase();

  if (platformSource.includes("mac") || platformSource.includes("darwin")) {
    return "macos";
  }

  if (platformSource.includes("win")) {
    return "windows";
  }

  if (platformSource.includes("linux") || platformSource.includes("x11")) {
    return "linux";
  }

  return "unknown";
}

export function isMacHostPlatform(platform: HostPlatform | string | null | undefined) {
  return normalizeHostPlatform(platform) === "macos";
}

export function formatShortcutForPlatform(shortcut: string, platform: HostPlatform | string | null | undefined) {
  if (!isMacHostPlatform(platform)) {
    return shortcut;
  }

  return shortcut
    .replace(/\bCtrl\+/g, "Command+")
    .replace(/\bAlt\+/g, "Option+")
    .replace(/\bWin\+/g, "Command+");
}

export function formatHostPlatformLabel(platform: HostPlatform | string | null | undefined, arch?: string | null) {
  const normalized = normalizeHostPlatform(platform);
  const platformLabel =
    normalized === "macos" ? "macOS" : normalized === "windows" ? "Windows" : normalized === "linux" ? "Linux" : "Unknown platform";
  const architecture = arch?.trim();

  return architecture ? `${platformLabel} ${architecture}` : platformLabel;
}
