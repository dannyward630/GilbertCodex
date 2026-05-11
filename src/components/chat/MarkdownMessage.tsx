import { Children, isValidElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { copyTextToClipboard } from "../../lib/clipboard";
import { normalizeMarkdownForDisplay } from "../../lib/markdown";
import { OpenableImage } from "./MessageAttachments";

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
}

interface CodeBlockProps {
  className?: string;
  code: string;
  language?: string;
}

function getCodeText(children: ReactNode) {
  return Children.toArray(children).join("").replace(/\n$/, "");
}

function CodeBlock({ className, code, language }: CodeBlockProps) {
  const copiedTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const displayLanguage = language || "code";

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const didCopy = await copyTextToClipboard(code);

    if (!didCopy) {
      return;
    }

    setCopied(true);

    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }

    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1400);
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{displayLanguage}</span>
        <button type="button" aria-label={copied ? "Code copied" : "Copy code"} title={copied ? "Code copied" : "Copy code"} onClick={handleCopy}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </button>
      </div>
      <pre>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  img({ alt, src }) {
    if (!src) {
      return null;
    }

    return <OpenableImage alt={alt || "Assistant image"} className="markdown-image-button" src={src} />;
  },
  table({ children }) {
    return (
      <div className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}>
        <table>{children}</table>
      </div>
    );
  },
  pre({ children }) {
    const child = Children.toArray(children)[0];

    if (!isValidElement(child)) {
      return <pre>{children}</pre>;
    }

    const childProps = child.props as { children?: ReactNode; className?: string };
    const className = childProps.className;
    const language = /language-([\w-]+)/.exec(className ?? "")?.[1];

    return <CodeBlock className={className} code={getCodeText(childProps.children)} language={language} />;
  },
  code({ children, className, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export function MarkdownMessage({ content, isStreaming }: MarkdownMessageProps) {
  const displayContent = useMemo(() => normalizeMarkdownForDisplay(content), [content]);

  if (!content) {
    return null;
  }

  return (
    <div className={isStreaming ? "markdown-message markdown-message-streaming" : "markdown-message"} data-streaming={Boolean(isStreaming)}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {displayContent}
      </ReactMarkdown>
    </div>
  );
}
