"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CheckSquare2,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  Package,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  clearAllNotifications,
  clearNotification,
  getNotifications,
  getPushPublicKey,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationItem,
  upsertPushSubscription,
} from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30000;
const PAGE_SIZE = 20;
const PUSH_PROMPT_LAST_DATE_KEY = "notifications.push.prompt-last-date";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNotificationIcon(type: string, title: string) {
  const t = `${type || ""} ${title || ""}`.toLowerCase();
  if (t.includes("task") || t.includes("schedule")) return CheckSquare2;
  if (t.includes("comment") || t.includes("mention") || t.includes("chat"))
    return MessageSquare;
  if (t.includes("summary") || t.includes("report")) return FileText;
  if (t.includes("asset") || t.includes("inventory") || t.includes("equipment"))
    return Package;
  if (t.includes("alert") || t.includes("warning") || t.includes("urgent"))
    return AlertCircle;
  return Bell;
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [filterTab, setFilterTab] = useState<"all" | "unread">("all");

  const hasUnread = unreadCount > 0;

  const ensurePushSubscription = useCallback(
    async (promptIfNeeded: boolean): Promise<boolean> => {
      if (typeof window === "undefined") return false;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return false;
      }

      try {
        const publicKey = await getPushPublicKey();
        if (!publicKey) {
          return false;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          if (!promptIfNeeded || Notification.permission === "denied") {
            return false;
          }

          let permission: NotificationPermission = Notification.permission;
          if (permission !== "granted") {
            permission = await Notification.requestPermission();
          }
          if (permission !== "granted") {
            return false;
          }

          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }

        const json = subscription.toJSON();
        const endpoint = json.endpoint;
        const p256dh = json.keys?.p256dh;
        const auth = json.keys?.auth;

        if (!endpoint || !p256dh || !auth) {
          return false;
        }

        await upsertPushSubscription({
          endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent,
        });

        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const loadNotificationsPage = useCallback(
    async (page: number, mode: "replace" | "append") => {
      try {
        if (page === 1) {
          setLoading(true);
        } else {
          setLoadingMore(true);
        }

        const response = await getNotifications(page, PAGE_SIZE);
        setCurrentPage(response.page);
        setHasNextPage(response.next_page !== null);

        setNotifications((current) => {
          if (mode === "replace") {
            return response.results;
          }

          const seen = new Set(current.map((item) => item.id));
          const next = response.results.filter((item) => !seen.has(item.id));
          return [...current, ...next];
        });
      } catch (error) {
        const message =
          extractApiErrorMessage(error, "Failed to load notifications");
        toast.error(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const fetchUnread = async () => {
      try {
        const count = await getUnreadNotificationCount();
        if (!cancelled) setUnreadCount(count);
      } catch {
        if (!cancelled) setUnreadCount(0);
      }
    };

    void fetchUnread();
    const interval = window.setInterval(fetchUnread, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const maybePromptAndSubscribe = async () => {
      const alreadySubscribed = await ensurePushSubscription(false);
      if (cancelled || alreadySubscribed) return;

      const today = getTodayKey();
      const lastPromptDate = window.localStorage.getItem(
        PUSH_PROMPT_LAST_DATE_KEY,
      );
      if (lastPromptDate === today) return;

      window.localStorage.setItem(PUSH_PROMPT_LAST_DATE_KEY, today);
      await ensurePushSubscription(true);
    };

    void maybePromptAndSubscribe();

    return () => {
      cancelled = true;
    };
  }, [ensurePushSubscription]);

  useEffect(() => {
    if (!open) return;
    void loadNotificationsPage(1, "replace");
  }, [open, loadNotificationsPage]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let t: number | undefined;
    if (open) {
      setShowSidebar(true);
    } else if (showSidebar) {
      t = window.setTimeout(() => setShowSidebar(false), 300);
    }
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [open, showSidebar]);

  const sidebarRef = useRef<HTMLElement | null>(null);
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !sidebarRef.current?.contains(target) &&
        !bellButtonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const markOneRead = async (notificationId: string) => {
    try {
      const existing = notifications.find((item) => item.id === notificationId);
      const updated = await markNotificationRead(notificationId);
      setNotifications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      if (existing && !existing.is_read) {
        setUnreadCount((current) => Math.max(current - 1, 0));
      }
    } catch (error) {
      const message =
        extractApiErrorMessage(error, "Failed to mark notification as read");
      toast.error(message);
    }
  };

  const handleClearOne = async (notificationId: string) => {
    try {
      const existing = notifications.find((item) => item.id === notificationId);
      await clearNotification(notificationId);
      setNotifications((current) =>
        current.filter((item) => item.id !== notificationId),
      );
      if (existing && !existing.is_read) {
        setUnreadCount((current) => Math.max(current - 1, 0));
      }
    } catch (error) {
      const message =
        extractApiErrorMessage(error, "Failed to clear notification");
      toast.error(message);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      setIsMarkingAllRead(true);
      const updatedCount = await markAllNotificationsRead();
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_read: true,
          read_at: item.read_at ?? new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
      if (updatedCount > 0) {
        toast.success("All notifications marked as read.");
      }
    } catch (error) {
      const message =
        extractApiErrorMessage(error, "Failed to mark all notifications as read");
      toast.error(message);
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleClearAll = async () => {
    try {
      setIsClearingAll(true);
      const deletedCount = await clearAllNotifications();
      setNotifications([]);
      setUnreadCount(0);
      setCurrentPage(1);
      setHasNextPage(false);
      if (deletedCount > 0) {
        toast.success("All notifications cleared.");
      }
    } catch (error) {
      const message =
        extractApiErrorMessage(error, "Failed to clear all notifications");
      toast.error(message);
    } finally {
      setIsClearingAll(false);
    }
  };

  const handleListScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    if (loading || loadingMore || !hasNextPage) return;

    const node = event.currentTarget;
    const nearBottom =
      node.scrollTop + node.clientHeight >= node.scrollHeight - 80;
    if (!nearBottom) return;

    void loadNotificationsPage(currentPage + 1, "append");
  };

  const unreadItems = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const displayedNotifications = useMemo(() => {
    if (filterTab === "unread") {
      return notifications.filter((item) => !item.is_read);
    }
    return notifications;
  }, [notifications, filterTab]);

  return (
    <div className="relative">
      <Button
        ref={bellButtonRef}
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open notifications"
        className="relative size-9 rounded-xl border-border/80 bg-card text-foreground shadow-xs transition-colors hover:bg-muted"
      >
        {hasUnread ? (
          <BellRing className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" aria-hidden="true" />
        ) : (
          <Bell className="size-4" aria-hidden="true" />
        )}
        {hasUnread && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-white shadow-xs">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {mounted && showSidebar && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop overlay matching modal blur & dim */}
          <button
            type="button"
            aria-label="Close notifications sidebar"
            className={cn(
              "fixed inset-0 z-50 bg-black/60 backdrop-blur-[3px] transition-opacity duration-300",
              open ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
            onClick={() => setOpen(false)}
          />

          {/* Slide-over Drawer */}
          <aside
            ref={sidebarRef}
            className={cn(
              "fixed right-0 top-0 z-50 flex h-screen w-full sm:w-[420px] max-w-[100vw] flex-col border-l border-border/80 bg-card/95 shadow-2xl backdrop-blur-md transition-transform duration-300 ease-in-out",
              open ? "translate-x-0" : "translate-x-full",
            )}
          >
            {/* Drawer Header */}
            <div className="flex flex-col border-b border-border/70 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                    <Bell className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      Notifications
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {unreadCount > 0
                        ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                        : "All notifications caught up"}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {/* Action Toolbar */}
              <div className="mt-3.5 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMarkingAllRead || unreadItems === 0}
                  onClick={handleMarkAllRead}
                  className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {isMarkingAllRead ? (
                    <Loader2
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCheck className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" aria-hidden="true" />
                  )}
                  Mark all read
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isClearingAll || notifications.length === 0}
                  onClick={handleClearAll}
                  className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-muted-foreground hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  {isClearingAll ? (
                    <Loader2
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                  Clear all
                </Button>
              </div>
            </div>

            {/* Blue Modal Tabs: All vs Unread */}
            <div className="px-4 pt-3 sm:px-5">
              <div className="flex items-center gap-2 rounded-lg border border-border p-1 mb-3">
                <Button
                  type="button"
                  variant={filterTab === "all" ? "default" : "ghost"}
                  onClick={() => setFilterTab("all")}
                  className={cn(
                    "flex-1 rounded-md font-semibold text-xs transition-colors h-8 gap-1.5",
                    filterTab === "all"
                      ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px] font-medium tabular-nums",
                      filterTab === "all"
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {notifications.length}
                  </span>
                </Button>

                <Button
                  type="button"
                  variant={filterTab === "unread" ? "default" : "ghost"}
                  onClick={() => setFilterTab("unread")}
                  className={cn(
                    "flex-1 rounded-md font-semibold text-xs transition-colors h-8 gap-1.5",
                    filterTab === "unread"
                      ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Unread
                  {unreadCount > 0 && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.2 text-[10px] font-semibold tabular-nums",
                        filterTab === "unread"
                          ? "bg-white text-[#0d47a1]"
                          : "bg-destructive text-white"
                      )}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* List Body */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
              {loading ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-6 animate-spin text-[#0d47a1] dark:text-[#38bdf8]" />
                  <span>Loading notifications...</span>
                </div>
              ) : displayedNotifications.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] mb-3">
                    <Sparkles className="size-6" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {filterTab === "unread"
                      ? "No unread notifications"
                      : "No notifications yet"}
                  </p>
                  <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
                    {filterTab === "unread"
                      ? "You are all caught up with your updates."
                      : "When you receive task updates, reports, or mentions, they will appear here."}
                  </p>
                </div>
              ) : (
                <div
                  className="space-y-2.5 pt-1"
                  onScroll={handleListScroll}
                >
                  {displayedNotifications.map((notification) => {
                    const IconComponent = getNotificationIcon(
                      notification.notification_type,
                      notification.title,
                    );

                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          "group relative flex flex-col rounded-xl border p-3.5 transition-all duration-200",
                          notification.is_read
                            ? "border-border/70 bg-card hover:bg-muted/30"
                            : "border-[#0d47a1]/30 bg-[#0d47a1]/[0.04] dark:bg-[#0d47a1]/10 dark:border-[#0d47a1]/35 shadow-xs"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Type Icon Badge */}
                          <div
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                              notification.is_read
                                ? "bg-muted text-muted-foreground"
                                : "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]"
                            )}
                          >
                            <IconComponent className="size-4" />
                          </div>

                          {/* Content */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={cn(
                                  "text-xs sm:text-sm font-semibold leading-snug break-words",
                                  notification.is_read
                                    ? "text-foreground"
                                    : "text-foreground font-bold"
                                )}
                              >
                                {notification.title}
                              </p>
                              {!notification.is_read && (
                                <span className="mt-1 size-2 shrink-0 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8]" />
                              )}
                            </div>

                            {notification.body ? (
                              <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                                {notification.body}
                              </p>
                            ) : null}

                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <Clock className="size-3" />
                              <span>
                                {formatDistanceToNow(
                                  new Date(notification.created_at),
                                  {
                                    addSuffix: true,
                                  },
                                )}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Item Action Footer */}
                        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            {!notification.is_read && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void markOneRead(notification.id)}
                                className="h-7 rounded-md px-2 text-[11px] font-medium text-foreground hover:bg-muted gap-1"
                              >
                                <Check className="size-3 text-[#0d47a1] dark:text-[#38bdf8]" />
                                Mark read
                              </Button>
                            )}

                            {notification.link_url && (
                              <Link
                                href={notification.link_url}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#0d47a1] hover:underline dark:text-[#38bdf8]"
                                onClick={() => {
                                  if (!notification.is_read) {
                                    void markOneRead(notification.id);
                                  }
                                  setOpen(false);
                                }}
                              >
                                <span>Open</span>
                                <ArrowUpRight className="size-3" />
                              </Link>
                            )}
                          </div>

                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-7 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void handleClearOne(notification.id)}
                            title="Clear notification"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}

                  {loadingMore ? (
                    <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                      <Loader2
                        className="mr-2 size-3 animate-spin"
                        aria-hidden="true"
                      />
                      Loading more...
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </aside>
        </>,
        document.body,
      )}
    </div>
  );
}
