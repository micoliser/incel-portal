/**
 * Files in chat: previews are made in the browser (the server only ever sees
 * encrypted bytes), then file and preview are encrypted and uploaded.
 */
import { attachmentUrl, reserveAttachment } from "@/lib/chat/api";
import { decryptFile, encryptFile, MAX_FILE_BYTES } from "@/lib/chat/crypto";

export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const INLINE_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-wav", "audio/flac"]);

/**
 * Types that are opened in a browser tab. Only passive content: a file's type
 * is chosen by whoever sent it, and a page opened from a decrypted file runs
 * as the portal itself, so anything that can carry script (SVG, HTML, XML…)
 * must never be opened, only saved.
 */
const OPENABLE_TYPES = new Set([...INLINE_IMAGE_TYPES, ...INLINE_VIDEO_TYPES, ...AUDIO_TYPES, "application/pdf", "text/plain"]);

/** "Image/PNG; charset=x" → "image/png". */
export function baseMime(mime: unknown): string {
  return typeof mime === "string" ? mime.split(";")[0].trim().toLowerCase() : "";
}

export function canOpenInBrowser(mime: unknown) {
  return OPENABLE_TYPES.has(baseMime(mime));
}

/**
 * An object URL for file bytes, typed so the browser can never run it as a
 * page: types not on the list above become a plain download.
 */
export function safeObjectUrl(data: Blob | BlobPart, mime: unknown) {
  const base = baseMime(mime);
  const type = !OPENABLE_TYPES.has(base) ? "application/octet-stream" : base === "text/plain" ? "text/plain;charset=utf-8" : base;
  return URL.createObjectURL(new Blob([data], { type }));
}
const THUMB_EDGE = 480;

export type FileDetails = {
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  /** A recorded voice note (shown as a player, not a file). */
  voice?: boolean;
  /** Voice notes only: loudness bars from 0 to 100. */
  waveform?: number[];
};

export type UploadedAttachment = FileDetails & {
  id: string;
  file_key: string;
  thumb_key?: string;
};

function scaled(width: number, height: number) {
  const ratio = Math.min(1, THUMB_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.78));
}

async function imagePreview(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const size = scaled(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    return { width: bitmap.width, height: bitmap.height, thumb: await canvasToBlob(canvas) };
  } finally {
    bitmap.close();
  }
}

function videoPreview(file: File): Promise<{ width: number; height: number; duration: number; thumb: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const done = (value: { width: number; height: number; duration: number; thumb: Blob | null } | null) => {
      URL.revokeObjectURL(url);
      if (value) resolve(value);
      else reject(new Error("No preview"));
    };
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 0) / 2);
    };
    video.onseeked = async () => {
      const size = scaled(video.videoWidth || 1, video.videoHeight || 1);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.drawImage(video, 0, 0, size.width, size.height);
      done({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        thumb: await canvasToBlob(canvas),
      });
    };
    video.src = url;
  });
}

export function fileTooLarge(file: File) {
  return file.size > MAX_FILE_BYTES;
}

async function put(url: string, bytes: Uint8Array) {
  const response = await fetch(url, {
    method: "PUT",
    body: new Blob([bytes as BlobPart]),
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!response.ok) throw new Error("Upload failed.");
}

/** Encrypt and upload one file (and its preview). The keys stay in the message. */
export async function uploadEncrypted(
  conversationId: string,
  file: File,
  extra?: Pick<FileDetails, "voice" | "duration" | "waveform">,
): Promise<UploadedAttachment> {
  const mime = file.type || "application/octet-stream";
  const details: FileDetails = { name: file.name || "file", mime, size: file.size, ...extra };
  let thumb: Blob | null = null;
  try {
    if (extra?.voice) {
      // A voice note has no preview image.
    } else if (INLINE_IMAGE_TYPES.has(mime)) {
      const preview = await imagePreview(file);
      Object.assign(details, { width: preview.width, height: preview.height });
      thumb = preview.thumb;
    } else if (mime.startsWith("video/")) {
      const preview = await videoPreview(file);
      Object.assign(details, { width: preview.width, height: preview.height, duration: preview.duration });
      thumb = preview.thumb;
    }
  } catch {
    thumb = null; // Not every file has a preview the browser can make.
  }

  const encrypted = await encryptFile(await file.arrayBuffer());
  const encryptedThumb = thumb ? await encryptFile(await thumb.arrayBuffer()) : null;
  const reserved = await reserveAttachment(
    conversationId,
    encrypted.bytes.length,
    encryptedThumb ? encryptedThumb.bytes.length : null,
  );
  await put(reserved.upload_url, encrypted.bytes);
  if (encryptedThumb && reserved.thumb_upload_url) {
    await put(reserved.thumb_upload_url, encryptedThumb.bytes);
  }
  return {
    ...details,
    id: reserved.id,
    file_key: encrypted.key,
    thumb_key: encryptedThumb?.key,
  };
}

const objectUrls = new Map<string, Promise<string>>();

/** Download, decrypt and expose a file (or its preview) as an object URL. Cached for the session. */
export function decryptedUrl(attachmentId: string, part: "file" | "thumb", key: string, mime: string) {
  const cacheKey = `${attachmentId}:${part}`;
  let pending = objectUrls.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const url = await attachmentUrl(attachmentId, part);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed.");
      const plain = await decryptFile(await response.arrayBuffer(), key);
      return safeObjectUrl(plain as BlobPart, part === "thumb" ? "image/jpeg" : mime);
    })();
    pending.catch(() => objectUrls.delete(cacheKey));
    objectUrls.set(cacheKey, pending);
  }
  return pending;
}

/** Drop every decrypted file from memory (on lock or sign-out). */
export function releaseDecryptedFiles() {
  for (const pending of objectUrls.values()) {
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  objectUrls.clear();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Which photos and videos this browser has already downloaded, so they show
 * as downloaded (no size, no download button) the next time. Only ids are
 * kept, never content; the files themselves are fetched and decrypted again.
 */
const DOWNLOADED_KEY = "portal-chat-downloaded";
const DOWNLOADED_LIMIT = 1000;

function readDownloaded(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(DOWNLOADED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function wasDownloaded(attachmentId: string) {
  if (typeof window === "undefined") return false;
  return readDownloaded().includes(attachmentId);
}

export function markDownloaded(attachmentId: string) {
  if (typeof window === "undefined" || attachmentId.startsWith("local-")) return;
  const ids = readDownloaded().filter((id) => id !== attachmentId);
  ids.push(attachmentId);
  try {
    window.localStorage.setItem(DOWNLOADED_KEY, JSON.stringify(ids.slice(-DOWNLOADED_LIMIT)));
  } catch {
    // Storage full or blocked: the tile just offers the download again.
  }
}
