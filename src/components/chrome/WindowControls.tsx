import { Minus, Square, X } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow } from "../../app/windowClient";

export function WindowControls() {
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
