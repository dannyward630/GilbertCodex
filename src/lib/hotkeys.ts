export interface ParsedHotkey {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

const MODIFIER_KEYS = new Set(["alt", "ctrl", "meta", "shift"]);

export function parseHotkey(hotkey: string): ParsedHotkey | null {
  const parts = hotkey
    .split("+")
    .map((part) => normalizeHotkeyPart(part))
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return {
    alt: parts.includes("alt"),
    ctrl: parts.includes("ctrl"),
    key: parts[parts.length - 1],
    meta: parts.includes("meta"),
    shift: parts.includes("shift"),
  };
}

export function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const parsedHotkey = parseHotkey(hotkey);

  if (!parsedHotkey) {
    return false;
  }

  const eventKey = normalizeEventKey(event);

  if (eventKey !== parsedHotkey.key) {
    return false;
  }

  if (MODIFIER_KEYS.has(parsedHotkey.key)) {
    return (
      (parsedHotkey.key === "alt" || event.altKey === parsedHotkey.alt) &&
      (parsedHotkey.key === "ctrl" || event.ctrlKey === parsedHotkey.ctrl) &&
      (parsedHotkey.key === "meta" || event.metaKey === parsedHotkey.meta) &&
      (parsedHotkey.key === "shift" || event.shiftKey === parsedHotkey.shift)
    );
  }

  return (
    event.altKey === parsedHotkey.alt &&
    event.ctrlKey === parsedHotkey.ctrl &&
    event.metaKey === parsedHotkey.meta &&
    event.shiftKey === parsedHotkey.shift
  );
}

function normalizeEventKey(event: KeyboardEvent) {
  if (event.code === "Space") {
    return "space";
  }

  return normalizeHotkeyPart(event.key);
}

function normalizeHotkeyPart(part: string) {
  const value = part.trim().toLowerCase();

  if (value === "control") {
    return "ctrl";
  }

  if (value === "cmd" || value === "command" || value === "win" || value === "windows") {
    return "meta";
  }

  if (value === "option") {
    return "alt";
  }

  if (value === "esc") {
    return "escape";
  }

  if (value === "return") {
    return "enter";
  }

  return value;
}
