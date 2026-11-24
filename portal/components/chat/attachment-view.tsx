"use client";

import { AlertCircle, Download, ExternalLink, FileText, Loader2, Pause, Play, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ChatAttachment } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  decryptedUrl,
  formatBytes,
  INLINE_IMAGE_TYPES,
  INLINE_VIDEO_TYPES,
  markDownloaded,
  wasDownloaded,
} from "@/lib/chat/media";
import { formatDuration } from "@/lib/chat/voice";
import { cn } from "@/lib/utils";

/** Photos and playable videos show as media tiles; everything else as a file card. */
export function isMedia(attachment: ChatAttachment) {
  if (attachment.voice) return false;
  return INLINE_IMAGE_TYPES.has(attachment.mime) || INLINE_VIDEO_TYPES.has(attachment.mime);
}

type UploadState = "sent" | "sending" | "failed";

function useDecrypted(attachment: ChatAttachment, part: "file" | "thumb", enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = part === "thumb" ? attachment.thumb_key : attachment.file_key;
  const pending = attachment.id.startsWith("local-");

  useEffect(() => {
    if (!enabled || !key || pending) return;
    let cancelled = false;
    decryptedUrl(attachment.id, part, key, attachment.mime)
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, attachment.mime, enabled, key, part, pending]);

  return { url, failed };
}

/** The decrypted file as a page-local address (fetched and decrypted once per session). */
function fileUrl(attachment: ChatAttachment) {
  return attachment.localUrl
    ? Promise.resolve(attachment.localUrl)
    : decryptedUrl(attachment.id, "file", attachment.file_key, attachment.mime);
}

