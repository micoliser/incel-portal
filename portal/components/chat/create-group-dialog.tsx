"use client";

import { ArrowLeft, Camera, Loader2, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/chat/conversation-list";
import { PeoplePicker } from "@/components/chat/people-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type { ChatPerson } from "@/lib/chat/api";
import { prepareProfilePhoto } from "@/lib/profile-photo";

export const MAX_GROUP_MEMBERS = 100;

/** New group: choose people, then name it (and optionally describe it and add a photo). */
export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversationId: string) => void;
}) {
  const { createGroup } = useChat();
  const [step, setStep] = useState<"people" | "details">("people");
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("people");
    setPeople([]);
    setName("");
    setDescription("");
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setError("");
  }

  function close(next: boolean) {
    if (saving) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    try {
      const prepared = await prepareProfilePhoto(file);
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ file: prepared, url: URL.createObjectURL(prepared) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Choose an image file.");
    }
  }

  async function create() {
    if (!name.trim()) {
      setError("Give the group a name.");
      return;
    }
    setSaving(true);
    try {
      const id = await createGroup({ name, description, people, photo: photo?.file ?? null });
      const pending = people.filter((p) => !p.chat_ready).length;
      toast.success(pending ? `Group created. ${pending} invited to set up chat.` : "Group created.");
      setSaving(false);
      onOpenChange(false);
      reset();
      onCreated(id);
    } catch (e) {
      setSaving(false);
      toast.error(extractApiErrorMessage(e, "Could not create the group."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader icon={<Users className="size-4.5" />}>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            {step === "people" ? "Choose who is in the group." : `${people.length + 1} people, including you.`}
          </DialogDescription>
        </DialogHeader>

        {step === "people" ? (
          <>
            <div className="flex min-h-[18rem] flex-1 flex-col">
              <PeoplePicker selected={people} onChange={setPeople} max={MAX_GROUP_MEMBERS - 1} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => setStep("details")} disabled={!people.length}>
                Next
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="group/photo relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0d47a1]"
                aria-label={photo ? "Change the group photo" : "Add a group photo"}
              >
                <Avatar name={name || "Group"} src={photo?.url} size="md" />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100">
                  <Camera className="size-4" aria-hidden="true" />
                </span>
              </button>
              {photo ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                  <X className="size-4" aria-hidden="true" /> Remove photo
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Group photo (optional)</span>
              )}
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
              <Label htmlFor="group-name">
                Group name <span className="text-destructive-text" aria-hidden="true">*</span>
              </Label>
              <Input
                id="group-name"
                value={name}
                maxLength={80}
                required
                aria-required="true"
                autoFocus
                onBlur={() => {
                  if (!name.trim()) setError("Give the group a name.");
                }}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "group-name-error" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError("");
                }}
              />
              {error ? (
                <p id="group-name-error" role="alert" className="text-xs font-medium text-destructive-text">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-description">Description (optional)</Label>
              <Textarea
                id="group-description"
                value={description}
                maxLength={500}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The name, description and photo are encrypted like messages. New members can read messages from when they
              join.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("people")} disabled={saving}>
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Create group
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
