import { Download, File, Image as ImageIcon, Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAttachmentSize, isImageAttachment } from "../../lib/chatAttachments";
import type { ChatAttachment, ChatImageAttachment } from "../../types/chat";

interface MessageAttachmentsProps {
  attachments?: ChatAttachment[];
}

interface OpenableImageProps {
  alt?: string;
  caption?: string;
  className?: string;
  src: string;
}

export function MessageAttachments({ attachments }: MessageAttachmentsProps) {
  if (!attachments?.length) {
    return null;
  }

  const imageAttachments = attachments.filter(isImageAttachment);
  const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");

  return (
    <div className="message-attachments" aria-label="Message attachments">
      {imageAttachments.length > 0 ? (
        <div className="message-image-grid" data-count={Math.min(imageAttachments.length, 4)}>
          {imageAttachments.map((attachment) => (
            <MessageImageTile key={attachment.id} attachment={attachment} />
          ))}
        </div>
      ) : null}
      {fileAttachments.length > 0 ? (
        <div className="message-file-list">
          {fileAttachments.map((attachment) => (
            <div key={attachment.id} className="message-file-pill">
              <File size={16} aria-hidden="true" />
              <span>
                <strong>{attachment.name}</strong>
                <small>{formatAttachmentSize(attachment.size)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OpenableImage({ alt = "Image attachment", caption, className, src }: OpenableImageProps) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      <button className={className ?? "message-image-button"} type="button" aria-label={`Open ${alt}`} onClick={() => setViewerOpen(true)}>
        <img alt={alt} src={src} />
        <span className="message-image-open">
          <Maximize2 size={15} aria-hidden="true" />
        </span>
      </button>
      {viewerOpen ? <ImageLightbox alt={alt} caption={caption} src={src} onClose={() => setViewerOpen(false)} /> : null}
    </>
  );
}

function MessageImageTile({ attachment }: { attachment: ChatImageAttachment }) {
  const details = [
    attachment.width && attachment.height ? `${attachment.width} x ${attachment.height}` : null,
    formatAttachmentSize(attachment.size),
  ]
    .filter(Boolean)
    .join(" - ");

  return <OpenableImage alt={attachment.name} caption={details ? `${attachment.name} - ${details}` : attachment.name} src={attachment.dataUrl} />;
}

function ImageLightbox({ alt, caption, onClose, src }: { alt: string; caption?: string; onClose: () => void; src: string }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="image-viewer-backdrop" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <div className="image-viewer" onClick={(event) => event.stopPropagation()}>
        <header className="image-viewer-toolbar">
          <span>
            <ImageIcon size={16} aria-hidden="true" />
            {caption || alt}
          </span>
          <div>
            <a href={src} download={alt || "image"} aria-label="Download image" title="Download image">
              <Download size={17} aria-hidden="true" />
            </a>
            <button type="button" aria-label="Close image viewer" title="Close" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="image-viewer-stage">
          <img alt={alt} src={src} />
        </div>
      </div>
    </div>
  );
}
