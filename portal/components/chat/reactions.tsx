"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ComponentType, type ReactNode } from "react";

import type { MessageReaction } from "@/components/chat/chat-provider";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// The full picker (all emoji, search, categories) loads only when opened.
const EmojiPicker = dynamic(() => import("@/components/chat/emoji-picker"), {
  ssr: false,
  loading: () => <p className="flex h-[360px] w-[320px] items-center justify-center text-sm text-muted-foreground">Loading emoji…</p>,
});

export type MessageAction = {
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  onSelect: () => void;
  destructive?: boolean;
};

/**
 * The panel above a message: six quick reactions and "+" for every emoji,
 * and, when `actions` are given (right-click or press and hold), the message
 * actions below them, like WhatsApp. Controlled; `children` is the element it
 * is anchored to. Without `onPick` (reacting not allowed) only the actions show.
 */
export function ReactionPicker({
  open,
  onOpenChange,
  mine,
  onPick,
  actions,
  align,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mine: string | null;
  onPick?: (emoji: string) => void;
  actions?: MessageAction[];
  align: "start" | "end";
  children: ReactNode;
}) {
  const [full, setFull] = useState(false);

  function pick(emoji: string) {
    onPick?.(emoji);
    onOpenChange(false);
  }

  function act(action: MessageAction) {
    onOpenChange(false);
    // After the panel has closed, so dialogs it opens get focus.
    window.setTimeout(action.onSelect, 0);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setFull(false);
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align={align}
        side="top"
        className={cn("w-auto gap-0 p-1.5", full && "p-0")}
        onOpenAutoFocus={(event) => {
          // Focus the first reaction rather than the panel itself.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("button")?.focus();
        }}
      >
        {full ? (
          <EmojiPicker onPick={pick} />
        ) : (
          <div className="flex flex-col">
            {onPick ? (
              <div className="flex items-center gap-0.5" role="group" aria-label="React to this message">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => pick(emoji)}
                    aria-pressed={mine === emoji}
                    aria-label={mine === emoji ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-xl transition-transform duration-100 hover:scale-110 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#0d47a1] motion-reduce:hover:scale-100",
                      mine === emoji && "bg-[#0d47a1]/12 dark:bg-[#38bdf8]/20",
                    )}
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFull(true)}
                  aria-label="More emoji"
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#0d47a1]"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {actions?.length ? (
              <div
                role="group"
                aria-label="Message actions"
                className={cn("flex flex-col", onPick && "mt-1.5 border-t border-border pt-1.5")}
              >
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => act(action)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      action.destructive ? "text-destructive-text" : "text-foreground",
                    )}
                  >
                    <action.icon className="size-4 shrink-0 opacity-80" aria-hidden="true" />
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** "You and Ada", "Ada" */
function namesOf(userIds: number[], userId: number, nameOf: (id: number) => string) {
  const names = userIds.map((id) => (id === userId ? "You" : nameOf(id)));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The reactions under a message, grouped by emoji. Choosing one toggles your own reaction with it. */
export function ReactionChips({
  reactions,
  userId,
  mine,
  nameOf,
  onToggle,
  disabled,
  className,
}: {
  className?: string;
  reactions: MessageReaction[];
  userId: number;
  /** The message is the viewer's own (its bubble is on the right). */
  mine: boolean;
  nameOf: (id: number) => string;
  onToggle: (emoji: string) => void;
  disabled?: boolean;
}) {
  if (!reactions.length) return null;
  const groups = new Map<string, number[]>();
  for (const reaction of reactions) groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction.userId]);

  return (
    <ul
      className={cn("relative z-10 -mt-1.5 flex flex-wrap gap-1 px-1.5", mine ? "justify-end" : "justify-start", className)}
      aria-label="Reactions"
    >
      {[...groups.entries()].map(([emoji, userIds]) => {
        const reactedByMe = userIds.includes(userId);
        const who = namesOf(userIds, userId, nameOf);
        return (
          <li key={emoji}>
            <button
              type="button"
              onClick={() => onToggle(emoji)}
              disabled={disabled}
              title={`${who} reacted ${emoji}`}
              aria-label={`${emoji} ${userIds.length}, ${who}.${reactedByMe ? " Remove your reaction." : ` React with ${emoji}.`}`}
              aria-pressed={reactedByMe}
              className={cn(
                "flex h-6 items-center gap-1 rounded-full border bg-card px-1.5 text-sm shadow-[0_1px_2px_rgba(9,9,11,0.08)] transition-colors focus-visible:outline-2 focus-visible:outline-[#0d47a1] disabled:cursor-default",
                reactedByMe
                  ? "border-[#0d47a1]/50 bg-[#0d47a1]/8 dark:border-[#38bdf8]/50 dark:bg-[#38bdf8]/12"
                  : "border-border hover:bg-muted",
              )}
            >
              <span aria-hidden="true">{emoji}</span>
              {userIds.length > 1 ? (
                <span className="text-xs font-medium text-muted-foreground tabular-nums" aria-hidden="true">
                  {userIds.length}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
