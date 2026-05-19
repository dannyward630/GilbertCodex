export type TopBarEditCommand = "undo" | "cut" | "copy" | "paste" | "selectAll";

export function runTopBarEditCommand(command: TopBarEditCommand) {
  const activeElement = document.activeElement;

  if (command === "selectAll") {
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      activeElement.select();
      return;
    }

    document.execCommand("selectAll");
    return;
  }

  if (command === "paste") {
    void pasteIntoActiveElement();
    return;
  }

  document.execCommand(command);
}

async function pasteIntoActiveElement() {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) {
    document.execCommand("paste");
    return;
  }

  try {
    const clipboardText = await navigator.clipboard.readText();
    const start = activeElement.selectionStart ?? activeElement.value.length;
    const end = activeElement.selectionEnd ?? activeElement.value.length;
    activeElement.setRangeText(clipboardText, start, end, "end");
    activeElement.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    document.execCommand("paste");
  }
}
