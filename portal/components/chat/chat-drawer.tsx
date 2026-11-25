"use client";

import { Maximize2, MessagesSquare, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { ChatGate } from "@/components/chat/chat-gate";
import { ChatMenu } from "@/components/chat/chat-menu";
import { useChat } from "@/components/chat/chat-provider";
import { ConversationList } from "@/components/chat/conversation-list";
import { MessageThread } from "@/components/chat/message-thread";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The slide-up chat available on every portal page except /chat itself. It
 * stays open while moving between pages because it lives in the layout.
 */
export function ChatDrawer() {
  const pathname = usePathname();
  const { drawer, openDrawer, closeDrawer, conversations, unreadTotal } = useChat();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Closing from inside the drawer puts focus back on the button that opened it.
  const returnFocus = useRef(false);
  const onChatPage = pathname.startsWith("/chat");
  const active = conversations.find((c) => c.id === drawer.conversationId) ?? null;

  useEffect(() => {
    if (!drawer.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Only when the drawer has focus (or focus was lost when its content
      // changed), so Escape elsewhere on the page keeps its own meaning.
      const active = document.activeElement;
      if (active && active !== document.body && !panelRef.current?.contains(active)) return;
      // Leave Escape to open menus and dialogs first.
      if (document.querySelector("[data-slot='dropdown-menu-content'], [role='dialog'][data-state='open']:not([data-chat-drawer])")) return;
      returnFocus.current = true;
      closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawer, drawer.open]);

  useEffect(() => {
    if (drawer.open) {
      panelRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [drawer.open]);

  if (onChatPage) return null;

  return (
    <>
      {!drawer.open ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => openDrawer(drawer.conversationId)}
          className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-[#0d47a1] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(13,71,161,0.35)] transition-colors hover:bg-[#0a3880] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:right-6 sm:bottom-6"
          aria-label={unreadTotal ? `Open chat, ${unreadTotal} unread` : "Open chat"}
        >
          <MessagesSquare className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Chat</span>
          {unreadTotal ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-[#0d47a1]" aria-hidden="true">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          ) : null}
        </button>
      ) : null}

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label="Chat"
        data-chat-drawer=""
        tabIndex={-1}
        hidden={!drawer.open}
        className={cn(
          "fixed z-40 flex flex-col overflow-hidden border border-border bg-card shadow-[0_12px_40px_rgba(9,9,11,0.18)] focus:outline-none dark:shadow-[0_16px_48px_rgba(0,0,0,0.6)]",
          "inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[min(600px,calc(100vh-7rem))] sm:w-[400px] sm:rounded-xl",
          drawer.open && "motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0",
        )}
      >
        <div className="flex items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
          <MessagesSquare className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" aria-hidden="true" />
          <p className="flex-1 text-sm font-semibold text-foreground">Chat</p>
          <ChatMenu />
          <Button asChild variant="ghost" size="icon-sm">
            <Link
              href={active ? `/chat/${active.id}` : "/chat"}
              aria-label="Open chat in full page"
              title="Open in full page"
              onClick={closeDrawer}
            >
              <Maximize2 aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close chat"
            onClick={() => {
              returnFocus.current = true;
              closeDrawer();
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          {drawer.open ? (
            <ChatGate compact>
              {active ? (
                <MessageThread conversation={active} compact onBack={() => openDrawer(null)} />
              ) : (
                <ConversationList activeId={null} onOpen={(id) => openDrawer(id)} />
              )}
            </ChatGate>
          ) : null}
        </div>
      </div>
    </>
  );
}
