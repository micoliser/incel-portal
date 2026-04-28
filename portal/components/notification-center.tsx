"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, CheckCheck, Loader2, Trash2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);

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
          error instanceof Error
            ? error.message
            : "Failed to load notifications";
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

    fetchUnread();
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

  useEffect(() => {
    if (!open) return undefined;

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!sidebarRef.current) return;
      if (target && !sidebarRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const markOneRead = async (notificationId: number) => {
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
        error instanceof Error
          ? error.message
          : "Failed to mark notification as read";
      toast.error(message);
    }
  };

  const handleClearOne = async (notificationId: number) => {
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
        error instanceof Error ? error.message : "Failed to clear notification";
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
        error instanceof Error
          ? error.message
          : "Failed to mark all notifications as read";
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
        error instanceof Error
          ? error.message
          : "Failed to clear all notifications";
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

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open notifications"
        className="relative border-border bg-card text-foreground hover:bg-muted"
      >
        {hasUnread ? (
          <BellRing className="size-4" aria-hidden="true" />
        ) : (
          <Bell className="size-4" aria-hidden="true" />
        )}
        {hasUnread && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {showSidebar && (
        <>
          <button
            type="button"
            aria-label="Close notifications sidebar"
            className="fixed inset-0 z-40 bg-transparent transition-opacity"
            onClick={() => setOpen(false)}
          />

          <aside
            ref={sidebarRef}
            className={`fixed right-0 top-0 z-50 h-screen w-[min(96vw,25rem)] border-l border-border bg-card shadow-2xl transform transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
          >
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-3">
                <div>
                  <p className="text-base font-semibold text-foreground">
                    Notifications
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {unreadItems} unread
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMarkingAllRead || unreadItems === 0}
                  onClick={handleMarkAllRead}
                >
                  {isMarkingAllRead ? (
                    <Loader2
                      className="mr-1 size-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCheck className="mr-1 size-3" aria-hidden="true" />
                  )}
                  Mark all read
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isClearingAll || notifications.length === 0}
                  onClick={handleClearAll}
                >
                  {isClearingAll ? (
                    <Loader2
                      className="mr-1 size-3 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="mr-1 size-3" aria-hidden="true" />
                  )}
                  Clear all
                </Button>
              </div>

              {loading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  <Loader2
                    className="mr-2 size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Loading notifications...
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  No notifications yet.
                </div>
              ) : (
                <div
                  className="flex-1 space-y-2 overflow-auto pr-1"
                  onScroll={handleListScroll}
                >
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`rounded-lg border p-3 ${
                        notification.is_read
                          ? "border-border bg-muted/30"
                          : "border-primary/30 bg-primary/5"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">
                            {notification.title}
                          </p>
                          {notification.body ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {notification.body}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatDistanceToNow(
                              new Date(notification.created_at),
                              {
                                addSuffix: true,
                              },
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        {!notification.is_read && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void markOneRead(notification.id)}
                          >
                            Read
                          </Button>
                        )}
                        {notification.link_url ? (
                          <Link
                            href={notification.link_url}
                            className="text-xs font-medium text-primary hover:underline"
                            onClick={() => {
                              if (!notification.is_read) {
                                void markOneRead(notification.id);
                              }
                              setOpen(false);
                            }}
                          >
                            Open
                          </Link>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="ml-auto text-destructive hover:text-destructive"
                          onClick={() => void handleClearOne(notification.id)}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                  ))}

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
        </>
      )}
    </div>
  );
}
