"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Info,
  Forward,
  Loader2,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Reply,
  SendHorizontal,
  SmilePlus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { FileCard, isMedia, isVoice, MediaTile, VoiceNote } from "@/components/chat/attachment-view";
import {
  messageSummary,
  systemText,
  useChat,
  type ChatConversation,
  type ChatMessage,
} from "@/components/chat/chat-provider";
import { ForwardDialog } from "@/components/chat/forward-dialog";
import { ReactionChips, ReactionPicker, type MessageAction } from "@/components/chat/reactions";
import { Avatar, typingLabel } from "@/components/chat/conversation-list";
import { GroupInfoDialog } from "@/components/chat/group-info-dialog";
import { MessageInfoDialog } from "@/components/chat/message-info-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fileTooLarge, formatBytes } from "@/lib/chat/media";
import {
  canRecordVoice,
  formatDuration,
  VOICE_MAX_SECONDS,
  VoiceRecorder,
  type VoiceRecording,
} from "@/lib/chat/voice";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const MAX_FILES = 10;

/** A steady colour per person for names in groups, readable on the bubble in both themes. */
const NAME_COLOURS = [
  "text-blue-700 dark:text-blue-300",
  "text-amber-700 dark:text-amber-300",
  "text-emerald-700 dark:text-emerald-300",
  "text-violet-700 dark:text-violet-300",
  "text-rose-700 dark:text-rose-300",
  "text-cyan-700 dark:text-cyan-300",
  "text-lime-700 dark:text-lime-300",
  "text-fuchsia-700 dark:text-fuchsia-300",
];
function senderColor(id: number) {
  return NAME_COLOURS[Math.abs(id) % NAME_COLOURS.length];
}

// From this many forwards on, the label says "Forwarded many times".
const FORWARDED_MANY = 5;

