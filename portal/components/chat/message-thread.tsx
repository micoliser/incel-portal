"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Reply,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { FileCard, isMedia, MediaTile } from "@/components/chat/attachment-view";
import { systemText, useChat, type ChatConversation, type ChatMessage } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fileTooLarge, formatBytes } from "@/lib/chat/media";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const MAX_FILES = 10;

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
  const { threads, loadThread, typing, markSeen, setViewing, userId } = useChat();
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

  const otherRead = other?.last_read_seq ?? 0;

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const isTyping = Boolean(typing[conversation.id]);
  const name = other?.name ?? "Conversation";

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
        <Avatar name={name} online={other?.online} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{name}</h2>
          <p className={cn("truncate text-xs", isTyping ? "text-success-text" : "text-muted-foreground")} aria-live="polite">
            {readOnly
              ? "No longer has access to the portal"
              : waiting
                ? "Invited · has not set up chat yet"
                : isTyping
                ? "Typing…"
                : other?.online
                  ? "Online"
                  : lastSeenLabel(other?.last_seen_at ?? null)}
          </p>
        </div>
      </header>

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
                  message={message}
                  mine={message.senderId === userId}
                  grouped={Boolean(grouped)}
                  repliedTo={message.replyTo ? byId.get(message.replyTo) ?? null : null}
                  seen={message.state === "sent" && message.seq <= otherRead}
                  otherName={name}
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
  mine,
  grouped,
  repliedTo,
  seen,
  otherName,
  canAct,
  onReply,
  onEdit,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  repliedTo: ChatMessage | null;
  seen: boolean;
  otherName: string;
  canAct: boolean;
  onReply: () => void;
  onEdit: () => void;
}) {
  const { deleteForEveryone, deleteForMe, retry, userId } = useChat();
  const [busy, setBusy] = useState(false);

  if (message.kind === "system") {
    return (
      <div className="my-3 flex justify-center">
        <p className="inline-flex max-w-[90%] items-center gap-2 rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
          <span>{systemText(message, userId)}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={message.createdAt}>{clock(message.createdAt)}</time>
        </p>
      </div>
    );
  }

  const media = message.attachments.filter(isMedia);
  const files = message.attachments.filter((a) => !isMedia(a));
  const hasMedia = media.length > 0 && message.state !== "unreadable";
  const uploadState = message.state === "failed" ? "failed" : message.state === "sending" ? "sending" : "sent";

  const canChange = mine && message.state === "sent" && !message.deleted && withinWindow(message);
  const failed = message.state === "failed";

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

  return (
    <div className={cn("group flex", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}>
      <div className={cn("flex max-w-[85%] items-end gap-1 sm:max-w-[70%]", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "min-w-0 rounded-2xl text-sm",
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
              {repliedTo ? (
                <div
                  className={cn(
                    "mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs",
                    hasMedia && "mx-1 mt-1",
                    mine ? "border-white/60 bg-white/10 text-blue-100" : "border-[#0d47a1] bg-background/60 text-muted-foreground dark:border-[#38bdf8]",
                  )}
                >
                  <span className="block font-semibold">{repliedTo.senderId === message.senderId ? (mine ? "You" : otherName) : mine ? otherName : "You"}</span>
                  <span className="line-clamp-2">
                    {repliedTo.deleted ? "This message was deleted" : repliedTo.text || repliedTo.attachments[0]?.name || "Message"}
                  </span>
                </div>
              ) : null}
              {media.length ? (
                <div className="flex flex-col gap-1">
                  {media.map((attachment) => (
                    <MediaTile key={attachment.id} attachment={attachment} mine={mine} state={uploadState} />
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
            <DropdownMenuContent align={mine ? "end" : "start"}>
              {canAct && !message.deleted ? (
                <DropdownMenuItem onSelect={onReply}>
                  <Reply aria-hidden="true" /> Reply
                </DropdownMenuItem>
              ) : null}
              {canChange && canAct ? (
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
        ) : null}
      </div>
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
  onClearReply,
  onClearEdit,
  onSent,
}: {
  conversationId: string;
  replyTo: ChatMessage | null;
  editing: ChatMessage | null;
  otherName: string;
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
                Replying to <span className="font-semibold text-foreground">{replyTo!.senderId === userId ? "yourself" : otherName}</span>:{" "}
                {replyTo!.text || replyTo!.attachments[0]?.name}
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
        <Button
          type="button"
          size="icon"
          onClick={() => void submit()}
          disabled={busy || (!text.trim() && !files.length)}
          aria-label={editing ? "Save edit" : "Send message"}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : editing ? <Check aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />}
        </Button>
      </div>
      <p className="mt-1.5 hidden text-[11px] text-muted-foreground sm:block">
        Enter to send · Shift + Enter for a new line · End-to-end encrypted
      </p>
    </div>
  );
}
