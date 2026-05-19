import type { MouseEvent } from "react";
import { maximizeWindow, startWindowDrag } from "../../app/windowClient";

export function handleTopBarMouseDown(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 || isTopBarInteractiveTarget(event.target as HTMLElement)) {
    return;
  }

  void startWindowDrag();
}

export function handleTopBarDoubleClick(event: MouseEvent<HTMLElement>) {
  if (isTopBarInteractiveTarget(event.target as HTMLElement)) {
    return;
  }

  void maximizeWindow();
}

function isTopBarInteractiveTarget(target: HTMLElement) {
  return Boolean(target.closest("button, input, textarea, select, a, [role='menu'], [data-topbar-interactive='true']"));
}