function withinWindow(message: ChatMessage) {
  return Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function lastSeenLabel(iso: string | null) {
  if (!iso) return "Offline";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) return `Last seen today at ${clock(iso)}`;
  return `Last seen ${date.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

export function MessageThread({
  conversation,
  onBack,
  backOnPhonesOnly = false,
  compact = false,
}: {
  conversation: ChatConversation;
  onBack?: () => void;
  /** On the full page the list is beside the thread from tablet width up. */
  backOnPhonesOnly?: boolean;
  compact?: boolean;
}) {
  const { threads, loadThread, typing, typingPeople, markSeen, setViewing, userId, findMessage } = useChat();
  const [infoOpen, setInfoOpen] = useState(false);
  const isGroup = conversation.isGroup;
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const thread = threads[conversation.id];
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const previousHeight = useRef(0);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const other = conversation.other;
  const readOnly = Boolean(other && !other.is_active);
  // Invited, not yet set up: the thread shows the invitation, nothing can be sent.
  const waiting = Boolean(other && other.is_active && !other.chat_ready);

  useEffect(() => {
    void loadThread(conversation.id);
  }, [conversation.id, loadThread]);

  useEffect(() => {
    setViewing(conversation.id, true);
    return () => setViewing(conversation.id, false);
  }, [conversation.id, setViewing]);

  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const newestSeq = useMemo(
    () => messages.reduce((top, m) => (m.state === "sent" || m.state === "unreadable" ? Math.max(top, m.seq) : top), 0),
    [messages],
  );

  // Mark read while the thread is on screen and the tab is visible.
  useEffect(() => {
    const seen = () => {
      if (document.visibilityState === "visible") markSeen(conversation.id, newestSeq);
    };
    seen();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [conversation.id, markSeen, newestSeq]);

  // Keep the view pinned to the newest message unless the reader scrolled up;
  // keep the position steady when older messages are added above.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (previousHeight.current && list.scrollTop < 40 && !stickToBottom.current) {
      list.scrollTop = list.scrollHeight - previousHeight.current;
    } else if (stickToBottom.current) {
      list.scrollTop = list.scrollHeight;
    }
    previousHeight.current = list.scrollHeight;
  }, [messages]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (list.scrollTop < 40 && thread?.hasMore && !thread.loading) {
      previousHeight.current = list.scrollHeight;
      void loadThread(conversation.id, true);
    }
  }

  // Seen: by the other person, or in a group by everyone else who can read it.
  const readers = conversation.members.filter((m) => m.id !== userId && !m.pending);
  const otherRead = readers.length ? Math.min(...readers.map((m) => m.last_read_seq)) : 0;

  /** Scroll to a quoted message, loading older pages first if it is not on screen yet. */
  async function jumpTo(messageId: string) {
    const show = () => {
      const target = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);
      if (!target) return false;
      stickToBottom.current = false;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      setHighlighted(messageId);
      window.setTimeout(() => setHighlighted((current) => (current === messageId ? null : current)), 1800);
      return true;
    };
    if (show()) return;
    stickToBottom.current = false;
    toast.loading("Finding the message…", { id: "chat-jump" });
    const found = await findMessage(conversation.id, messageId);
    toast.dismiss("chat-jump");
    if (!found) {
      toast.info("That message is no longer available.");
      return;
    }
    // Let the older messages render before scrolling to one.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => void show()));
  }

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const senderOf = (senderId: number | null) => {
    const person = conversation.participants.find((p) => p.id === senderId);
    return { name: person?.name || (senderId === userId ? "You" : (other?.name ?? "")), avatarUrl: person?.avatar_url };
  };
  const typingText = typingLabel(conversation, Boolean(typing[conversation.id]), typingPeople[conversation.id]);
  const isTyping = Boolean(typingText);
  const name = conversation.title;
  const nameOf = (id: number) => (id === userId ? "You" : (conversation.participants.find((p) => p.id === id)?.name ?? "Someone"));
  const onlineCount = conversation.members.filter((m) => m.id !== userId && m.online).length;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Chat with ${name}`}>
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to conversations"
            className={backOnPhonesOnly ? "md:hidden" : undefined}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        ) : null}
        {isGroup ? (
          // The whole header opens the group info, like other chat apps.
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-[#0d47a1]"
            aria-label={`${name}, group info`}
          >
            <Avatar name={name} src={conversation.photoUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
              <span className={cn("block truncate text-xs", isTyping ? "text-success-text" : "text-muted-foreground")} aria-live="polite">
                {typingText ??
                  `${conversation.members.length} members${onlineCount ? ` · ${onlineCount} online` : ""}`}
              </span>
            </span>
          </button>
        ) : (
          <>
            <Avatar name={name} src={conversation.photoUrl} online={other?.online} size="sm" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-foreground">{name}</h2>
              <p className={cn("truncate text-xs", isTyping ? "text-success-text" : "text-muted-foreground")} aria-live="polite">
                {readOnly
                  ? "No longer has access to the portal"
                  : waiting
                    ? "Invited · has not set up chat yet"
                    : isTyping
                      ? typingText
                      : other?.online
                        ? "Online"
                        : lastSeenLabel(other?.last_seen_at ?? null)}
              </p>
            </div>
          </>
        )}
      </header>
      {isGroup ? <GroupInfoDialog conversation={conversation} open={infoOpen} onOpenChange={setInfoOpen} /> : null}

      <div
        ref={listRef}
        onScroll={onScroll}
        className={cn("min-h-0 flex-1 overflow-y-auto", compact ? "px-3 py-3" : "px-4 py-4 sm:px-6")}
      >
        {thread?.loading && !messages.length ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading messages…
          </p>
        ) : null}
        {thread?.hasMore ? (
          <div className="flex justify-center pb-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadThread(conversation.id, true)} disabled={thread.loading}>
              {thread.loading ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        ) : null}
        {thread?.loaded && !messages.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Messages here are end-to-end encrypted. Say hello to {name.split(" ")[0]}.
          </p>
        ) : null}

        <div role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-1">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
            const grouped =
              !newDay &&
              previous &&
              previous.senderId === message.senderId &&
              previous.kind !== "system" &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;
            return (
              <div key={message.id}>
                {newDay ? (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium text-muted-foreground">
                      {dayLabel(message.createdAt)}
                    </span>
                  </div>
                ) : null}
                <MessageBubble
                  conversation={conversation}
                  nameOf={nameOf}
                  showSenderName={isGroup && message.senderId !== userId && !grouped}
                  sender={senderOf(message.senderId)}
                  message={message}
                  highlighted={highlighted === message.id}
                  onJump={(id) => void jumpTo(id)}
                  mine={message.senderId === userId}
                  grouped={Boolean(grouped)}
                  repliedTo={message.replyTo ? byId.get(message.replyTo) ?? null : null}
                  seen={message.state === "sent" && message.seq <= otherRead}
                  canAct={!readOnly}
                  onReply={() => {
                    setEditing(null);
                    setReplyTo(message);
                  }}
                  onEdit={() => {
                    setReplyTo(null);
                    setEditing(message);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {readOnly ? (
        <p className="border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">
          {name} no longer has access to the portal. You can read this conversation but not send new messages.
        </p>
      ) : waiting && other ? (
        <WaitingForInvite personId={other.id} name={name} />
      ) : (
        <Composer
          conversationId={conversation.id}
          replyTo={replyTo}
          editing={editing}
          otherName={name}
          nameOf={nameOf}
          onClearReply={() => setReplyTo(null)}
          onClearEdit={() => setEditing(null)}
          onSent={() => {
            stickToBottom.current = true;
          }}
        />
      )}
    </section>
  );
}

function MessageBubble({
  message,
  highlighted,
  onJump,
  mine,
  grouped,
  repliedTo,
  seen,
  canAct,
  onReply,
  onEdit,
  sender,
  conversation,
  nameOf,
  showSenderName,
}: {
  conversation: ChatConversation;
  /** "You", or the person's name. */
  nameOf: (id: number) => string;
  /** Groups: the sender's name above the first of their messages in a row. */
  showSenderName: boolean;
  /** Who sent it: shown as a small picture (or initials) beside the bubble. */
  sender: { name: string; avatarUrl: string | null | undefined };
  message: ChatMessage;
  highlighted: boolean;
  onJump: (messageId: string) => void;
  mine: boolean;
  grouped: boolean;
  repliedTo: ChatMessage | null;
  seen: boolean;
  canAct: boolean;
  onReply: () => void;
  onEdit: () => void;
}) {
  const { deleteForEveryone, deleteForMe, retry, react, userId } = useChat();
  const [busy, setBusy] = useState(false);
  // The panel above the message: just reactions (smile button), or reactions
  // with the message actions (right-click, or press and hold on a phone).
  const [panel, setPanel] = useState<"react" | "menu" | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  // "React" in the menu opens the reactions once the menu has fully closed,
  // so the menu handing focus back does not close them straight away.
  const reactAfterMenu = useRef(false);

  if (message.kind === "system") {
    return (
      <div className="my-3 flex justify-center">
        <p className="inline-flex max-w-[90%] items-center gap-2 rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          <span>{systemText(message, userId, nameOf)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
        </p>
      </div>
    );
  }

  const media = message.attachments.filter(isMedia);
  const voices = message.attachments.filter(isVoice);
  const files = message.attachments.filter((a) => !isMedia(a) && !isVoice(a));
  const hasMedia = media.length > 0 && message.state !== "unreadable";
  const uploadState = message.state === "failed" ? "failed" : message.state === "sending" ? "sending" : "sent";

  const canChange = mine && message.state === "sent" && !message.deleted && withinWindow(message);
  // A voice note has no text to edit (it can still be deleted).
  const canEdit = canChange && !voices.length;
  const failed = message.state === "failed";
  const canReact = canAct && message.state === "sent" && !message.deleted;
  // Forwarding out of a chat works even when it is read-only.
  const canForward = message.state === "sent" && !message.deleted;
  const myReaction = message.reactions.find((r) => r.userId === userId)?.emoji ?? null;

  function toggleReaction(emoji: string | null) {
    react(message, emoji).catch((error) => toast.error(extractApiErrorMessage(error, "Could not react to the message.")));
  }

  // A long press on a phone opens the reactions, like other chat apps.
  function pressStart(event: React.PointerEvent) {
    if (event.pointerType !== "touch" || message.state !== "sent") return;
    pressTimer.current = window.setTimeout(() => setPanel("menu"), 450);
  }
  function pressEnd() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  // The quote: the original if it is loaded, otherwise the preview kept in the reply.
  const quoteSender = repliedTo ? repliedTo.senderId : message.replyPreview?.senderId;
  const quoteText = repliedTo
    ? repliedTo.deleted
      ? "This message was deleted"
      : messageSummary(repliedTo)
    : (message.replyPreview?.text ?? "Tap to see the original message");
  const quoteWho = quoteSender == null ? "Original message" : nameOf(quoteSender);

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, failure));
    } finally {
      setBusy(false);
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.text);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  }

  // The same actions as the ⋯ menu, for the right-click / press-and-hold panel.
  const actions: MessageAction[] = [
    ...(canAct && !message.deleted ? [{ label: "Reply", icon: Reply, onSelect: onReply }] : []),
    ...(message.text && !message.deleted ? [{ label: "Copy text", icon: Copy, onSelect: () => void copyText() }] : []),
    ...(canForward ? [{ label: "Forward", icon: Forward, onSelect: () => setForwarding(true) }] : []),
    ...(conversation.isGroup && mine && message.state === "sent" && !message.deleted
      ? [{ label: "Message info", icon: Info, onSelect: () => setInfoOpen(true) }]
      : []),
    ...(canEdit && canAct ? [{ label: "Edit", icon: Pencil, onSelect: onEdit }] : []),
    { label: "Delete for me", icon: Trash2, onSelect: () => void run(() => deleteForMe(message), "Could not delete the message.") },
    ...(canChange
      ? [
          {
            label: "Delete for everyone",
            icon: Trash2,
            destructive: true,
            onSelect: () => void run(() => deleteForEveryone(message), "Could not delete the message."),
          },
        ]
      : []),
  ];

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group -mx-2 flex rounded-xl px-2 transition-colors duration-700",
        mine ? "justify-end" : "justify-start",
        grouped ? "mt-0.5" : "mt-3",
        highlighted && "bg-[#0d47a1]/10 duration-150 dark:bg-[#38bdf8]/12",
      )}
    >
      <div className={cn("flex max-w-[85%] min-w-0 flex-col sm:max-w-[70%]", mine ? "items-end" : "items-start")}>
        {/* Picture, bubble and its buttons share one row, so the buttons stay level with the bubble's bottom. */}
        <div className={cn("flex max-w-full min-w-0 items-end gap-1.5", mine && "flex-row-reverse")}>
          <span className="mb-0.5 shrink-0" title={mine ? "You" : sender.name}>
            <Avatar name={sender.name} src={sender.avatarUrl} size="xs" />
          </span>
          <ReactionPicker
            open={panel !== null}
            onOpenChange={(open) => setPanel(open ? (panel ?? "react") : null)}
            mine={myReaction}
            onPick={canReact ? toggleReaction : undefined}
            actions={panel === "menu" ? actions : undefined}
            align={mine ? "end" : "start"}
          >
