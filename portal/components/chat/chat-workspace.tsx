"use client";

import { Loader2, MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChatGate } from "@/components/chat/chat-gate";
import { ChatMenu } from "@/components/chat/chat-menu";
import { useChat } from "@/components/chat/chat-provider";
import { ConversationList } from "@/components/chat/conversation-list";
import { MessageThread } from "@/components/chat/message-thread";
import { cn } from "@/lib/utils";

/** The full chat page: conversations on the left, the open one on the right (one at a time on phones). */
export function ChatWorkspace({ conversationId }: { conversationId: string | null }) {
  const router = useRouter();
  const { conversations, status, closeDrawer, connected, ensureConversation } = useChat();
  const active = conversations.find((c) => c.id === conversationId) ?? null;
  // Leaving a group (or being removed) closes it: back to the list.
  const wasOpen = useRef<string | null>(null);
  useEffect(() => {
    if (active) {
      wasOpen.current = active.id;
    } else if (conversationId && wasOpen.current === conversationId) {
      wasOpen.current = null;
      router.replace("/chat");
    }
  }, [active, conversationId, router]);

  // A chat opened by link (a push notification, a bookmark) may be older than
  // the conversations loaded so far: fetch it on its own.
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!conversationId || status !== "ready" || active) return;
    let cancelled = false;
    void ensureConversation(conversationId).then((found) => {
      if (!cancelled && !found) setMissing(conversationId);
    });
    return () => {
      cancelled = true;
    };
  }, [active, conversationId, ensureConversation, status]);

  useEffect(() => {
    closeDrawer();
  }, [closeDrawer]);

  return (
    <div className="h-full p-3 sm:p-4 lg:p-6">
      <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <ChatGate>
          <div
            className={cn(
              "flex min-h-0 w-full flex-col border-border md:w-80 md:shrink-0 md:border-r",
              conversationId && "hidden md:flex",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
              <div className="flex items-center gap-1">
                {status === "ready" && !connected ? (
                  <span className="text-xs text-muted-foreground" role="status">
                    Reconnecting…
                  </span>
                ) : null}
                <ChatMenu />
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ConversationList activeId={conversationId} onOpen={(id) => router.push(`/chat/${id}`)} />
            </div>
          </div>
          <div className={cn("min-h-0 min-w-0 flex-1", !conversationId && "hidden md:block")}>
            {active ? (
              <MessageThread conversation={active} onBack={() => router.push("/chat")} backOnPhonesOnly />
            ) : conversationId && status === "ready" ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground" role="status">
                {missing === conversationId ? (
                  "This conversation was not found."
                ) : (
                  <Loader2 className="size-5 animate-spin" aria-label="Loading conversation" />
                )}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <MessagesSquare className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Choose a conversation</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Or search for a colleague to start one. Messages and files are end-to-end encrypted.
                </p>
              </div>
            )}
          </div>
        </ChatGate>
      </div>
    </div>
  );
}
