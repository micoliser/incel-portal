"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Search,
  UserCheck,
  UserPlus,
  Loader2,
  Users,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { getUsers, type UserOption } from "@/lib/api/tasks";
import { summariesAPI, type UserShare } from "@/lib/api/summaries";
import { getUnreadNotificationCount } from "@/lib/api/notifications";

type Props = {
  open: boolean;
  onClose: () => void;
  weekStartDate: string;
  onShared?: (userId: number) => void;
};

export function ShareWithUserModal({
  open,
  onClose,
  weekStartDate,
  onShared,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [sharingUserId, setSharingUserId] = useState<number | null>(null);
  const [revokingUserId, setRevokingUserId] = useState<number | null>(null);
  const [sharedWith, setSharedWith] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const users = await getUsers({ search: query });
        setResults(users || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [query]);

  // Load existing user-shares for this week when modal opens
  useEffect(() => {
    if (!open || !weekStartDate) {
      setQuery("");
      setResults([]);
      return;
    }
    (async () => {
      try {
        const shares = await summariesAPI.getUserShares(weekStartDate);
        const map: Record<number, boolean> = {};
        (shares || []).forEach((s: UserShare) => {
          if (s.shared_with) map[Number(s.shared_with)] = true;
        });
        setSharedWith(map);
      } catch {
        // quiet fallback
      }
    })();
  }, [open, weekStartDate]);

  const handleShare = async (userId: number | string) => {
    if (!weekStartDate) return;
    const uid = Number(userId);
    try {
      setSharingUserId(uid);
      const resp = await summariesAPI.shareWithUser(weekStartDate, uid);
      toast.success("Summary successfully shared with user");

      try {
        if (typeof window !== "undefined" && "Notification" in window) {
          const shareLink =
            resp?.share_link ||
            (resp?.share_token ? `/summaries?token=${resp.share_token}` : null);
          const fullUrl = shareLink
            ? `${window.location.origin}${shareLink}`
            : `${window.location.origin}/summaries?id=${weekStartDate}`;
          if (Notification.permission === "granted") {
            const n = new Notification("Summary shared", {
              body: `Weekly summary was shared. Click to view.`,
              data: { url: fullUrl },
            });
            n.onclick = () => window.open(fullUrl, "_blank");
          }
        }
      } catch {
        // ignore notification permissions
      }

      try {
        await getUnreadNotificationCount();
      } catch {
        // ignore
      }

      setSharedWith((s) => ({ ...s, [uid]: true }));
      onShared?.(uid);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to share summary"));
    } finally {
      setSharingUserId(null);
    }
  };

  const handleRevoke = async (userId: number | string) => {
    if (!weekStartDate) return;
    const uid = Number(userId);
    try {
      setRevokingUserId(uid);
      await summariesAPI.revokeUserShare(weekStartDate, uid);
      toast.success("Share access revoked for user");
      setSharedWith((s) => {
        const copy = { ...s };
        delete copy[uid];
        return copy;
      });
    } catch {
      toast.error("Failed to revoke share");
    } finally {
      setRevokingUserId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<Users className="size-4.5" />}>
          <DialogTitle>Share Summary with Colleague</DialogTitle>
          <DialogDescription>
            Grant individual view access to this week&apos;s summary report.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, role, or email..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9.5 pl-9 text-xs sm:text-sm"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto rounded-xl border border-border/70 p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin text-[#0d47a1]" />
                Searching team members...
              </div>
            ) : results.length > 0 ? (
              <div className="divide-y divide-border/50">
                {results.map((u) => {
                  const uid = Number(u.id);
                  const isShared = Boolean(sharedWith[uid]);
                  const isSharing = sharingUserId === uid;
                  const isRevoking = revokingUserId === uid;
                  const initials = (u.username || u.email || "U")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <div
                      key={u.id}
                      className="flex items-center justify-between gap-3 py-2 px-2 hover:bg-muted/40 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-xs font-bold text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {u.username}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {u.email}
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isShared ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRevoke(u.id)}
                            disabled={isRevoking}
                            className="h-7 border-rose-500/30 px-2.5 text-xs text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                          >
                            {isRevoking ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <>
                                <UserCheck className="mr-1 size-3" />
                                Revoke
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleShare(u.id)}
                            disabled={isSharing}
                            className="h-7 bg-[#0d47a1] px-2.5 text-xs text-white hover:bg-[#0a3880]"
                          >
                            {isSharing ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <>
                                <UserPlus className="mr-1 size-3" />
                                Share
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : query ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No users found matching &ldquo;{query}&rdquo;
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-xs text-muted-foreground">
                <Search className="mb-2 size-6 text-muted-foreground/60" />
                <p>Type a colleague&apos;s name or email to share</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-2 border-t border-border/60">
          <Button variant="outline" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ShareWithUserModal;
