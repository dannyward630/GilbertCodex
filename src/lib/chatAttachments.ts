import type { ChatAttachment, ChatFileAttachment, ChatImageAttachment, ChatVideoAttachment } from "../types/chat";
import { createId } from "./chatUtils";
import { readFileAsDataUrl } from "./fileDataUrl";

const RESIZED_IMAGE_MAX_EDGE = Number.POSITIVE_INFINITY;
const RESIZED_IMAGE_QUALITY = 0.88;
const RESIZE_IMAGE_SIZE_THRESHOLD = Number.POSITIVE_INFINITY;
const FILE_READ_TIMEOUT_MS = 120_000;
const IMAGE_METADATA_TIMEOUT_MS = 10_000;
const IMAGE_RESIZE_TIMEOUT_MS = 60_000;
const SAFE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const SAFE_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/mov",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
]);

export function isImageAttachment(attachment: ChatAttachment): attachment is ChatImageAttachment {
  return attachment.kind === "image";
}

export function isVideoAttachment(attachment: ChatAttachment): attachment is ChatVideoAttachment {
  return attachment.kind === "video";
}

export function isMediaAttachment(attachment: ChatAttachment): attachment is ChatImageAttachment | ChatVideoAttachment {
  return isImageAttachment(attachment) || isVideoAttachment(attachment);
}

export function formatAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 KB";
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function attachmentSummary(attachments: ChatAttachment[]) {
  if (attachments.length === 0) {
    return "";
  }

  return attachments
    .map((attachment) => {
      const kind = attachment.kind === "image" ? "Image" : attachment.kind === "video" ? "Video" : "File";
      return `- ${kind}: ${attachment.name} (${formatAttachmentSize(attachment.size)})`;
    })
    .join("\n");
}

export async function createChatAttachmentFromFile(file: File): Promise<ChatAttachment> {
  const now = new Date().toISOString();
  const id = createId("attachment");
  const name = file.name || "Attachment";
  const mimeType = normalizeAttachmentMimeType(file.type, name);
  const isPdf = mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  const isSvg = mimeType === "image/svg+xml" || name.toLowerCase().endsWith(".svg");
  const isSafeVideo = mimeType.startsWith("video/") && SAFE_VIDEO_MIME_TYPES.has(mimeType.toLowerCase());

  if (!mimeType.startsWith("image/") || isSvg || !SAFE_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
    if (isSafeVideo) {
      const dataUrl = await withTimeout(readFileAsDataUrl(file), FILE_READ_TIMEOUT_MS, "Could not read this video fast enough.");

      return {
        createdAt: now,
        dataUrl: coerceDataUrlMimeType(dataUrl, mimeType),
        id,
        kind: "video",
        mimeType,
        name,
        size: file.size,
      } satisfies ChatVideoAttachment;
    }

    if (isPdf) {
      const dataUrl = await withTimeout(readFileAsDataUrl(file), FILE_READ_TIMEOUT_MS, "Could not read this PDF fast enough.");

      return {
        createdAt: now,
        dataUrl,
        id,
        kind: "file",
        mimeType: "application/pdf",
        name,
        size: file.size,
      } satisfies ChatFileAttachment;
    }

    return {
      createdAt: now,
      id,
      kind: "file",
      mimeType,
      name,
      size: file.size,
    } satisfies ChatFileAttachment;
  }

  const originalDataUrl = await withTimeout(readFileAsDataUrl(file), FILE_READ_TIMEOUT_MS, "Could not read this image fast enough.");
  const imageSize = await withTimeout(getImageSize(originalDataUrl), IMAGE_METADATA_TIMEOUT_MS, {});
  const shouldKeepOriginal =
    file.size <= RESIZE_IMAGE_SIZE_THRESHOLD || mimeType === "image/gif" || !imageSize.width || !imageSize.height;
  const preparedImage = shouldKeepOriginal
    ? { dataUrl: originalDataUrl, mimeType }
    : await withTimeout(resizeImageDataUrl(originalDataUrl, imageSize), IMAGE_RESIZE_TIMEOUT_MS, {
        dataUrl: originalDataUrl,
        mimeType,
      });

  return {
    createdAt: now,
    dataUrl: preparedImage.dataUrl,
    height: imageSize.height,
    id,
    kind: "image",
    mimeType: preparedImage.mimeType,
    name,
    size: file.size,
    width: imageSize.width,
  } satisfies ChatImageAttachment;
}

function normalizeAttachmentMimeType(type: string, name: string) {
  const normalizedType = type.trim().toLowerCase();
  if (normalizedType) {
    if (normalizedType === "video/quicktime") {
      return "video/mov";
    }

    return normalizedType;
  }

  const extension = name.toLowerCase().split(".").pop();
  switch (extension) {
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "mov":
      return "video/mov";
    case "mpeg":
    case "mpg":
      return "video/mpeg";
    case "mp4":
      return "video/mp4";
    case "webp":
      return "image/webp";
    case "webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}

function getImageSize(dataUrl: string) {
  return new Promise<{ height?: number; width?: number }>((resolve) => {
    const image = new Image();

    image.addEventListener("load", () =>
      resolve({
        height: image.naturalHeight || undefined,
        width: image.naturalWidth || undefined,
      }),
    );
    image.addEventListener("error", () => resolve({}));
    image.src = dataUrl;
  });
}

async function resizeImageDataUrl(dataUrl: string, size: { height?: number; width?: number }) {
  const width = size.width ?? 0;
  const height = size.height ?? 0;

  if (!width || !height) {
    return {
      dataUrl,
      mimeType: dataUrlMimeType(dataUrl),
    };
  }

  const scale = Math.min(1, RESIZED_IMAGE_MAX_EDGE / Math.max(width, height));
  const nextWidth = Math.max(1, Math.round(width * scale));
  const nextHeight = Math.max(1, Math.round(height * scale));

  try {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return {
        dataUrl,
        mimeType: dataUrlMimeType(dataUrl),
      };
    }

    canvas.width = nextWidth;
    canvas.height = nextHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, nextWidth, nextHeight);
    context.drawImage(image, 0, 0, nextWidth, nextHeight);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", RESIZED_IMAGE_QUALITY),
      mimeType: "image/jpeg",
    };
  } catch {
    return {
      dataUrl,
      mimeType: dataUrlMimeType(dataUrl),
    };
  }
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Could not prepare this image.")));
    image.src = dataUrl;
  });
}

function dataUrlMimeType(dataUrl: string) {
  const match = /^data:([^;,]+)/.exec(dataUrl);
  return match?.[1] ?? "image/jpeg";
}

function coerceDataUrlMimeType(dataUrl: string, mimeType: string) {
  return dataUrl.replace(/^data:[^;,]*(;base64,)/i, `data:${mimeType}$1`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T>;
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T>;
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallbackOrError: T | string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (typeof fallbackOrError === "string") {
        reject(new Error(fallbackOrError));
        return;
      }

      resolve(fallbackOrError);
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
