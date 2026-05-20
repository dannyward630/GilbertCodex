import { Minus, Square, X } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow } from "../../app/windowClient";
import { isMacHostPlatform, type HostPlatform } from "../../lib/hostPlatform";

interface WindowControlsProps {
  hostPlatform?: HostPlatform;
}

export function WindowControls({ hostPlatform }: WindowControlsProps) {
  if (isMacHostPlatform(hostPlatform)) {
    return (
      <div className="window-controls window-controls-macos" aria-label="Window controls">
        <button className="macos-close-control" type="button" aria-label="Close window" title="Close window" onClick={() => void closeWindow()} />
        <button className="macos-minimize-control" type="button" aria-label="Minimize window" title="Minimize window" onClick={() => void minimizeWindow()} />
        <button className="macos-zoom-control" type="button" aria-label="Zoom window" title="Zoom window" onClick={() => void maximizeWindow()} />
      </div>
    );
  }

  return (
    <div className="window-controls" aria-label="Window controls">
      <button type="button" aria-label="Minimize window" onClick={() => void minimizeWindow()}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Maximize window" onClick={() => void maximizeWindow()}>
        <Square size={13} aria-hidden="true" />
      </button>
      <button className="close-control" type="button" aria-label="Close window" onClick={() => void closeWindow()}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
