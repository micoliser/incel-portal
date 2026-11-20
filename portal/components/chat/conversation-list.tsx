"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useChat, type ChatConversation } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchPeople, type ChatPerson } from "@/lib/chat/api";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

export function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function Avatar({ name, online, size = "md" }: { name: string; online?: boolean; size?: "sm" | "md" }) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-[#0d47a1]/10 font-semibold text-[#0d47a1] dark:bg-[#38bdf8]/15 dark:text-[#38bdf8]",
          size === "sm" ? "size-8 text-xs" : "size-10 text-sm",
        )}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
      {online ? (
        <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success ring-2 ring-card" aria-hidden="true" />
      ) : null}
    </span>
  );
}

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function ConversationList({
  activeId,
  onOpen,
}: {
  activeId: string | null;
  onOpen: (conversationId: string) => void;
}) {
  const { conversations, openWith, invite, typing } = useChat();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<ChatPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  const searchingPeople = query.trim().length > 0;

  useEffect(() => {
    if (!searchingPeople) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPeople(query.trim());
        if (!cancelled) setPeople(results);
      } catch {
        if (!cancelled) setPeople([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchingPeople]);

  async function start(person: ChatPerson) {
    setOpening(person.id);
    try {
      const id = await openWith(person);
      setQuery("");
      setPeople(null);
      onOpen(id);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Could not open the chat."));
    } finally {
      setOpening(null);
    }
  }

  async function sendInvite(person: ChatPerson) {
    setOpening(person.id);
    try {
      const id = await invite(person.id);
      toast.success(`Invitation sent. ${person.name} has been notified and emailed.`);
      setQuery("");
      setPeople(null);
      onOpen(id);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Could not send the invitation."));
    } finally {
      setOpening(null);
    }
  }

  const existing = new Map(
    conversations.filter((c) => c.kind === "direct" && c.other).map((c) => [c.other!.id, c.id] as const),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people to message"
            aria-label="Search people to message"
            className="pr-9 pl-9"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {searchingPeople ? (
          <PeopleResults
            people={people}
            searching={searching}
            opening={opening}
            existing={existing}
            onStart={start}
            onInvite={sendInvite}
            onOpenExisting={(id) => {
              setQuery("");
              setPeople(null);
              onOpen(id);
            }}
          />
        ) : conversations.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Search for someone above to send your first message.
          </div>
        ) : (
          <ul aria-label="Conversations">
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                typing={Boolean(typing[conversation.id])}
                onOpen={() => onOpen(conversation.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  typing,
  onOpen,
}: {
  conversation: ChatConversation;
  active: boolean;
  typing: boolean;
  onOpen: () => void;
}) {
  const name = conversation.other?.name ?? "Conversation";
  const unread = conversation.unread_count;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          active && "bg-[#0d47a1]/8 dark:bg-[#38bdf8]/10",
        )}
      >
        <Avatar name={name} online={conversation.other?.online} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>{name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{timeLabel(conversation.last_message_at)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate text-xs", typing ? "text-success-text" : unread ? "text-foreground" : "text-muted-foreground")}>
              {typing
                ? "Typing…"
                : conversation.other && !conversation.other.is_active
                  ? "No longer has access"
                  : conversation.preview}
            </span>
            {unread ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#0d47a1] px-1.5 text-[11px] font-semibold text-white">
                <span className="sr-only">{unread} unread</span>
                <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function PeopleResults({
  people,
  searching,
  opening,
  existing,
  onStart,
  onInvite,
  onOpenExisting,
}: {
  people: ChatPerson[] | null;
  searching: boolean;
  opening: number | null;
  existing: Map<number, string>;
  onStart: (person: ChatPerson) => void;
  onInvite: (person: ChatPerson) => void;
  onOpenExisting: (conversationId: string) => void;
}) {
  if (searching && !people) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Searching…
      </p>
    );
  }
  if (!people?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No one matches that name or email.</p>;
  }
  return (
    <ul aria-label="People">
      {people.map((person) => (
        <li key={person.id} className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5">
          <Avatar name={person.name} online={person.online} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{person.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {person.chat_ready || existing.has(person.id) ? person.department ?? person.email : "Has not set up chat yet"}
            </span>
          </span>
          {existing.has(person.id) ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenExisting(existing.get(person.id)!)}>
              Open
            </Button>
          ) : person.chat_ready ? (
            <Button type="button" size="sm" onClick={() => onStart(person)} disabled={opening === person.id}>
              {opening === person.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Message
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => onInvite(person)} disabled={opening === person.id}>
              {opening === person.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Invite
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
