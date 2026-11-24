"use client";

import { Archive, ArrowLeft, BellOff, Loader2, Search, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useChat, type ChatConversation } from "@/components/chat/chat-provider";
import { ChatOptionsMenu } from "@/components/chat/chat-options-menu";
import { CreateGroupDialog } from "@/components/chat/create-group-dialog";
import { GroupInfoDialog } from "@/components/chat/group-info-dialog";
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

const AVATAR_SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-24 text-2xl",
} as const;

/** A person's profile picture, or their initials when they have none (or it fails to load). */
export function Avatar({
  name,
  src,
  online,
  size = "md",
}: {
  name: string;
  src?: string | null;
  online?: boolean;
  size?: keyof typeof AVATAR_SIZES;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = Boolean(src) && broken !== src;
  return (
    <span className="relative inline-flex shrink-0">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(src ?? null)}
          className={cn("rounded-full bg-muted object-cover", AVATAR_SIZES[size])}
        />
      ) : (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-[#0d47a1]/10 font-semibold text-[#0d47a1] dark:bg-[#38bdf8]/15 dark:text-[#38bdf8]",
            AVATAR_SIZES[size],
          )}
          aria-hidden="true"
        >
          {initialsOf(name)}
        </span>
      )}
      {online ? (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full bg-success ring-2 ring-card",
            size === "xs" ? "size-2" : "size-2.5",
          )}
          aria-hidden="true"
        />
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

