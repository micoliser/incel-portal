"use client";

import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/chat/conversation-list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  prepareProfilePhoto,
  removeProfilePhoto,
  uploadProfilePhoto,
} from "@/lib/profile-photo";

/**
 * Choose, change or remove your profile picture. A chosen picture is only
 * previewed; it is uploaded when Upload is pressed. `onSaved` gets the
 * updated user from the API.
 */
export function ProfilePhotoDialog<T>({
  open,
  onOpenChange,
  name,
  avatarUrl,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  avatarUrl: string | null | undefined;
  onSaved: (user: T) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The chosen picture, cropped and shrunk, waiting for Upload.
  const [chosen, setChosen] = useState<{ photo: File; url: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  function discard() {
    setChosen((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function finish() {
    onOpenChange(false);
    discard();
  }

  function close(next: boolean) {
    if (busy) return; // not while saving
    if (next) onOpenChange(true);
    else finish();
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    let photo: File;
    try {
      photo = await prepareProfilePhoto(file);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Choose an image file.",
      );
      return;
    }
    discard();
    setChosen({ photo, url: URL.createObjectURL(photo) });
  }

  async function upload() {
    if (!chosen) return;
    setBusy("upload");
    try {
      onSaved(await uploadProfilePhoto<T>(chosen.photo));
      toast.success("Profile picture updated.");
      setBusy(null);
      finish();
    } catch (error) {
      toast.error(
        extractApiErrorMessage(
          error,
          "Could not upload the picture. Try again.",
        ),
      );
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      onSaved(await removeProfilePhoto<T>());
      toast.success("Profile picture removed.");
      setBusy(null);
      finish();
    } catch (error) {
      toast.error(
        extractApiErrorMessage(error, "Could not remove the picture."),
      );
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader icon={<Camera className="size-4.5" />}>
          <DialogTitle>Profile picture</DialogTitle>
          <DialogDescription>Upload a profile photo</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2 py-3">
          <span className="relative">
            <Avatar name={name} src={chosen?.url ?? avatarUrl} size="lg" />
            {busy === "upload" ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white">
                <Loader2
                  className="size-6 animate-spin"
                  aria-label="Uploading"
                />
              </span>
            ) : null}
          </span>
          {chosen ? (
            <p className="text-xs text-muted-foreground" role="status">
              Preview. Choose Upload to use this picture.
            </p>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Choose a picture"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <DialogFooter className="gap-2 sm:justify-center">
          {chosen ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={Boolean(busy)}
              >
                <Camera className="size-4" aria-hidden="true" />
                Choose another
              </Button>
              <Button
                type="button"
                onClick={() => void upload()}
                disabled={Boolean(busy)}
              >
                {busy === "upload" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                Upload
              </Button>
            </>
          ) : (
            <>
              {avatarUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void remove()}
                  disabled={Boolean(busy)}
                >
                  {busy === "remove" ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                  Remove
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={Boolean(busy)}
              >
                <Camera className="size-4" aria-hidden="true" />
                {avatarUrl ? "Change picture" : "Choose a picture"}
              </Button>
            </>
          )}
        </DialogFooter>
        <p className="text-center text-xs text-muted-foreground">
          JPEG, PNG, WebP or another image. It is cropped to a square.
        </p>
      </DialogContent>
    </Dialog>
  );
}
