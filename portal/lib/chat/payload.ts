/**
 * Checks a decrypted message before it is shown. The contents come from the
 * sender's browser, which may be modified, so nothing in them is trusted: a
 * message whose contents are not exactly what the portal sends is shown as
 * "This message is not available" rather than half-shown or able to break the
 * chat for everyone who opens it.
 */
import { MAX_FILE_BYTES } from "@/lib/chat/crypto";
import { cleanPreview, type LinkPreview } from "@/components/chat/link-preview";
import { baseMime, type UploadedAttachment } from "@/lib/chat/media";
import { VOICE_BARS } from "@/lib/chat/voice";

/** Far more than the server's encrypted-size limit lets through; only a sanity bound. */
const MAX_TEXT = 100_000;
const MAX_ATTACHMENTS = 10;
const MAX_NAME = 255;
const MAX_ID = 64;
// A 32-byte libsodium key in standard base64.
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

export type MessageContents = {
  text: string;
  replyTo: string | null;
  replyPreview: { senderId: number | null; text: string } | null;
  forwarded: number;
  linkPreview: LinkPreview | null;
  attachments: UploadedAttachment[];
};

class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function optional<T>(value: unknown, check: (v: unknown) => T): T | undefined {
  return value === undefined || value === null ? undefined : check(value);
}

function string(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) fail();
  return value;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail();
  return value;
}

function attachment(value: unknown): UploadedAttachment {
  if (!isObject(value)) fail();
  const name = string(value.name, MAX_NAME);
  if (!name) fail();
  const fileKey = string(value.file_key, 44);
  if (!KEY_PATTERN.test(fileKey)) fail();
  const thumbKey = optional(value.thumb_key, (v) => {
    const key = string(v, 44);
    if (!KEY_PATTERN.test(key)) fail();
    return key;
  });
  const voice = optional(value.voice, (v) => (typeof v === "boolean" ? v : fail()));
  const waveform = optional(value.waveform, (v) => {
    if (!Array.isArray(v) || v.length > VOICE_BARS * 2) fail();
    return v.map((bar) => number(bar, 0, 100));
  });
  return {
    id: string(value.id, MAX_ID),
    name,
    // "image/SVG+xml; x" and "image/svg+xml" are the same type to every check after this.
    mime: baseMime(string(value.mime, MAX_NAME)) || "application/octet-stream",
    size: number(value.size, 0, MAX_FILE_BYTES),
    file_key: fileKey,
    ...(thumbKey ? { thumb_key: thumbKey } : {}),
    ...optionalField("width", optional(value.width, (v) => number(v, 1, 100_000))),
    ...optionalField("height", optional(value.height, (v) => number(v, 1, 100_000))),
    ...optionalField("duration", optional(value.duration, (v) => number(v, 0, 24 * 60 * 60))),
    ...optionalField("voice", voice),
    ...optionalField("waveform", waveform),
  };
}

function optionalField<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** The message's contents, or null when anything in them is not what the portal sends. */
export function parseMessagePayload(payload: unknown): MessageContents | null {
  try {
    if (!isObject(payload)) fail();
    const text = optional(payload.text, (v) => string(v, MAX_TEXT)) ?? "";
    const replyTo = optional(payload.reply_to, (v) => string(v, MAX_ID)) ?? null;
    const replyPreview =
      optional(payload.reply_preview, (v) => {
        if (!isObject(v)) fail();
        const senderId = optional(v.sender_id, (id) => number(id, 0, Number.MAX_SAFE_INTEGER)) ?? null;
        return { senderId, text: string(v.text, MAX_TEXT) };
      }) ?? null;
    const forwarded = optional(payload.forwarded, (v) => Math.floor(number(v, 0, 1000))) ?? 0;
    const linkPreview =
      optional(payload.link_preview, (v) => {
        const clean = cleanPreview(v);
        return clean ?? fail();
      }) ?? null;
    const attachments =
      optional(payload.attachments, (v) => {
        if (!Array.isArray(v) || v.length > MAX_ATTACHMENTS) fail();
        return v.map(attachment);
      }) ?? [];
    return { text, replyTo, replyPreview, forwarded, linkPreview, attachments };
  } catch (error) {
    if (error instanceof Invalid) return null;
    throw error;
  }
}