export function ConversationList({ activeId, onOpen }: { activeId: string | null; onOpen: (conversationId: string) => void }) {
  const {
    conversations,
    openWith,
    invite,
    typing,
    typingPeople,
    conversationsHaveMore,
    loadingMoreConversations,
    loadMoreConversations,
  } = useChat();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
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

  // Load older conversations when the end of the list scrolls into view.
  const showingConversations = !searchingPeople && conversations.length > 0;
  useEffect(() => {
    const end = endRef.current;
    if (!end || !showingConversations || !conversationsHaveMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreConversations();
      },
      { root: scrollRef.current, rootMargin: "200px 0px" },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [showingConversations, conversationsHaveMore, loadMoreConversations, conversations.length]);

  // Hidden chats stay out of the list until a new message; archived ones have their own section.
  const listed = conversations.filter((c) => !c.hidden);
  const archived = listed.filter((c) => c.archived);
  const shown = listed.filter((c) => (showArchived ? c.archived : !c.archived));
  const archivedUnread = archived.reduce((sum, c) => sum + (c.isMuted ? 0 : c.unread_count), 0);

  const term = query.trim().toLowerCase();
  const matchingGroups = term ? conversations.filter((c) => c.isGroup && c.title.toLowerCase().includes(term)) : [];

  const existing = new Map(conversations.filter((c) => c.kind === "direct" && c.other).map((c) => [c.other!.id, c.id] as const));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people and groups"
            aria-label="Search people and groups"
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
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setCreatingGroup(true)}
          aria-label="New group"
          title="New group"
        >
          <Users aria-hidden="true" />
        </Button>
        <CreateGroupDialog open={creatingGroup} onOpenChange={setCreatingGroup} onCreated={onOpen} />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {searchingPeople ? (
          <>
            {matchingGroups.length ? (
              <ul aria-label="Groups">
                {matchingGroups.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    typingLabel={null}
                    onOpen={() => {
                      setQuery("");
                      setPeople(null);
                      onOpen(conversation.id);
                    }}
                  />
                ))}
              </ul>
            ) : null}
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
          </>
        ) : listed.length === 0 && !showArchived ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No conversations yet. Search for someone above to send your first message.
          </div>
        ) : (
          <>
            {showArchived ? (
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm font-semibold text-foreground hover:bg-muted"
              >
                <ArrowLeft className="size-4" aria-hidden="true" /> Archived chats
              </button>
            ) : archived.length ? (
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted"
              >
                <span className="flex size-10 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
                  <Archive className="size-5" />
                </span>
                <span className="flex-1 text-sm font-medium text-foreground">Archived</span>
                <span className="text-xs text-muted-foreground">
                  {archivedUnread ? (
                    <span className="font-semibold text-[#0d47a1] dark:text-[#38bdf8]">{archivedUnread} unread · </span>
                  ) : null}
                  {archived.length}
                </span>
              </button>
            ) : null}
            {showArchived && !shown.length ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No archived chats.</p>
            ) : null}
            <ul aria-label={showArchived ? "Archived chats" : "Conversations"}>
              {shown.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  typingLabel={typingLabel(conversation, Boolean(typing[conversation.id]), typingPeople[conversation.id])}
                  onOpen={() => onOpen(conversation.id)}
                />
              ))}
            </ul>
            {conversationsHaveMore ? (
              <div ref={endRef} className="flex justify-center p-3">
                {loadingMoreConversations ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading older conversations…
                  </p>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void loadMoreConversations()}>
                    Load older conversations
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Who is typing: "Typing…" in a direct chat, "Ada is typing…" / "Ada and Femi are typing…" in a group. */
export function typingLabel(conversation: ChatConversation, typing: boolean, people: number[] | undefined) {
  if (!typing) return null;
  if (!conversation.isGroup) return "Typing…";
  const names = (people ?? [])
    .map((id) => conversation.participants.find((p) => p.id === id)?.name.split(" ")[0])
    .filter(Boolean) as string[];
  if (!names.length) return "Typing…";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

function ConversationRow({
  conversation,
  active,
  typingLabel: typing,
  onOpen,
}: {
  conversation: ChatConversation;
  active: boolean;
  /** "Typing…", "Ada is typing…", or null. */
  typingLabel: string | null;
  onOpen: () => void;
}) {
  const name = conversation.title;
  const unread = conversation.unread_count;
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const pressed = useRef(false);

  // Press and hold on a phone opens the chat options (and does not open the chat).
  function pressStart(event: React.PointerEvent) {
    if (event.pointerType !== "touch") return;
    pressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      pressed.current = true;
      setMenuOpen(true);
    }, 450);
  }
  function pressEnd() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return (
    <>
      <li
        className="group/row relative"
        onContextMenu={(event) => {
          event.preventDefault();
          pressEnd();
          setMenuOpen(true);
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (pressed.current) {
              pressed.current = false;
              return;
            }
            onOpen();
          }}
          onPointerDown={pressStart}
          onPointerUp={pressEnd}
          onPointerLeave={pressEnd}
          onPointerCancel={pressEnd}
          aria-current={active ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-3 border-b border-border/60 py-3 pr-11 pl-3 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
            active && "bg-[#0d47a1]/8 dark:bg-[#38bdf8]/10",
          )}
        >
          <Avatar name={name} src={conversation.photoUrl} online={conversation.other?.online} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>{name}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {conversation.isMuted ? <BellOff className="size-3.5" aria-label="Muted" /> : null}
                {timeLabel(conversation.last_message_at)}
              </span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  "truncate text-xs",
                  typing ? "text-success-text" : unread ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {typing
                  ? typing
                  : conversation.other && !conversation.other.is_active
                    ? "No longer has access"
                    : conversation.preview}
              </span>
              {unread ? (
                <span
                  className={cn(
                    "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                    // Muted: the count still shows, quietly.
                    conversation.isMuted ? "bg-muted-foreground/25 text-foreground" : "bg-[#0d47a1] text-white",
                  )}
                >
                  <span className="sr-only">{unread} unread</span>
                  <span aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
                </span>
              ) : null}
            </span>
          </span>
        </button>
        <span className="absolute top-1/2 right-1.5 -translate-y-1/2">
          <ChatOptionsMenu
            conversation={conversation}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            label={`Options for ${name}`}
            onLeave={conversation.isGroup ? () => setLeaving(true) : undefined}
            triggerClassName={cn(
              "text-muted-foreground opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
              "[@media(hover:none)]:opacity-100",
            )}
          />
        </span>
      </li>
      {/* Outside the row, so clicks in the dialog don't reach the row's handlers. */}
      {conversation.isGroup && leaving ? (
        <GroupInfoDialog conversation={conversation} open onOpenChange={setLeaving} startAt="leave" />
      ) : null}
    </>
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
          <Avatar name={person.name} src={person.avatar_url} online={person.online} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{person.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {person.chat_ready || existing.has(person.id) ? (person.department ?? person.email) : "Has not set up chat yet"}
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