<div
              onPointerDown={pressStart}
              onPointerUp={pressEnd}
              onPointerLeave={pressEnd}
              onPointerCancel={pressEnd}
              onContextMenu={(event) => {
                // Keep the browser menu when text is selected, so it can be copied.
                if (message.state !== "sent" || window.getSelection()?.toString()) return;
                event.preventDefault();
                pressEnd();
                setPanel("menu");
              }}
              className={cn(
                "min-w-0 rounded-2xl text-sm select-text",
                hasMedia && !message.deleted ? "p-1" : "px-3 py-2",
                message.deleted || message.state === "unreadable"
                  ? "border border-dashed border-border bg-transparent text-muted-foreground"
                  : mine
                    ? "bg-[#0d47a1] text-white"
                    : "bg-muted text-foreground",
                failed && "ring-2 ring-destructive/60",
              )}
            >
              {message.deleted ? (
                <p className="italic">This message was deleted</p>
              ) : message.state === "unreadable" ? (
                <p className="italic">This message is not available.</p>
              ) : (
                <>
                  {showSenderName ? (
                    <p className={cn("mb-0.5 truncate text-xs font-semibold", senderColor(message.senderId ?? 0), hasMedia && "px-2 pt-1")}>
                      {sender.name}
                    </p>
                  ) : null}
                  {message.forwarded ? (
                    <p
                      className={cn(
                        "mb-1 flex items-center gap-1 text-[11px] italic",
                        hasMedia && "px-2 pt-1",
                        mine ? "text-blue-100" : "text-muted-foreground",
                      )}
                    >
                      <Forward className="size-3 shrink-0" aria-hidden="true" />
                      {message.forwarded >= FORWARDED_MANY ? "Forwarded many times" : "Forwarded"}
                    </p>
                  ) : null}
                  {message.replyTo ? (
                    <button
                      type="button"
                      onClick={() => onJump(message.replyTo!)}
                      aria-label={`Replying to ${quoteWho}: ${quoteText}. Go to the original message`}
                      className={cn(
                        "mb-1.5 block w-full min-w-0 rounded-lg border-l-2 px-2 py-1 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1",
                        hasMedia && "mx-1 mt-1 w-[calc(100%-0.5rem)]",
                        mine
                          ? "border-white/60 bg-white/10 text-blue-100 hover:bg-white/20 focus-visible:outline-white"
                          : "border-[#0d47a1] bg-background/60 text-muted-foreground hover:bg-background focus-visible:outline-[#0d47a1] dark:border-[#38bdf8]",
                      )}
                    >
                      <span className="block font-semibold">{quoteWho}</span>
                      <span className="line-clamp-2">{quoteText}</span>
                    </button>
                  ) : null}
                  {media.length ? (
                    <div className="flex flex-col gap-1">
                      {media.map((attachment) => (
                        <MediaTile key={attachment.id} attachment={attachment} mine={mine} state={uploadState} />
                      ))}
                    </div>
                  ) : null}
                  {voices.length ? (
                    <div className="flex flex-col gap-2">
                      {voices.map((attachment) => (
                        <VoiceNote key={attachment.id} attachment={attachment} mine={mine} state={uploadState} />
                      ))}
                    </div>
                  ) : null}
                  {files.length ? (
                    <div className={cn("flex flex-col gap-2", hasMedia ? "m-1 mt-2" : "mb-1")}>
                      {files.map((attachment) => (
                        <FileCard key={attachment.id} attachment={attachment} mine={mine} state={uploadState} />
                      ))}
                    </div>
                  ) : null}
                  {message.text ? (
                    <p className={cn("break-words whitespace-pre-wrap", hasMedia && "px-2 pt-1.5")}>{message.text}</p>
                  ) : null}
                </>
              )}
              <p
                className={cn(
                  "mt-0.5 flex items-center justify-end gap-1 text-[11px]",
                  hasMedia && !message.deleted && "px-2 pb-1",
                  mine && !message.deleted ? "text-blue-100" : "text-muted-foreground",
                )}
              >
                {message.editedAt && !message.deleted ? <span>Edited ·</span> : null}
                <span>{clock(message.createdAt)}</span>
                {mine && !message.deleted ? (
                  message.state === "sending" ? (
                    <Clock className="size-3" aria-label="Sending" />
                  ) : failed ? (
                    <AlertCircle className="size-3" aria-label="Not sent" />
                  ) : seen ? (
                    <CheckCheck className="size-3.5" aria-label="Seen" />
                  ) : (
                    <Check className="size-3" aria-label="Sent" />
                  )
                ) : null}
              </p>
            </div>
          </ReactionPicker>

        {failed ? (
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => retry(message.conversationId, message.id), "Still could not send.")}
            >
              Retry
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => run(() => deleteForMe(message), "Could not remove it.")}>
              Remove
            </Button>
          </div>
        ) : message.state === "sent" ? (
          <div className={cn("flex items-center", mine && "flex-row-reverse")}>
            {canReact ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setPanel("react")}
                className="text-muted-foreground"
                aria-label="React"
              >
                <SmilePlus aria-hidden="true" />
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                  aria-label="Message options"
                  disabled={busy}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={mine ? "end" : "start"}
                onCloseAutoFocus={(event) => {
                  if (!reactAfterMenu.current) return;
                  reactAfterMenu.current = false;
                  event.preventDefault();
                  setPanel("react");
                }}
              >
                {canAct && !message.deleted ? (
                  <DropdownMenuItem onSelect={onReply}>
                    <Reply aria-hidden="true" /> Reply
                  </DropdownMenuItem>
                ) : null}
                {canForward ? (
                  <DropdownMenuItem onSelect={() => window.setTimeout(() => setForwarding(true), 0)}>
                    <Forward aria-hidden="true" /> Forward
                  </DropdownMenuItem>
                ) : null}
                {conversation.isGroup && mine && !message.deleted ? (
                  <DropdownMenuItem onSelect={() => window.setTimeout(() => setInfoOpen(true), 0)}>
                    <Info aria-hidden="true" /> Message info
                  </DropdownMenuItem>
                ) : null}
                {canReact ? (
                  // Opens the reactions after the menu closes (see onCloseAutoFocus).
                  <DropdownMenuItem
                    onSelect={() => {
                      reactAfterMenu.current = true;
                    }}
                  >
                    <SmilePlus aria-hidden="true" /> React
                  </DropdownMenuItem>
                ) : null}
                {message.text && !message.deleted ? (
                  <DropdownMenuItem onSelect={() => void copyText()}>
                    <Copy aria-hidden="true" /> Copy text
                  </DropdownMenuItem>
                ) : null}
                {canEdit && canAct ? (
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil aria-hidden="true" /> Edit
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => run(() => deleteForMe(message), "Could not delete the message.")}>
                  <Trash2 aria-hidden="true" /> Delete for me
                </DropdownMenuItem>
                {canChange ? (
                  <DropdownMenuItem
                    className="text-destructive-text focus:text-destructive-text"
                    onSelect={() => run(() => deleteForEveryone(message), "Could not delete the message.")}
                  >
                    <Trash2 aria-hidden="true" /> Delete for everyone
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        </div>
        <ReactionChips
          className={mine ? "mr-[30px]" : "ml-[30px]"}
          reactions={message.reactions}
          userId={userId}
          mine={mine}
          nameOf={nameOf}
          onToggle={(emoji) => toggleReaction(emoji)}
          disabled={!canReact}
        />
      </div>
      {forwarding ? <ForwardDialog message={message} open={forwarding} onOpenChange={setForwarding} /> : null}
      {infoOpen ? (
        <MessageInfoDialog
          conversation={conversation}
          message={message}
          userId={userId}
          open={infoOpen}
          onOpenChange={setInfoOpen}
        />
      ) : null}
    </div>
  );
}

function WaitingForInvite({ personId, name }: { personId: number; name: string }) {
  const { invite } = useChat();
  const [busy, setBusy] = useState(false);
  const first = name.split(" ")[0];

  async function remind() {
    setBusy(true);
    try {
      await invite(personId);
      toast.success(`${first} has been reminded.`);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Could not send the reminder."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 border-t border-border px-4 py-3 text-center sm:flex-row sm:justify-between sm:text-left">
      <p className="text-sm text-muted-foreground">
        {first} has not set up chat yet. You can send messages once they accept your invitation.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={remind} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Send a reminder
      </Button>
    </div>
  );
}

function Composer({
  conversationId,
  replyTo,
  editing,
  otherName,
  nameOf,
  onClearReply,
  onClearEdit,
  onSent,
}: {
  conversationId: string;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  otherName: string;
  nameOf: (id: number) => string;
  onClearReply: () => void;
  onClearEdit: () => void;
  onSent: () => void;
}) {
  const { send, edit, sendTyping, userId } = useChat();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [voice, setVoice] = useState<VoiceState>({ phase: "idle" });
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const reviewUrl = useRef<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    // Checked after mounting: the server render has no MediaRecorder.
    const timer = window.setTimeout(() => setVoiceSupported(canRecordVoice()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Leaving the conversation throws away a recording in progress.
  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      if (reviewUrl.current) URL.revokeObjectURL(reviewUrl.current);
    },
    [],
  );

  function sendVoice(recording: VoiceRecording) {
    reviewUrl.current = null; // now owned by the sent message
    const outgoing = {
      text: "",
      files: [recording.file],
      replyTo: replyTo?.id ?? null,
      voice: { duration: recording.duration, waveform: recording.waveform, url: recording.url },
    };
    setVoice({ phase: "idle" });
    onClearReply();
    onSent();
    send(conversationId, outgoing).catch((error) => {
      toast.error(extractApiErrorMessage(error, "The voice message was not sent. Use Retry to try again."));
    });
  }

  async function finishRecording(then: "review" | "send") {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    const recording = await recorder.stop();
    if (!recording) {
      setVoice({ phase: "idle" });
      toast.error("That recording was too short to send.");
      return;
    }
    if (then === "send") {
      sendVoice(recording);
    } else {
      reviewUrl.current = recording.url;
      setVoice({ phase: "review", recording });
    }
  }

  async function startRecording() {
    if (voice.phase !== "idle") return;
    setVoice({ phase: "starting" });
    const recorder = new VoiceRecorder(
      (level, seconds) =>
        setVoice((v) => (v.phase === "recording" ? { ...v, seconds, levels: [...v.levels.slice(-(LIVE_BARS - 1)), level] } : v)),
      () => {
        toast.info(`Voice messages can be up to ${VOICE_MAX_SECONDS / 60} minutes. Recording stopped; review it and send.`);
        void finishRecording("review");
      },
    );
    try {
      await recorder.start();
      recorderRef.current = recorder;
      setVoice({ phase: "recording", seconds: 0, levels: [] });
    } catch (error) {
      setVoice({ phase: "idle" });
      toast.error(error instanceof Error ? error.message : "Could not start recording.");
    }
  }

  function cancelRecording() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setVoice({ phase: "idle" });
    inputRef.current?.focus();
  }

  function discardReview() {
    if (reviewUrl.current) URL.revokeObjectURL(reviewUrl.current);
    reviewUrl.current = null;
    setVoice({ phase: "idle" });
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (editing) {
      setText(editing.text);
      setFiles([]);
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Grow with the text, up to about six lines.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [text]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const tooBig = list.filter(fileTooLarge);
    if (tooBig.length) {
      toast.error(`${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 25 MB.`);
    }
    setFiles((current) => {
      const next = [...current, ...list.filter((f) => !fileTooLarge(f))];
      if (next.length > MAX_FILES) toast.error(`Send up to ${MAX_FILES} files at a time.`);
      return next.slice(0, MAX_FILES);
    });
  }, []);

  async function submit() {
    const body = text.trim();
    if (busy) return;
    if (editing) {
      if (!body) return;
      if (!withinWindow(editing)) {
        toast.error("Messages can only be edited within 30 minutes of sending.");
        onClearEdit();
        return;
      }
      setBusy(true);
      try {
        await edit(editing, body);
        setText("");
        onClearEdit();
      } catch (error) {
        toast.error(extractApiErrorMessage(error, "Could not edit the message."));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!body && !files.length) return;
    const outgoing = { text: body, files, replyTo: replyTo?.id ?? null };
    setText("");
    setFiles([]);
    onClearReply();
    onSent();
    inputRef.current?.focus();
    // The message shows at once as "sending"; a failure leaves it with Retry.
    send(conversationId, outgoing).catch((error) => {
      toast.error(extractApiErrorMessage(error, "The message was not sent. Use Retry to try again."));
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && (editing || replyTo)) {
      event.stopPropagation();
      setText(editing ? "" : text);
      onClearEdit();
      onClearReply();
    }
  }

  return (
    <div
      className={cn("border-t border-border bg-card p-3", dragging && "ring-2 ring-inset ring-ring")}
      onDragOver={(e) => {
        if (editing) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!editing && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {editing || replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs">
          {editing ? <Pencil className="size-3.5 shrink-0" aria-hidden="true" /> : <Reply className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {editing ? (
              "Editing message"
            ) : (
              <>
                Replying to <span className="font-semibold text-foreground">{replyTo!.senderId === userId ? "yourself" : replyTo!.senderId != null ? nameOf(replyTo!.senderId) : otherName}</span>:{" "}
                {messageSummary(replyTo!)}
              </>
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              if (editing) setText("");
              onClearEdit();
              onClearReply();
            }}
            aria-label={editing ? "Cancel editing" : "Cancel reply"}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {files.length ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex max-w-56 items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-xs">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate text-foreground">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {voice.phase !== "idle" ? (
        <VoiceComposer
          voice={voice}
          onCancel={voice.phase === "review" ? discardReview : cancelRecording}
          onStop={() => void finishRecording("review")}
          onSend={() => (voice.phase === "review" ? sendVoice(voice.recording) : void finishRecording("send"))}
        />
      ) : (
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(editing)}
            aria-label="Attach files"
            title="Attach files (up to 25 MB each)"
          >
            <Paperclip aria-hidden="true" />
          </Button>
          <label htmlFor={`composer-${conversationId}`} className="sr-only">
            Message {otherName}
          </label>
          <textarea
            id={`composer-${conversationId}`}
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) sendTyping(conversationId);
            }}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              if (!editing && e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            placeholder={editing ? "Edit your message" : "Write a message"}
            className="max-h-40 min-h-9 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none"
          />
          {voiceSupported && !editing && !text.trim() && !files.length ? (
            <Button
              type="button"
              size="icon"
              onClick={() => void startRecording()}
              aria-label="Record a voice message"
              title="Record a voice message (up to 20 minutes)"
            >
              <Mic aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={() => void submit()}
              disabled={busy || (!text.trim() && !files.length)}
              aria-label={editing ? "Save edit" : "Send message"}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : editing ? <Check aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />}
            </Button>
          )}
        </div>
      )}
      <p className="mt-1.5 hidden text-[11px] text-muted-foreground sm:block">
        {voice.phase === "recording" || voice.phase === "starting"
          ? "Up to 20 minutes · Esc to cancel · End-to-end encrypted"
          : voice.phase === "review"
            ? "Play it back, then send or delete · End-to-end encrypted"
            : "Enter to send · Shift + Enter for a new line · End-to-end encrypted"}
      </p>
    </div>
  );
}

const LIVE_BARS = 40;

type VoiceState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording"; seconds: number; levels: number[] }
  | { phase: "review"; recording: VoiceRecording };

/** The composer row while recording a voice message, and while reviewing it before sending. */
function VoiceComposer({
  voice,
  onCancel,
  onStop,
  onSend,
}: {
  voice: Exclude<VoiceState, { phase: "idle" }>;
  onCancel: () => void;
  onStop: () => void;
  onSend: () => void;
}) {
  const recording = voice.phase === "recording" || voice.phase === "starting";
  const sendRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    sendRef.current?.focus();
  }, [voice.phase]);

  return (
    <div
      className="flex items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onCancel}
        aria-label={recording ? "Cancel recording" : "Delete recording"}
        className="text-destructive-text hover:text-destructive-text"
      >
        <Trash2 aria-hidden="true" />
      </Button>

      <div className="flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded-lg border border-input bg-background px-3 py-1.5">
        {voice.phase === "review" ? (
          <VoiceNote
            compact
            mine={false}
            state="sent"
            attachment={{
              id: "voice-review",
              name: voice.recording.file.name,
              mime: voice.recording.file.type,
              size: voice.recording.file.size,
              file_key: "",
              has_thumb: false,
              voice: true,
              duration: voice.recording.duration,
              waveform: voice.recording.waveform,
              localUrl: voice.recording.url,
            }}
          />
        ) : (
          <>
            <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-destructive-text motion-safe:animate-ping" />
              <span className="relative size-2.5 rounded-full bg-destructive-text" />
            </span>
            <span className="shrink-0 text-sm font-medium text-foreground tabular-nums" role="timer" aria-live="off">
              {voice.phase === "recording" ? formatDuration(voice.seconds) : "0:00"}
              <span className="sr-only"> recorded</span>
            </span>
            <span className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[2px] overflow-hidden" aria-hidden="true">
              {(voice.phase === "recording" ? voice.levels : []).map((level, index) => (
                <span
                  key={index}
                  className="w-[3px] shrink-0 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8]"
                  style={{ height: `${Math.max(12, Math.round(level * 100))}%` }}
                />
              ))}
            </span>
            <span className="sr-only" role="status">
              {voice.phase === "starting" ? "Starting the microphone" : "Recording a voice message"}
            </span>
          </>
        )}
      </div>

      {recording ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onStop}
          disabled={voice.phase === "starting"}
          aria-label="Stop and review"
          title="Stop and review"
        >
          <Square className="size-3.5 fill-current" aria-hidden="true" />
        </Button>
      ) : null}
      <Button
        ref={sendRef}
        type="button"
        size="icon"
        onClick={onSend}
        disabled={voice.phase === "starting"}
        aria-label="Send voice message"
      >
        <SendHorizontal aria-hidden="true" />
      </Button>
    </div>
  );
}
