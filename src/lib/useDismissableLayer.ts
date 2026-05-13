import { useEffect } from "react";

interface DismissableLayerRef {
  current: HTMLElement | null;
}

interface UseDismissableLayerOptions {
  active: boolean;
  ignoreSelectors?: string[];
  keyboardTarget?: "document" | "window";
  onDismiss: () => void;
  refs: DismissableLayerRef[];
}

export function useDismissableLayer({
  active,
  ignoreSelectors = [],
  keyboardTarget = "document",
  onDismiss,
  refs,
}: UseDismissableLayerOptions) {
  useEffect(() => {
    if (!active) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      const targetElement = target instanceof Element ? target : null;

      if (target && refs.some((ref) => ref.current?.contains(target))) {
        return;
      }

      if (targetElement && ignoreSelectors.some((selector) => targetElement.closest(selector))) {
        return;
      }

      onDismiss();
    }

    function handleKeyDown(event: Event) {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        onDismiss();
      }
    }

    const keyTarget = keyboardTarget === "window" ? window : document;

    document.addEventListener("pointerdown", handlePointerDown);
    keyTarget.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      keyTarget.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, ignoreSelectors, keyboardTarget, onDismiss, refs]);
}
