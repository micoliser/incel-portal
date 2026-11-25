/**
 * The chat WebSocket: delivery only. Opens with a one-time ticket, pings every
 * 25 seconds, and reconnects with back-off. Changes go through the REST API.
 */
import { getApiBaseUrl } from "@/lib/auth";
import { getTicket } from "@/lib/chat/api";

export type ChatEvent = { event: string; data: Record<string, unknown> };

const PING_MS = 25_000;

export function chatSocketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CHAT_WS_URL?.trim();
  const base = configured || getApiBaseUrl().replace(/\/api\/v1\/?$/, "");
  const url = new URL(base);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws/chat/`;
  return url.toString();
}

export class ChatSocket {
  private socket: WebSocket | null = null;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;
  private attempts = 0;
  private stopped = false;
  private opened = false;

  constructor(
    private readonly onEvent: (event: ChatEvent) => void,
    private readonly onStatus: (connected: boolean, reconnected: boolean) => void,
  ) {}

  start() {
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close(1000);
      this.socket = null;
    }
  }

  send(data: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  private clearTimers() {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private async connect() {
    if (this.stopped) return;
    let ticket: string;
    try {
      ticket = await getTicket();
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.stopped) return;

    const url = new URL(chatSocketUrl());
    url.searchParams.set("ticket", ticket);
    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.onopen = () => {
      const reconnected = this.opened;
      this.opened = true;
      this.attempts = 0;
      this.onStatus(true, reconnected);
      this.pingTimer = window.setInterval(() => this.send({ type: "ping" }), PING_MS);
    };
    socket.onmessage = (message) => {
      try {
        const parsed = JSON.parse(String(message.data)) as ChatEvent;
        if (parsed?.event && parsed.event !== "pong") this.onEvent(parsed);
      } catch {
        // Ignore anything that is not an event.
      }
    };
    socket.onclose = () => {
      this.clearTimers();
      this.socket = null;
      this.onStatus(false, false);
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) + Math.random() * 500;
    this.attempts += 1;
    this.retryTimer = window.setTimeout(() => void this.connect(), delay);
  }
}