function downloadLink(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

type SavePicker = (options: { suggestedName?: string }) => Promise<{
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

/**
 * Save to the computer. Chrome and Edge ask where (a "Save as" window);
 * other browsers save to Downloads, unless set to ask.
 */
async function saveFile(attachment: ChatAttachment) {
  const url = await fileUrl(attachment);
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker && window.self === window.top) {
    let handle;
    try {
      handle = await picker({ suggestedName: attachment.name });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return; // cancelled
      downloadLink(url, attachment.name);
      return;
    }
    const writable = await handle.createWritable();
    await writable.write(await (await fetch(url)).blob());
    await writable.close();
    return;
  }
  downloadLink(url, attachment.name);
}

// Types a browser shows by itself; anything else is handed to the computer to open.
function opensInBrowser(mime: string) {
  return (
    mime === "application/pdf" ||
    mime === "application/json" ||
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    (mime.startsWith("text/") && mime !== "text/html")
  );
}

/** Open the file: in a new tab when the browser can show it, otherwise as a download the browser offers to open. */
async function openFile(attachment: ChatAttachment) {
  if (!opensInBrowser(attachment.mime)) {
    downloadLink(await fileUrl(attachment), attachment.name);
    return;
  }
  // Open the tab straight away (from the click), then point it at the file once it is ready.
  const tab = window.open("", "_blank");
  try {
    const url = await fileUrl(attachment);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

function duration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The dark pill in the middle of a tile: download icon and size, or progress. */
function CenterPill({ children, label, onClick }: { children: React.ReactNode; label?: string; onClick?: () => void }) {
  const className =
    "flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm";
  if (!onClick) {
    return <span className={className}>{children}</span>;
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className={cn(className, "transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white")}
    >
      {children}
    </button>
  );
}

export function MediaTile({ attachment, mine, state }: { attachment: ChatAttachment; mine: boolean; state: UploadState }) {
  const isVideo = attachment.mime.startsWith("video/");
  const pending = attachment.id.startsWith("local-");
  // The sender has the file already, and anything downloaded once stays
  // downloaded: neither is offered as a download again.
  const [downloaded, setDownloaded] = useState(() => mine || Boolean(attachment.localUrl) || wasDownloaded(attachment.id));
  // Photos that count as downloaded load in full straight away; videos load
  // only when opened, since they can be large.
  const [wantFull, setWantFull] = useState(() => !isVideo && downloaded);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const thumb = useDecrypted(attachment, "thumb", attachment.has_thumb && !attachment.localUrl);
  const full = useDecrypted(attachment, "file", wantFull && !attachment.localUrl);

  const fullUrl = attachment.localUrl ?? full.url;
  const previewUrl = isVideo ? thumb.url : (attachment.localUrl ?? full.url ?? thumb.url);
  const loadingFull = wantFull && !fullUrl && !full.failed;

  useEffect(() => {
    if (full.url && !downloaded) {
      markDownloaded(attachment.id);
      setDownloaded(true);
    }
  }, [attachment.id, downloaded, full.url]);

  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : isVideo ? 16 / 9 : 4 / 3;
  // Portrait media is narrower, so tall photos do not fill the screen.
  const width = ratio < 1 ? 220 : 280;
  const length = duration(attachment.duration);

  function open() {
    if (pending) return;
    if (!fullUrl) setWantFull(true);
    setViewerOpen(true);
  }

  async function download() {
    setSaving(true);
    try {
      await saveFile(attachment);
    } finally {
      setSaving(false);
    }
  }

  let pill: React.ReactNode = null;
  if (state === "failed") {
    pill = (
      <CenterPill>
        <AlertCircle className="size-4" aria-hidden="true" /> Not sent
      </CenterPill>
    );
  } else if (pending || state === "sending") {
    pill = (
      <CenterPill>
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Sending
      </CenterPill>
    );
  } else if (isVideo) {
    pill = downloaded ? (
      <button
        type="button"
        onClick={open}
        aria-label={`Play ${attachment.name}`}
        className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white"
      >
        <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
      </button>
    ) : (
      <CenterPill label={`Play ${attachment.name}, ${formatBytes(attachment.size)}`} onClick={open}>
        <Play className="size-4 fill-current" aria-hidden="true" /> {formatBytes(attachment.size)}
      </CenterPill>
    );
  } else if (loadingFull && !downloaded) {
    pill = (
      <CenterPill>
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {formatBytes(attachment.size)}
      </CenterPill>
    );
  } else if (!fullUrl && (!downloaded || full.failed)) {
    pill = (
      <CenterPill label={`Download ${attachment.name}, ${formatBytes(attachment.size)}`} onClick={() => setWantFull(true)}>
        <Download className="size-4" aria-hidden="true" /> {formatBytes(attachment.size)}
      </CenterPill>
    );
  }

  return (
    <>
      <div
        className="group/media relative overflow-hidden rounded-xl bg-muted"
        style={{ width, maxWidth: "100%", aspectRatio: `${Math.max(0.6, Math.min(ratio, 1.9))}` }}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={attachment.name}
            className={cn("size-full object-cover", pending ? "cursor-default" : isVideo ? "cursor-pointer" : "cursor-zoom-in")}
            onClick={open}
          />
        ) : isVideo && attachment.localUrl ? (
          <video
            src={attachment.localUrl}
            muted
            preload="metadata"
            className={cn("size-full object-cover", !pending && "cursor-pointer")}
            onClick={open}
            aria-label={attachment.name}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            {thumb.failed || (!attachment.has_thumb && !wantFull) ? (
              <span className="px-3 text-center text-xs">{isVideo ? "Video" : "Preview not available"}</span>
            ) : (
              <Loader2 className="size-5 animate-spin" aria-label="Loading preview" />
            )}
          </span>
        )}

        {pill ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="pointer-events-auto">{pill}</span>
          </span>
        ) : null}

        {isVideo && length ? (
          <span className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow">
            <Video className="size-3.5" aria-hidden="true" /> {length}
          </span>
        ) : null}

        {!pending && state === "sent" && (fullUrl || isVideo) ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={download}
            disabled={saving}
            aria-label={`Save ${attachment.name}`}
            className="absolute top-1.5 right-1.5 bg-black/55 text-white opacity-0 transition-opacity group-hover/media:opacity-100 hover:bg-black/75 hover:text-white focus-visible:opacity-100"
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          </Button>
        ) : null}
      </div>

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="flex max-h-[92vh] w-auto max-w-[92vw] flex-col items-center gap-3 bg-card p-3 sm:max-w-[92vw]">
          <DialogTitle className="sr-only">{attachment.name}</DialogTitle>
          {fullUrl ? (
            isVideo ? (
              <video
                src={fullUrl}
                controls
                autoPlay
                playsInline
                className="max-h-[78vh] max-w-full rounded-lg bg-black"
                aria-label={attachment.name}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fullUrl} alt={attachment.name} className="max-h-[78vh] max-w-full rounded-lg object-contain" />
            )
          ) : full.failed ? (
            <span className="flex h-60 w-80 max-w-full items-center justify-center text-sm text-muted-foreground">
              Could not load this {isVideo ? "video" : "photo"}.
            </span>
          ) : (
            <span className="flex h-60 w-80 max-w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              <span role="status">Loading {formatBytes(attachment.size)}…</span>
            </span>
          )}
          <div className="flex w-full items-center justify-between gap-3">
            <span className="truncate text-sm text-muted-foreground">
              {attachment.name} · {formatBytes(attachment.size)}
            </span>
            <Button type="button" size="sm" onClick={download} disabled={saving || !fullUrl}>
              <Download className="size-4" aria-hidden="true" /> Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FileCard({ attachment, mine, state }: { attachment: ChatAttachment; mine: boolean; state: UploadState }) {
  const pending = attachment.id.startsWith("local-");
  // Like photos: downloaded into the chat first (decrypted here), then opened or saved.
  // Your own files, and ones downloaded before in this browser, count as downloaded.
  const [downloaded, setDownloaded] = useState(() => mine || Boolean(attachment.localUrl) || wasDownloaded(attachment.id));
  const [busy, setBusy] = useState<"download" | "open" | "save" | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(action: "download" | "open" | "save") {
    setBusy(action);
    setFailed(false);
    try {
      if (action === "download") {
        await fileUrl(attachment);
        markDownloaded(attachment.id);
        setDownloaded(true);
      } else if (action === "open") {
        await openFile(attachment);
      } else {
        await saveFile(attachment);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const muted = mine ? "text-blue-100" : "text-muted-foreground";
  const actionClass = cn(
    "h-7 px-2 text-xs font-semibold",
    mine ? "text-white hover:bg-white/15 hover:text-white" : "text-[#0d47a1] hover:bg-[#0d47a1]/8 dark:text-[#38bdf8] dark:hover:bg-[#38bdf8]/10",
  );

  return (
    <div className={cn("w-64 max-w-full rounded-lg border", mine ? "border-white/25 bg-white/10" : "border-border bg-card")}>
      <div className="flex items-center gap-3 p-2.5">
        <FileText className={cn("size-6 shrink-0", muted)} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", mine ? "text-white" : "text-foreground")} title={attachment.name}>
            {attachment.name}
          </span>
          <span className={cn("block text-xs", failed ? "text-destructive-text" : muted)}>
            {state === "failed"
              ? "Not sent"
              : pending
                ? "Encrypting and uploading…"
                : failed
                  ? "Could not get the file. Try again."
                  : busy === "download"
                    ? `Downloading… ${formatBytes(attachment.size)}`
                    : formatBytes(attachment.size)}
          </span>
        </span>
        {!pending && !downloaded ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void run("download")}
            disabled={busy !== null}
            aria-label={`Download ${attachment.name}, ${formatBytes(attachment.size)}`}
            className={mine ? "text-blue-100 hover:bg-white/15 hover:text-white" : undefined}
          >
            {busy === "download" ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
          </Button>
        ) : pending && state === "sending" ? (
          <Loader2 className={cn("size-4 animate-spin", muted)} aria-label="Uploading" />
        ) : null}
      </div>
      {!pending && downloaded ? (
        <div className={cn("flex border-t", mine ? "border-white/20" : "border-border")}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void run("open")}
            disabled={busy !== null}
            aria-label={`Open ${attachment.name}`}
            className={cn(actionClass, "flex-1 rounded-none rounded-bl-lg")}
          >
            {busy === "open" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ExternalLink className="size-3.5" aria-hidden="true" />}
            Open
          </Button>
          <span className={cn("w-px", mine ? "bg-white/20" : "bg-border")} aria-hidden="true" />
          <Button
            type="button"
            variant="ghost"
            onClick={() => void run("save")}
            disabled={busy !== null}
            aria-label={`Save ${attachment.name}`}
            className={cn(actionClass, "flex-1 rounded-none rounded-br-lg")}
          >
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A recorded voice note (as opposed to an audio file someone attached). */
export function isVoice(attachment: ChatAttachment) {
  return Boolean(attachment.voice);
}

const SPEEDS = [1, 1.5, 2] as const;
const VOICE_PLAY_EVENT = "portal-chat-voice-play";

/**
 * Play, pause, seek and speed for a voice note. The audio is downloaded and
 * decrypted on the first play (the sender's own copy is already here). Only
 * one voice note plays at a time.
 */
export function VoiceNote({
  attachment,
  mine,
  state,
  compact = false,
}: {
  attachment: ChatAttachment;
  mine: boolean;
  state: UploadState;
  /** The composer's preview before sending. */
  compact?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(attachment.localUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const pending = attachment.id.startsWith("local-");
  const duration = attachment.duration && Number.isFinite(attachment.duration) ? attachment.duration : 0;
  const bars = attachment.waveform?.length ? attachment.waveform : Array.from({ length: 48 }, () => 30);
  const progress = duration ? Math.min(1, position / duration) : 0;

  // Pause when another voice note starts.
  useEffect(() => {
    const onOtherPlay = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== attachment.id) audioRef.current?.pause();
    };
    window.addEventListener(VOICE_PLAY_EVENT, onOtherPlay);
    return () => window.removeEventListener(VOICE_PLAY_EVENT, onOtherPlay);
  }, [attachment.id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, url]);

  async function source() {
    if (url) return url;
    setLoading(true);
    setFailed(false);
    try {
      const decrypted = await decryptedUrl(attachment.id, "file", attachment.file_key, attachment.mime);
      setUrl(decrypted);
      return decrypted;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    const src = await source();
    if (!src) return;
    if (audio.src !== src) audio.src = src;
    audio.playbackRate = speed;
    window.dispatchEvent(new CustomEvent(VOICE_PLAY_EVENT, { detail: attachment.id }));
    try {
      await audio.play();
    } catch {
      setFailed(true);
    }
  }

  async function seek(seconds: number) {
    const audio = audioRef.current;
    setPosition(seconds);
    if (!audio) return;
    if (!audio.src) {
      const src = await source();
      if (!src) return;
      audio.src = src;
    }
    audio.currentTime = seconds;
  }

  const played = mine ? "bg-white" : "bg-[#0d47a1] dark:bg-[#38bdf8]";
  const unplayed = mine ? "bg-white/40" : "bg-foreground/25";
  const label = state === "failed" ? "Not sent" : pending || state === "sending" ? "Sending" : null;

  return (
    <div className={cn("flex items-center gap-2.5", compact ? "w-full max-w-md" : "w-64 max-w-full py-0.5")}>
      {/* The element has no src until the first play, so nothing downloads early. */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => {
          if (url) setFailed(true);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={loading}
        aria-label={playing ? "Pause voice message" : `Play voice message, ${formatDuration(duration)}`}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          mine
            ? "bg-white text-[#0d47a1] hover:bg-blue-50 focus-visible:outline-white"
            : "bg-[#0d47a1] text-white hover:bg-[#0a3880] focus-visible:outline-[#0d47a1] dark:bg-[#38bdf8] dark:text-[#0b1120]",
        )}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Play className="ml-0.5 size-4 fill-current" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="relative h-7">
          <div className="flex h-full items-center justify-between gap-px" aria-hidden="true">
            {bars.map((value, index) => (
              <span
                key={index}
                className={cn("w-[3px] shrink-0 rounded-full", index / bars.length < progress ? played : unplayed)}
                style={{ height: `${Math.max(12, value)}%` }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration || 1)}
            onChange={(event) => void seek(Number(event.target.value))}
            disabled={!duration || pending}
            aria-label="Position in voice message"
            aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`}
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>
        <div className={cn("mt-0.5 flex items-center justify-between text-[11px]", mine ? "text-blue-100" : "text-muted-foreground")}>
          <span className="tabular-nums">
            {failed ? "Could not play" : label ?? (playing || position ? formatDuration(position) : formatDuration(duration))}
          </span>
          {!compact ? (
            <button
              type="button"
              onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
              aria-label={`Playback speed ${speed} times. Change speed`}
              className={cn(
                "rounded-full px-1.5 py-px font-semibold tabular-nums transition-colors",
                mine ? "bg-white/15 hover:bg-white/25" : "bg-foreground/10 hover:bg-foreground/15",
              )}
            >
              {speed}×
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
