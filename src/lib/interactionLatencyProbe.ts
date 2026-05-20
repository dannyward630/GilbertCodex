import { useEffect } from "react";

const SLOW_INTERACTION_MS = 50;
const LONG_TASK_MS = 50;

interface InteractionSample {
  label: string;
  startedAt: number;
  type: string;
}

export function useInteractionLatencyProbe(scope: string, enabled = true) {
  useEffect(() => {
    if (!enabled || !import.meta.env.DEV || typeof window === "undefined") {
      return;
    }

    let latestInteraction: InteractionSample | null = null;
    let interactionId = 0;
    let longTaskObserver: PerformanceObserver | null = null;

    const startInteraction = (type: string, target: EventTarget | null) => {
      latestInteraction = {
        label: getInteractionLabel(target),
        startedAt: performance.now(),
        type,
      };
    };

    const finishInteraction = (target: EventTarget | null) => {
      const sample = latestInteraction ?? {
        label: getInteractionLabel(target),
        startedAt: performance.now(),
        type: "click",
      };
      const currentInteractionId = ++interactionId;

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (currentInteractionId !== interactionId) {
            return;
          }

          const duration = performance.now() - sample.startedAt;

          if (duration >= SLOW_INTERACTION_MS) {
            console.warn(`[${scope}] slow interaction`, {
              durationMs: Math.round(duration),
              label: sample.label,
              type: sample.type,
            });
          }
        });
      });
    };

    const handlePointerDown = (event: PointerEvent) => startInteraction(event.type, event.target);
    const handleInput = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;

      if (!target?.matches("input, textarea, [contenteditable='true']")) {
        return;
      }

      startInteraction("input", target);
      finishInteraction(target);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      startInteraction(`key:${event.key}`, event.target);
    };
    const handleClick = (event: MouseEvent) => finishInteraction(event.target);

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("input", handleInput, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("click", handleClick, true);

    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONG_TASK_MS) {
            console.warn(`[${scope}] long task`, {
              durationMs: Math.round(entry.duration),
              name: entry.name,
              startedAtMs: Math.round(entry.startTime),
            });
          }
        }
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
    }

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("input", handleInput, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("click", handleClick, true);
      longTaskObserver?.disconnect();
    };
  }, [enabled, scope]);
}

function getInteractionLabel(target: EventTarget | null) {
  const element = target instanceof Element
    ? target.closest("[data-latency-label], button, [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [role='tab'], a, input, select, textarea")
    : null;

  if (!element) {
    return "unknown";
  }

  const explicitLabel = element.getAttribute("data-latency-label")?.trim();
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  const title = element.getAttribute("title")?.trim();
  const textLabel = element.textContent?.replace(/\s+/g, " ").trim();

  return explicitLabel || ariaLabel || title || textLabel?.slice(0, 96) || element.tagName.toLowerCase();
}
