"use client";

import { Check, Forward, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { messageSummary, useChat, type ChatMessage } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchPeople, type ChatPerson } from "@/lib/chat/api";
import { cn } from "@/lib/utils";

const MAX_TARGETS = 5;

/** A chat to forward to: an existing conversation, or a person to start one with. */
type Target = { key: string; name: string; detail: string; online?: boolean; conversationId?: string; person?: ChatPerson };

export function ForwardDialog({
  message,
  open,
  onOpenChange,
}: {
  message: ChatMessage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { conversations, openWith, forward } = useChat();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [selected, setSelected] = useState<Target[]>([]);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const term = query.trim().toLowerCase();

  // People without a conversation yet, found by name or email.
  useEffect(() => {
    if (!open || !term) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchPeople(term);
        if (!cancelled) setPeople(results);
      } catch {
        if (!cancelled) setPeople([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, term]);

  const targets = useMemo<Target[]>(() => {
    const chats: Target[] = conversations
      .filter((c) => c.other?.is_active !== false && c.other?.chat_ready !== false)
      .filter((c) => !term || (c.other?.name ?? "").toLowerCase().includes(term))
      .map((c) => ({
        key: `c:${c.id}`,
        name: c.other?.name ?? "Conversation",
        detail: c.other?.department ?? "",
        online: c.other?.online,
        conversationId: c.id,
      }));
    if (!term) return chats;
    const withChat = new Set(conversations.map((c) => c.other?.id));
    const others: Target[] = people
      .filter((p) => !withChat.has(p.id))
      .map((p) => ({
        key: `p:${p.id}`,
        name: p.name,
        detail: p.chat_ready ? (p.department ?? p.email) : "Has not set up chat yet",
        online: p.online,
        person: p,
      }));
    return [...chats, ...others];
  }, [conversations, people, term]);

  function toggle(target: Target) {
    setSelected((current) => {
      if (current.some((t) => t.key === target.key)) return current.filter((t) => t.key !== target.key);
      if (current.length >= MAX_TARGETS) {
        toast.error(`You can forward to up to ${MAX_TARGETS} chats at a time.`);
        return current;
      }
      return [...current, target];
    });
  }

  function close(next: boolean) {
    if (sending) return;
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setSelected([]);
      setNote("");
    }
  }

  async function submit() {
    if (!selected.length) return;
    setSending(true);
    try {
      const ids: string[] = [];
      for (const target of selected) {
        ids.push(target.conversationId ?? (await openWith(target.person!)));
      }
      await forward(message, ids, note);
      toast.success(selected.length === 1 ? `Forwarded to ${selected[0].name}.` : `Forwarded to ${selected.length} chats.`);
      setSending(false);
      close(false);
    } catch (error) {
      setSending(false);
      toast.error(error instanceof Error ? error.message : "The message could not be forwarded.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader icon={<Forward className="size-4.5" />} className="px-5 pt-5 pb-3">
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription className="line-clamp-2">{messageSummary(message)}</DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats and people"
              aria-label="Search chats and people"
              className="pl-9"
              autoFocus
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            {selected.length ? `${selected.length} of ${MAX_TARGETS} selected` : `Choose up to ${MAX_TARGETS} chats`}
          </p>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto border-y border-border" aria-label="Chats to forward to">
          {targets.length ? (
            targets.map((target) => {
              const isSelected = selected.some((t) => t.key === target.key);
              const blocked = Boolean(target.person && !target.person.chat_ready);
              return (
                <li key={target.key}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    disabled={blocked || sending}
                    onClick={() => toggle(target)}
                    className={cn(
                      "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
                      isSelected && "bg-[#0d47a1]/6 dark:bg-[#38bdf8]/10",
                    )}
                  >
                    <Avatar name={target.name} online={target.online} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{target.name}</span>
                      {target.detail ? <span className="block truncate text-xs text-muted-foreground">{target.detail}</span> : null}
                    </span>
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isSelected ? "border-[#0d47a1] bg-[#0d47a1] text-white dark:border-[#38bdf8] dark:bg-[#38bdf8] dark:text-[#0b1120]" : "border-border",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-5 py-8 text-center text-sm text-muted-foreground">
              {term ? "No chats or people match that." : "No chats yet. Search for someone to forward to."}
            </li>
          )}
        </ul>

        <div className="px-5 pt-3">
          <label htmlFor="forward-note" className="sr-only">
            Add a message (optional)
          </label>
          <Input
            id="forward-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a message (optional)"
            disabled={sending}
          />
        </div>

        <DialogFooter className="px-5 pt-3 pb-5">
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={sending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!selected.length || sending}>
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Forward className="size-4" aria-hidden="true" />}
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
