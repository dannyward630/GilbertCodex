type IdleTaskWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

export function scheduleIdleTask(callback: () => void, timeoutMs = 1_000) {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  const idleWindow = window as IdleTaskWindow;
  let cancelled = false;
  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      cancelled = true;
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const handle = window.setTimeout(run, timeoutMs);
  return () => {
    cancelled = true;
    window.clearTimeout(handle);
  };
}
