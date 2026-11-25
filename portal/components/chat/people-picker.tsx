"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { Input } from "@/components/ui/input";
import { searchPeople, type ChatPerson } from "@/lib/chat/api";
import { cn } from "@/lib/utils";

/**
 * Choose several people: the people you already chat with, plus a search for
 * anyone in the workspace. People who have not set up chat can be chosen
 * (they are invited and join when they set it up).
 */
export function PeoplePicker({
  selected,
  onChange,
  exclude = [],
  max,
}: {
  selected: ChatPerson[];
  onChange: (people: ChatPerson[]) => void;
  /** Ids that cannot be chosen (already in the group). */
  exclude?: number[];
  max: number;
}) {
  const { conversations, userId } = useChat();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatPerson[]>([]);
  const term = query.trim();

  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const people = await searchPeople(term);
        if (!cancelled) setResults(people);
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  const excluded = useMemo(() => new Set([userId, ...exclude]), [exclude, userId]);
  const options = useMemo(() => {
    const list: ChatPerson[] = term
      ? results
      : conversations
          .filter((c) => !c.isGroup && c.other && c.other.is_active)
          .map((c) => c.other as ChatPerson);
    const seen = new Set<number>();
    return list.filter((p) => !excluded.has(p.id) && !seen.has(p.id) && seen.add(p.id));
  }, [conversations, excluded, results, term]);

  const chosen = new Set(selected.map((p) => p.id));

  function toggle(person: ChatPerson) {
    if (chosen.has(person.id)) onChange(selected.filter((p) => p.id !== person.id));
    else if (selected.length < max) onChange([...selected, person]);
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {selected.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen people">
          {selected.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => toggle(person)}
                aria-label={`Remove ${person.name}`}
                className="flex items-center gap-1.5 rounded-full border border-border bg-muted py-0.5 pr-2 pl-0.5 text-xs font-medium text-foreground hover:bg-muted/70"
              >
                <Avatar name={person.name} src={person.avatar_url} size="xs" />
                {person.name.split(" ")[0]}
                <X className="size-3 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people by name or email"
          aria-label="Search people"
          className="pl-9"
          autoFocus
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selected.length ? `${selected.length} chosen` : term ? "Results" : "People you chat with"}
        {selected.length >= max ? ` (the most for one group)` : ""}
      </p>
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto" aria-label="People">
        {options.length ? (
          options.map((person) => {
            const isChosen = chosen.has(person.id);
            return (
              <li key={person.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChosen}
                  disabled={!isChosen && selected.length >= max}
                  onClick={() => toggle(person)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50",
                    isChosen && "bg-[#0d47a1]/6 dark:bg-[#38bdf8]/10",
                  )}
                >
                  <Avatar name={person.name} src={person.avatar_url} online={person.online} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.chat_ready ? (person.department ?? person.email) : "Has not set up chat: will be invited"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      isChosen
                        ? "border-[#0d47a1] bg-[#0d47a1] text-white dark:border-[#38bdf8] dark:bg-[#38bdf8] dark:text-[#0b1120]"
                        : "border-border",
                    )}
                    aria-hidden="true"
                  >
                    {isChosen ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                </button>
              </li>
            );
          })
        ) : (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">
            {term ? "No one matches that." : "Search for colleagues to add."}
          </li>
        )}
      </ul>
    </div>
  );
}
