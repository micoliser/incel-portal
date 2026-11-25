"use client";

import { Archive, ArchiveRestore, Bell, BellOff, EyeOff, LogOut, MoreVertical, Users } from "lucide-react";
import { toast } from "sonner";

import { useChat, type ChatConversation } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { extractApiErrorMessage } from "@/lib/api-errors";

const HOUR = 60 * 60 * 1000;
// "Always" is stored as a date far in the future.
const ALWAYS = new Date("9999-12-31T00:00:00Z");

function mutedUntilLabel(iso: string) {
  const until = new Date(iso);
  if (until.getFullYear() >= 9999) return "Muted";
  return `Muted until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/** Your own settings for one chat: mute, archive, hide. Nobody else is affected. */
export function ChatOptionsMenu({
  conversation,
  onGroupInfo,
  onHidden,
  onLeave,
  open,
  onOpenChange,
  triggerClassName,
  label = "Chat options",
}: {
  conversation: ChatConversation;
  onGroupInfo?: () => void;
  /** After hiding: close the chat. */
  onHidden?: () => void;
  /** Groups only: start leaving the group (the parent shows the confirmation). */
  onLeave?: () => void;
  /** Controlled, so a right-click or long press elsewhere can open it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  label?: string;
}) {
  const { muteConversation, archiveConversation, hideConversation } = useChat();

  function run(action: () => Promise<void>, done: string) {
    action()
      .then(() => toast.success(done))
      .catch((error) => toast.error(extractApiErrorMessage(error, "Could not change this chat.")));
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className={triggerClassName}
        >
          <MoreVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {onGroupInfo ? (
          <>
            <DropdownMenuItem onSelect={() => window.setTimeout(onGroupInfo, 0)}>
              <Users aria-hidden="true" /> Group info
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {conversation.isMuted ? (
          <DropdownMenuItem onSelect={() => run(() => muteConversation(conversation.id, null), "Notifications back on.")}>
            <Bell aria-hidden="true" /> Unmute
            <span className="ml-auto pl-3 text-xs text-muted-foreground">{mutedUntilLabel(conversation.muted_until!)}</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <BellOff aria-hidden="true" /> Mute notifications
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onSelect={() => run(() => muteConversation(conversation.id, new Date(Date.now() + 8 * HOUR)), "Muted for 8 hours.")}
              >
                For 8 hours
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => run(() => muteConversation(conversation.id, new Date(Date.now() + 7 * 24 * HOUR)), "Muted for a week.")}
              >
                For 1 week
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run(() => muteConversation(conversation.id, ALWAYS), "Muted.")}>Always</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {conversation.archived ? (
          <DropdownMenuItem onSelect={() => run(() => archiveConversation(conversation.id, false), "Moved back to your chats.")}>
            <ArchiveRestore aria-hidden="true" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => run(() => archiveConversation(conversation.id, true), "Chat archived.")}>
            <Archive aria-hidden="true" /> Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() =>
            run(async () => {
              await hideConversation(conversation.id, true);
              onHidden?.();
            }, "Chat hidden. It comes back when there is a new message.")
          }
        >
          <EyeOff aria-hidden="true" /> Hide chat
        </DropdownMenuItem>
        {onLeave ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => window.setTimeout(onLeave, 0)}>
              <LogOut aria-hidden="true" /> Leave group
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
