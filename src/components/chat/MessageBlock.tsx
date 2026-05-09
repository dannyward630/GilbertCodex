import type { ReactNode } from "react";

interface MessageBlockProps {
  children: ReactNode;
  isStreaming?: boolean;
  role: "assistant" | "user";
  status?: "error";
}

export function MessageBlock({ children, isStreaming, role, status }: MessageBlockProps) {
  return (
    <article className="message-block" data-role={role} data-status={status} data-streaming={isStreaming}>
      <div className="message-content">{children}</div>
    </article>
  );
}
