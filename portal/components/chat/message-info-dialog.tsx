"use client";

import { CheckCheck, Clock, Info } from "lucide-react";

import { messageSummary, type ChatConversation, type ChatMessage } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Participant } from "@/lib/chat/api";

/** Who in a group has seen your message, and who has not yet. */
export function MessageInfoDialog({
  conversation,
  message,
  userId,
  open,
  onOpenChange,
}: {
  conversation: ChatConversation;
  message: ChatMessage;
  userId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // People who were in the group when it was sent (pending members cannot read it).
  const others = conversation.members.filter((m) => m.id !== userId && !m.pending);
  const seen = others.filter((m) => m.last_read_seq >= message.seq);
  const waiting = others.filter((m) => m.last_read_seq < message.seq);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-sm">
        <DialogHeader icon={<Info className="size-4.5" />}>
          <DialogTitle>Message info</DialogTitle>
          <DialogDescription className="line-clamp-2">{messageSummary(message)}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <Section title={`Seen by ${seen.length}`} icon={<CheckCheck className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" aria-hidden="true" />} people={seen} empty="No one yet." />
          <Section title={`Not seen yet (${waiting.length})`} icon={<Clock className="size-4 text-muted-foreground" aria-hidden="true" />} people={waiting} empty="Everyone has seen it." />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, icon, people, empty }: { title: string; icon: React.ReactNode; people: Participant[]; empty: string }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {icon} {title}
      </h3>
      {people.length ? (
        <ul className="space-y-1">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-2.5 py-1">
              <Avatar name={person.name} src={person.avatar_url} size="sm" />
              <span className="truncate text-sm text-foreground">{person.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
