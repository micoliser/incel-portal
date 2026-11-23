"use client";

import { ArrowLeft, Camera, Crown, Loader2, LogOut, MoreHorizontal, Pencil, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useChat, type ChatConversation } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { MAX_GROUP_MEMBERS } from "@/components/chat/create-group-dialog";
import { PeoplePicker } from "@/components/chat/people-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type { ChatPerson, Participant } from "@/lib/chat/api";
import { prepareProfilePhoto } from "@/lib/profile-photo";

type View = "info" | "edit" | "add" | "leave" | { remove: Participant } | { transfer: Participant };

const RANK = { owner: 2, admin: 1, member: 0 } as const;

/** Group details, members and admin tools, opened from the group's header. */
export function GroupInfoDialog({
  conversation,
  open,
  onOpenChange,
}: {
  conversation: ChatConversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { userId, updateGroup, addGroupMembers, removeGroupMember, leaveGroup, setGroupAdmin, transferOwnership } =
    useChat();
  // Leaving as owner: who takes over (the longest-standing admin is suggested).
  const [heir, setHeir] = useState<number | null>(null);
  const [view, setView] = useState<View>("info");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null | undefined>(undefined);
  const [adding, setAdding] = useState<ChatPerson[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const members = [...conversation.members].sort(
    (a, b) =>
      Number(b.id === userId) - Number(a.id === userId) ||
      RANK[b.role ?? "member"] - RANK[a.role ?? "member"] ||
      a.name.localeCompare(b.name),
  );
  const admin = conversation.isAdmin;
  const owner = conversation.isOwner;
  // Who could take over from the owner: people who have joined, admins first, longest-standing first.
  const successors = conversation.members
    .filter((m) => m.id !== userId && !m.pending)
    .sort(
      (a, b) =>
        RANK[b.role ?? "member"] - RANK[a.role ?? "member"] ||
        new Date(a.joined_at ?? 0).getTime() - new Date(b.joined_at ?? 0).getTime(),
    );

  /** What you may do to someone: the owner manages everyone; admins manage members only. */
  function canManage(member: Participant) {
    if (member.id === userId || member.role === "owner") return false;
    return owner || (admin && member.role !== "admin");
  }

  function go(next: View) {
    setView(next);
    if (next === "edit") {
      setName(conversation.group?.name ?? conversation.title);
      setDescription(conversation.group?.description ?? "");
      setPhoto(undefined);
    }
    if (next === "add") setAdding([]);
    if (next === "leave") setHeir(successors[0]?.id ?? null);
  }

  function close(next: boolean) {
    if (busy) return;
    onOpenChange(next);
    if (!next) setView("info");
  }

  async function run(action: () => Promise<void>, done: string, failure: string, after: View | "close" = "info") {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setBusy(false);
      if (after === "close") close(false);
      else setView(after);
    } catch (error) {
      setBusy(false);
      toast.error(extractApiErrorMessage(error, failure));
    }
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await prepareProfilePhoto(file);
      setPhoto({ file: prepared, url: URL.createObjectURL(prepared) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Choose an image file.");
    }
  }

  const shownPhoto = photo === undefined ? conversation.photoUrl : (photo?.url ?? null);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-md">
        {view === "info" ? (
          <>
            <DialogHeader icon={<Users className="size-4.5" />}>
              <DialogTitle>Group info</DialogTitle>
              <DialogDescription>
                {conversation.members.length} {conversation.members.length === 1 ? "member" : "members"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 text-center">
              <Avatar name={conversation.title} src={conversation.photoUrl} size="lg" />
              <p className="text-lg font-semibold text-foreground">{conversation.title}</p>
              {conversation.group?.description ? (
                <p className="max-w-sm text-sm whitespace-pre-wrap text-muted-foreground">{conversation.group.description}</p>
              ) : null}
              {admin ? (
                <Button type="button" variant="outline" size="sm" onClick={() => go("edit")}>
                  <Pencil className="size-3.5" aria-hidden="true" /> Edit details
                </Button>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Members</h3>
                {admin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => go("add")}
                    disabled={conversation.members.length >= MAX_GROUP_MEMBERS}
                  >
                    <UserPlus className="size-4" aria-hidden="true" /> Add people
                  </Button>
                ) : null}
              </div>
              <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto" aria-label="Members">
                {members.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                    <Avatar name={member.name} src={member.avatar_url} online={member.online} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {member.id === userId ? "You" : member.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {member.pending ? "Invited · has not set up chat yet" : (member.department ?? member.email)}
                      </span>
                    </span>
                    {member.role === "owner" ? (
                      <span className="flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
                        <Crown className="size-3" aria-hidden="true" /> Owner
                      </span>
                    ) : member.role === "admin" ? (
                      <span className="flex items-center gap-1 rounded-full bg-[#0d47a1]/10 px-2 py-0.5 text-[11px] font-semibold text-[#0d47a1] dark:bg-[#38bdf8]/15 dark:text-[#38bdf8]">
                        <ShieldCheck className="size-3" aria-hidden="true" /> Admin
                      </span>
                    ) : null}
                    {canManage(member) ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Options for ${member.name}`} disabled={busy}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!member.pending && (member.role !== "admin" || owner) ? (
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(
                                  () => setGroupAdmin(conversation.id, member.id, member.role !== "admin"),
                                  member.role === "admin" ? `${member.name} is no longer an admin.` : `${member.name} is now an admin.`,
                                  "Could not change their role.",
                                )
                              }
                            >
                              <ShieldCheck aria-hidden="true" /> {member.role === "admin" ? "Remove as admin" : "Make admin"}
                            </DropdownMenuItem>
                          ) : null}
                          {owner && !member.pending ? (
                            <DropdownMenuItem onSelect={() => window.setTimeout(() => setView({ transfer: member }), 0)}>
                              <Crown aria-hidden="true" /> Make group owner
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            className="text-destructive-text focus:text-destructive-text"
                            onSelect={() => window.setTimeout(() => setView({ remove: member }), 0)}
                          >
                            <X aria-hidden="true" /> Remove from group
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" className="text-destructive-text hover:text-destructive-text" onClick={() => go("leave")}>
                <LogOut className="size-4" aria-hidden="true" /> Leave group
              </Button>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : view === "edit" ? (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              void run(
                () => updateGroup(conversation.id, { name, description, ...(photo !== undefined ? { photo: photo?.file ?? null } : {}) }),
                "Group details saved.",
                "Could not save the group details.",
              );
            }}
          >
            <DialogHeader icon={<Pencil className="size-4.5" />}>
              <DialogTitle>Edit group</DialogTitle>
              <DialogDescription>Everyone in the group sees the changes.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="group/photo relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d47a1]"
                aria-label="Change the group photo"
              >
                <Avatar name={name || conversation.title} src={shownPhoto} size="md" />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100">
                  <Camera className="size-4" aria-hidden="true" />
                </span>
              </button>
              {shownPhoto ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                  <X className="size-4" aria-hidden="true" /> Remove photo
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void choosePhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group-name">
                Group name <span className="text-destructive-text" aria-hidden="true">*</span>
              </Label>
              <Input
                id="edit-group-name"
                value={name}
                maxLength={80}
                required
                aria-required="true"
                autoFocus
                aria-invalid={!name.trim() || undefined}
                onChange={(e) => setName(e.target.value)}
              />
              {!name.trim() ? <p className="text-xs font-medium text-destructive-text">A group needs a name.</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group-description">Description</Label>
              <Textarea
                id="edit-group-description"
                value={description}
                maxLength={500}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => go("info")} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        ) : view === "add" ? (
          <>
            <DialogHeader icon={<UserPlus className="size-4.5" />}>
              <DialogTitle>Add people</DialogTitle>
              <DialogDescription>They can read messages from now on, not earlier ones.</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-[18rem] flex-1 flex-col">
              <PeoplePicker
                selected={adding}
                onChange={setAdding}
                exclude={conversation.members.map((m) => m.id)}
                max={MAX_GROUP_MEMBERS - conversation.members.length}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => go("info")} disabled={busy}>
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </Button>
              <Button
                type="button"
                disabled={busy || !adding.length}
                onClick={() =>
                  void run(
                    () => addGroupMembers(conversation.id, adding),
                    adding.length === 1 ? `${adding[0].name} added.` : `${adding.length} people added.`,
                    "Could not add them.",
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Add {adding.length ? adding.length : ""}
              </Button>
            </DialogFooter>
          </>
        ) : view === "leave" ? (
          <>
            <DialogHeader icon={<LogOut className="size-4.5" />}>
              <DialogTitle>Leave {conversation.title}?</DialogTitle>
              <DialogDescription>
                You will no longer see this group or its messages. An admin can add you again.
                {owner && successors.length ? " You own this group, so choose who takes over." : ""}
              </DialogDescription>
            </DialogHeader>
            {owner && successors.length ? (
              <fieldset className="min-h-0 flex-1 overflow-y-auto">
                <legend className="mb-1.5 text-sm font-semibold text-foreground">New owner</legend>
                <ul className="space-y-0.5">
                  {successors.map((member) => (
                    <li key={member.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-muted">
                        <input
                          type="radio"
                          name="new-owner"
                          className="size-4 accent-[#0d47a1]"
                          checked={heir === member.id}
                          onChange={() => setHeir(member.id)}
                        />
                        <Avatar name={member.name} src={member.avatar_url} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{member.name}</span>
                        {member.role === "admin" ? <span className="text-xs text-muted-foreground">Admin</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => go("info")} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => {
                      // Hand over first, so the group keeps the owner you chose.
                      if (owner && heir !== null) await transferOwnership(conversation.id, heir);
                      await leaveGroup(conversation.id);
                    },
                    "You left the group.",
                    "Could not leave the group.",
                    "close",
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Leave group
              </Button>
            </DialogFooter>
          </>
        ) : "transfer" in view ? (
          <>
            <DialogHeader icon={<Crown className="size-4.5" />}>
              <DialogTitle>Make {view.transfer.name} the group owner?</DialogTitle>
              <DialogDescription>
                They will be able to manage everyone, including admins, and cannot be removed. You stay an admin.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => go("info")} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => transferOwnership(conversation.id, view.transfer.id),
                    `${view.transfer.name} is now the group owner.`,
                    "Could not hand over the group.",
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Make owner
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader icon={<X className="size-4.5" />}>
              <DialogTitle>Remove {view.remove.name}?</DialogTitle>
              <DialogDescription>They will no longer see this group or its messages.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => go("info")} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => removeGroupMember(conversation.id, view.remove.id),
                    `${view.remove.name} removed.`,
                    "Could not remove them.",
                  )
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Remove
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
