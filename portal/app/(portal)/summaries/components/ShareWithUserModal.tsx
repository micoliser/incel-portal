"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  const [sharing, setSharing] = useState(false);
  const [sharedWith, setSharedWith] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!query) return setResults([]);

    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const users = await getUsers({ search: query });
        setResults(users || []);
      } catch (err) {
        console.error(err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [query]);

  // Load existing user-shares for this week when modal opens
  useEffect(() => {
    if (!open || !weekStartDate) return;
    (async () => {
      try {
        const shares = await summariesAPI.getUserShares(weekStartDate);
        const map: Record<number, boolean> = {};
        (shares || []).forEach((s: UserShare) => {
          if (s.shared_with) map[Number(s.shared_with)] = true;
        });
        setSharedWith(map);
      } catch (e) {
        console.warn("Failed to load user shares", e);
      }
    })();
  }, [open, weekStartDate]);

  const handleShare = async (userId: number | string) => {
    if (!weekStartDate) return;
    try {
      setSharing(true);
      const uid = Number(userId);
      console.debug("Sharing payload", {
        week_start_date: weekStartDate,
        user_id: uid,
      });
      const resp = await summariesAPI.shareWithUser(weekStartDate, uid);
      toast.success("Summary shared with user");

      // Show immediate browser notification if permitted and include click-through link
      try {
        if (typeof window !== "undefined" && "Notification" in window) {
          // Use the returned per-user share token/link when available
          const shareLink =
            resp?.share_link ||
            (resp?.share_token ? `/summaries?token=${resp.share_token}` : null);
          const fullUrl = shareLink
            ? `${window.location.origin}${shareLink}`
            : `${window.location.origin}/summaries?id=${weekStartDate}`;
          if (Notification.permission === "granted") {
            const n = new Notification("Summary shared", {
              body: `A weekly summary was shared with you. Click to open the shared summary.`,
              data: { url: fullUrl },
            });
            n.onclick = () => window.open(fullUrl, "_blank");
          } else if (Notification.permission !== "denied") {
            const p = await Notification.requestPermission();
            if (p === "granted") {
              const n = new Notification("Summary shared", {
                body: `A weekly summary was shared with you. Click to open.`,
                data: { url: fullUrl },
              });
              n.onclick = () => window.open(fullUrl, "_blank");
            }
          }
        }
      } catch (e) {
        console.warn("Browser notification failed", e);
      }

      // Optionally refresh unread count (Notification center may poll itself)
      try {
        await getUnreadNotificationCount();
      } catch (e) {
        // ignore
      }

      onShared?.(Number(userId));
      onClose();
    } catch (err) {
      console.error(err);
      toast.error("Failed to share summary");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share Summary with a User</DialogTitle>
          <DialogDescription>
            Search for a user and select them to share this weekly summary.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search users by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full"
          />

          <div className="max-h-56 overflow-y-auto space-y-2">
            {loading && (
              <div className="text-sm text-slate-500">Searching...</div>
            )}
            {!loading && results.length === 0 && query && (
              <div className="text-sm text-slate-500">No users found</div>
            )}
            {!loading &&
              results.map((u) => (
                <div key={u.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{u.username}</div>
                    <div className="text-sm text-slate-500">{u.email}</div>
                  </div>
                  <div className="flex gap-2">
                    {sharedWith[Number(u.id)] ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={async () => {
                          try {
                            setSharing(true);
                            await summariesAPI.revokeUserShare(
                              weekStartDate,
                              Number(u.id),
                            );
                            toast.success("Revoked share for user");
                            setSharedWith((s) => {
                              const copy = { ...s };
                              delete copy[Number(u.id)];
                              return copy;
                            });
                          } catch (e) {
                            console.error(e);
                            toast.error("Failed to revoke share");
                          } finally {
                            setSharing(false);
                          }
                        }}
                        disabled={sharing}
                      >
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleShare(u.id)}
                        disabled={sharing}
                      >
                        Share
                      </Button>
                    )}
                  </div>
                </div>
              ))}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose} size="sm">
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ShareWithUserModal;
