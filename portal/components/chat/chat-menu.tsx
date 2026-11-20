"use client";

import { KeyRound, Loader2, Lock, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldError, passwordError } from "@/components/chat/chat-gate";
import { useChat } from "@/components/chat/chat-provider";
import { PinInput } from "@/components/chat/pin-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPassword } from "@/lib/chat/api";
import { lockedUntilFrom, lockoutText, useSecondsLeft } from "@/lib/lockout";

/** Lock chat on this computer, or change the chat PIN. */
export function ChatMenu() {
  const { status, lock } = useChat();
  const [open, setOpen] = useState(false);

  if (status !== "ready") return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Chat settings">
            <Settings2 aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <KeyRound aria-hidden="true" /> Change chat PIN
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void lock()}>
            <Lock aria-hidden="true" /> Lock chat on this computer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<KeyRound className="size-4.5" />}>
            <DialogTitle>Change chat PIN</DialogTitle>
            <DialogDescription>Your messages stay as they are. Use the new PIN next time you unlock chat.</DialogDescription>
          </DialogHeader>
          {open ? <ChangePin onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangePin({ onDone }: { onDone: () => void }) {
  const { changePin, needsPassword } = useChat();
  const [password, setPassword] = useState<string | undefined>();
  const [typedPassword, setTypedPassword] = useState("");
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockSecondsLeft = useSecondsLeft(lockedUntil);
  const locked = lockSecondsLeft > 0;

  if (needsPassword && password === undefined) {
    return (
      <form
        className="space-y-4 py-2"
        noValidate
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await checkPassword(typedPassword);
            setPassword(typedPassword);
          } catch (e) {
            const until = lockedUntilFrom(e);
            if (until) setLockedUntil(until);
            else setError(passwordError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="chat-change-password">Portal password</Label>
          <Input
            id="chat-change-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={typedPassword}
            aria-invalid={Boolean(error) || locked || undefined}
            aria-describedby={error || locked ? "chat-change-password-error" : undefined}
            onChange={(e) => {
              setTypedPassword(e.target.value);
              if (error) setError("");
            }}
          />
          <FieldError id="chat-change-password-error" text={locked ? lockoutText(lockSecondsLeft) : error} />
        </div>
        <Button type="submit" className="w-full" disabled={busy || !typedPassword || locked}>
          Continue
        </Button>
      </form>
    );
  }

  async function complete(pin: string) {
    if (first === null) {
      setFirst(pin);
      setValue("");
      setError("");
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setValue("");
      setError("The PINs did not match. Choose your new PIN again.");
      return;
    }
    setBusy(true);
    try {
      await changePin(pin, password);
      toast.success("Chat PIN changed. Your recovery code still works.");
      onDone();
    } catch (e) {
      setError(e instanceof Error && !("isAxiosError" in e) ? e.message : "Could not change the PIN.");
      setFirst(null);
      setValue("");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 py-4">
      <p className="text-center text-sm font-medium text-foreground">
        {first === null ? "Enter a new 6-digit PIN" : "Enter the new PIN again"}
      </p>
      <PinInput
        key={first === null ? "first" : "confirm"}
        label={first === null ? "New chat PIN, 6 digits" : "Confirm new chat PIN, 6 digits"}
        value={value}
        onChange={(v) => {
          setValue(v);
          if (error) setError("");
        }}
        onComplete={complete}
        invalid={Boolean(error)}
        disabled={busy}
      />
      {busy ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-center text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
