"use client";

import { AlertCircle, Download, FileText, Loader2, Play, Video } from "lucide-react";
import { useEffect, useState } from "react";

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
import { cn } from "@/lib/utils";

/** Photos and playable videos show as media tiles; everything else as a file card. */
export function isMedia(attachment: ChatAttachment) {
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

async function saveFile(attachment: ChatAttachment) {
  const url = attachment.localUrl ?? (await decryptedUrl(attachment.id, "file", attachment.file_key, attachment.mime));
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  const [saving, setSaving] = useState(false);
  const pending = attachment.id.startsWith("local-");

  async function download() {
    setSaving(true);
    try {
      await saveFile(attachment);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={cn(
        "flex w-64 max-w-full items-center gap-3 rounded-lg border p-2.5",
        mine ? "border-white/25 bg-white/10" : "border-border bg-card",
      )}
    >
      <FileText className={cn("size-6 shrink-0", mine ? "text-blue-100" : "text-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium", mine ? "text-white" : "text-foreground")}>{attachment.name}</span>
        <span className={cn("block text-xs", mine ? "text-blue-100" : "text-muted-foreground")}>
          {state === "failed" ? "Not sent" : pending ? "Encrypting and uploading…" : formatBytes(attachment.size)}
        </span>
      </span>
      {!pending ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={download}
          disabled={saving}
          aria-label={`Download ${attachment.name}`}
          className={mine ? "text-blue-100 hover:bg-white/15 hover:text-white" : undefined}
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
        </Button>
      ) : state === "sending" ? (
        <Loader2 className={cn("size-4 animate-spin", mine ? "text-blue-100" : "text-muted-foreground")} aria-label="Uploading" />
      ) : null}
    </div>
  );
}
