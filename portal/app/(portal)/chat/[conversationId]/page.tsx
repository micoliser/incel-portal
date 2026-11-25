"use client";

import { useParams } from "next/navigation";

import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ChatConversationPage() {
  const params = useParams();
  return <ChatWorkspace conversationId={String(params.conversationId)} />;
}
