import { useEffect } from "react";

import { openExternalUrl } from "../tauriClient";

function isUserExternalHref(href: string) {
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:");
}

export function useExternalLinkRouting() {
  useEffect(() => {
    function handleDocumentLinkClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const href = anchor.href;
      if (!isUserExternalHref(href)) {
        return;
      }

      event.preventDefault();
      void openExternalUrl(href).catch((error) => {
        console.error("Failed to open external link", error);
      });
    }

    document.addEventListener("click", handleDocumentLinkClick, true);
    return () => document.removeEventListener("click", handleDocumentLinkClick, true);
  }, []);
}
