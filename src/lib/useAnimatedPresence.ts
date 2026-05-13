import { useEffect, useState } from "react";

export function useAnimatedPresence(visible: boolean, exitDurationMs = 180) {
  const [mounted, setMounted] = useState(visible);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setExiting(false);
      return;
    }

    if (!mounted) {
      return;
    }

    setExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, exitDurationMs);

    return () => window.clearTimeout(timer);
  }, [exitDurationMs, mounted, visible]);

  return { exiting, mounted };
}
