"use client";

import { ExternalLink, Globe, X } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A preview kept (encrypted) inside the message: what the sender's browser got for the link. */
export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  site_name: string;
  /** A small JPEG made by the server, as a data URL. */
  image: string | null;
};

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Punctuation that usually ends a sentence rather than the link.
const TRAILING = /[.,!?;:'"”’)\]]+$/;

function trimLink(raw: string) {
  let link = raw;
  const trailing = link.match(TRAILING)?.[0] ?? "";
  if (trailing) {
    link = link.slice(0, -trailing.length);
    // Keep a closing bracket that belongs to the link, e.g. Wikipedia's "(disambiguation)".
    if (trailing.startsWith(")") && (link.match(/\(/g)?.length ?? 0) > (link.match(/\)/g)?.length ?? 0)) link += ")";
  }
  return link;
}

/** A link as it can be opened: https added to "www." links, and only http(s). */
export function safeHref(link: string): string | null {
  const candidate = link.startsWith("www.") ? `https://${link}` : link;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The first link in a text, ready to fetch a preview for. */
export function firstLink(text: string): string | null {
  for (const match of text.matchAll(URL_PATTERN)) {
    const href = safeHref(trimLink(match[0]));
    if (href) return href;
  }
  return null;
}

export function openLink(href: string) {
  // noopener: the opened site cannot reach back into the portal tab.
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Text with its links made clickable (they open in a new tab). */
export function Linkified({ text, mine }: { text: string; mine: boolean }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const link = trimLink(match[0]);
    const href = safeHref(link);
    if (!href) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={cn(
          "break-all underline underline-offset-2",
          mine ? "text-white decoration-white/60 hover:decoration-white" : "text-[#0d47a1] decoration-[#0d47a1]/40 hover:decoration-[#0d47a1] dark:text-[#38bdf8] dark:decoration-[#38bdf8]/40",
        )}
      >
        {link}
      </a>,
    );
    last = start + link.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

/** Only what a preview may contain: http(s) link, a small JPEG data URL, short texts. */
export function cleanPreview(value: unknown): LinkPreview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const href = typeof v.url === "string" ? safeHref(v.url) : null;
  if (!href) return null;
  const text = (x: unknown, limit: number) => (typeof x === "string" ? x.slice(0, limit) : "");
  const image =
    typeof v.image === "string" && v.image.startsWith("data:image/jpeg;base64,") && v.image.length < 120_000 ? v.image : null;
  const preview = {
    url: href,
    title: text(v.title, 200),
    description: text(v.description, 300),
    site_name: text(v.site_name, 80),
    image,
  };
  return preview.title || preview.description ? preview : null;
}

function hostOf(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** The preview card in a message, or above the message box while writing. */
export function LinkPreviewCard({
  preview,
  mine,
  onRemove,
}: {
  preview: LinkPreview;
  mine: boolean;
  /** While writing: drop the preview from this message. */
  onRemove?: () => void;
}) {
  const site = preview.site_name || hostOf(preview.url);
  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-lg border",
        mine ? "border-white/25 bg-white/10" : "border-border bg-background/70",
      )}
    >
      {preview.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview.image} alt="" className="size-20 shrink-0 object-cover sm:size-24" />
      ) : (
        <span className={cn("flex size-20 shrink-0 items-center justify-center sm:size-24", mine ? "bg-white/10" : "bg-muted")} aria-hidden="true">
          <Globe className={cn("size-6", mine ? "text-blue-100" : "text-muted-foreground")} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5">
        <span className={cn("truncate text-[11px] font-semibold tracking-wide uppercase", mine ? "text-blue-100" : "text-muted-foreground")}>
          {site}
        </span>
        {preview.title ? (
          <span className={cn("line-clamp-2 text-sm leading-snug font-semibold", mine ? "text-white" : "text-foreground")}>
            {preview.title}
          </span>
        ) : null}
        {preview.description ? (
          <span className={cn("line-clamp-2 text-xs", mine ? "text-blue-100" : "text-muted-foreground")}>{preview.description}</span>
        ) : null}
        {!onRemove ? (
          <button
            type="button"
            onClick={() => openLink(preview.url)}
            className={cn(
              "mt-1 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors focus-visible:outline-2",
              mine
                ? "bg-white/15 text-white hover:bg-white/25 focus-visible:outline-white"
                : "bg-[#0d47a1]/8 text-[#0d47a1] hover:bg-[#0d47a1]/14 focus-visible:outline-[#0d47a1] dark:bg-[#38bdf8]/12 dark:text-[#38bdf8]",
            )}
            aria-label={`Open ${site} in a new tab`}
          >
            <ExternalLink className="size-3" aria-hidden="true" /> Open
          </button>
        ) : null}
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Don't show a preview"
          title="Don't show a preview"
          className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
