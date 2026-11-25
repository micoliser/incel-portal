"use client";

import axios from "axios";
import { Check, Copy, KeyRound, Loader2, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useChat } from "@/components/chat/chat-provider";
import { PinInput } from "@/components/chat/pin-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPassword, checkResetCode, sendResetCode } from "@/lib/chat/api";
import { normaliseRecoveryCode } from "@/lib/chat/crypto";
import { lockedUntilFrom, lockoutText, useSecondsLeft } from "@/lib/lockout";
import { cn } from "@/lib/utils";

/** Shows set-up, unlock or recovery until chat is ready, then the children. */
export function ChatGate({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const { status } = useChat();
  const [code, setCode] = useState<string | null>(null);

  if (code) {
    return (
      <Panel compact={compact}>
        <RecoveryCodePanel code={code} onDone={() => setCode(null)} />
      </Panel>
    );
  }
  if (status === "loading") {
    return (
      <Panel compact={compact}>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading chat…
        </p>
      </Panel>
    );
  }
  if (status === "error") {
    return (
      <Panel compact={compact}>
        <p className="text-center text-sm text-foreground">Chat could not load. Check your connection and reload the page.</p>
      </Panel>
    );
  }
  if (status === "not_set_up") {
    return (
      <Panel compact={compact}>
        <SetUpFlow onCode={setCode} />
      </Panel>
    );
  }
  if (status === "locked") {
    return (
      <Panel compact={compact}>
        <UnlockFlow onCode={setCode} />
      </Panel>
    );
  }
  return <>{children}</>;
}

function Panel({ children, compact }: { children: ReactNode; compact: boolean }) {
  return (
    <div className={cn("flex h-full w-full justify-center overflow-y-auto", compact ? "p-4" : "p-6 sm:p-10")}>
      <div className="w-full max-w-sm self-center">{children}</div>
    </div>
  );
}

/** The centred heading block every step uses. */
function StepHeading({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col items-center text-center">
      <span className="mb-4 text-[#0d47a1] dark:text-[#38bdf8]" aria-hidden="true">
        {icon}
      </span>
      <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
      {children ? <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

function Message({ text, id }: { text: string; id?: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="mt-5 text-center text-sm text-destructive-text">
      {text}
    </p>
  );
}

/** The server's message for a wrong portal password (it says how many tries are left). */
export function passwordError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { error?: { details?: { password?: string[] } } } | undefined;
    const message = body?.error?.details?.password?.[0];
    if (message) return message;
  }
  return "That is not your portal password.";
}

/** An error under a text field, styled like form errors across the portal. */
export function FieldError({ id, text }: { id: string; text: string }) {
  if (!text) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive-text">
      {text}
    </p>
  );
}

function Working({ label }: { label: string }) {
  return (
    <p className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> {label}
    </p>
  );
}

/** Asks for the portal password (chat's second lock) when this sign-in does not have it. */
function PasswordStep({
  title,
  description,
  onDone,
}: {
  title: string;
  description: string;
  onDone: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const lockSecondsLeft = useSecondsLeft(lockedUntil);
  const locked = lockSecondsLeft > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await checkPassword(password);
      onDone(password);
    } catch (e) {
      const until = lockedUntilFrom(e);
      if (until) setLockedUntil(until);
      else setError(passwordError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <StepHeading icon={<KeyRound className="size-8" />} title={title}>
        <p>{description}</p>
      </StepHeading>
      <div className="space-y-2">
        <Label htmlFor="chat-portal-password">Portal password</Label>
        <Input
          id="chat-portal-password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          aria-invalid={Boolean(error) || locked || undefined}
          aria-describedby={error || locked ? "chat-portal-password-error" : undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError("");
          }}
        />
        <FieldError id="chat-portal-password-error" text={locked ? lockoutText(lockSecondsLeft) : error} />
      </div>
      <Button type="submit" className="mt-5 w-full" disabled={busy || !password || locked}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Continue
      </Button>
    </form>
  );
}

/** Choose a PIN, then type it again. Calls onDone with the confirmed PIN. */
function CreatePin({
  title,
  intro,
  busy,
  error,
  onDone,
}: {
  title: string;
  intro?: ReactNode;
  busy: boolean;
  error: string;
  onDone: (pin: string) => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [mismatch, setMismatch] = useState(false);

  function complete(pin: string) {
    if (first === null) {
      setFirst(pin);
      setValue("");
      setMismatch(false);
      return;
    }
    if (pin !== first) {
      setMismatch(true);
      setFirst(null);
      setValue("");
      return;
    }
    onDone(pin);
  }

  return (
    <div>
      <StepHeading icon={<LockKeyhole className="size-8" />} title={first === null ? title : "Confirm your PIN"}>
        {first === null ? intro ?? <p>Choose 6 digits you will remember.</p> : <p>Enter the same 6 digits again.</p>}
      </StepHeading>
      <PinInput
        key={first === null ? "first" : "confirm"}
        label={first === null ? "New chat PIN, 6 digits" : "Confirm chat PIN, 6 digits"}
        value={value}
        onChange={(v) => {
          setValue(v);
          if (mismatch) setMismatch(false);
        }}
        onComplete={complete}
        invalid={mismatch}
        disabled={busy}
      />
      {busy ? <Working label="Securing your chat…" /> : null}
      <Message text={mismatch ? "The PINs did not match. Choose your PIN again." : error} />
      {first !== null && !busy ? (
        <div className="mt-5 flex justify-center">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              setFirst(null);
              setValue("");
            }}
          >
            Start again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && !("isAxiosError" in error) ? error.message : fallback;
}

function SetUpFlow({ onCode }: { onCode: (code: string) => void }) {
  const { setUp, needsPassword } = useChat();
  const [password, setPassword] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (needsPassword && password === undefined) {
    return (
      <PasswordStep
        title="Set up private chat"
        description="Chat is locked with your portal password and a 6-digit PIN. Confirm your password to begin."
        onDone={setPassword}
      />
    );
  }

  async function finish(pin: string) {
    setBusy(true);
    setError("");
    try {
      onCode(await setUp(pin, password));
    } catch (e) {
      setError(errorText(e, "Chat could not be set up. Try again."));
      setBusy(false);
    }
  }

  return (
    <CreatePin
      title="Create a chat PIN"
      busy={busy}
      error={error}
      onDone={finish}
      intro={
        <>
          <p>Messages and files are encrypted on your device. Nobody else can read them, including IT and portal admins.</p>
          <p>You will enter this PIN once each time you sign in. IT cannot reset it, so you will also get a recovery code.</p>
        </>
      }
    />
  );
}

type UnlockMode = "pin" | "recovery" | "start-over";

function UnlockFlow({ onCode }: { onCode: (code: string) => void }) {
  const { unlock, checkRecoveryCode, recover, needsPassword } = useChat();
  const [mode, setMode] = useState<UnlockMode>("pin");
  const [password, setPassword] = useState<string | undefined>();
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [error, setError] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  function switchTo(next: UnlockMode) {
    setMode(next);
    setPin("");
    setCode("");
    setCodeAccepted(false);
    setError("");
  }

  const askPassword = needsPassword && password === undefined;

  // --- Enter PIN ---------------------------------------------------------
  if (mode === "pin") {
    if (askPassword) {
      return (
        <PasswordStep
          title="Unlock chat"
          description="Enter your portal password, then your chat PIN."
          onDone={setPassword}
        />
      );
    }

    const submitPin = async (value: string) => {
      setBusy(true);
      setError("");
      try {
        await unlock(value, password);
      } catch (e) {
        const message = errorText(e, "Something went wrong. Try again.");
        setError(message);
        setPasswordChanged(message.startsWith("Your portal password has changed"));
        if (message.startsWith("Too many")) setPassword(undefined);
        setPin("");
        setBusy(false);
      }
    };

    return (
      <div>
        <StepHeading icon={<LockKeyhole className="size-8" />} title="Enter your chat PIN">
          <p>Your PIN unlocks your encryption key so your messages can be read on this computer. It is forgotten when you sign out.</p>
        </StepHeading>
        <PinInput
          label="Chat PIN, 6 digits"
          value={pin}
          onChange={(v) => {
            setPin(v);
            if (error && !passwordChanged) setError("");
          }}
          onComplete={submitPin}
          invalid={Boolean(error) && !passwordChanged}
          disabled={busy || passwordChanged}
          describedBy={error ? "chat-pin-error" : undefined}
        />
        {busy ? <Working label="Unlocking…" /> : null}
        <Message id="chat-pin-error" text={error} />
        <div className="mt-6 flex justify-center">
          <Button type="button" variant={passwordChanged ? "default" : "link"} size="sm" onClick={() => switchTo("recovery")}>
            {passwordChanged ? "Use my recovery code" : "Forgot PIN?"}
          </Button>
        </div>
      </div>
    );
  }

  // --- Recovery code, then a new PIN -----------------------------------------
  if (mode === "recovery") {
    if (!codeAccepted) {
      return (
        <form
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (normaliseRecoveryCode(code).replace(/-/g, "").length !== 32) {
              setError("That recovery code is not right. Check it and try again.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              if (await checkRecoveryCode(code)) {
                setCodeAccepted(true);
              } else {
                setError("That recovery code is not right. Check it and try again.");
              }
            } catch (e) {
              setError(errorText(e, "Could not check the code. Try again."));
            } finally {
              setBusy(false);
            }
          }}
        >
          <StepHeading icon={<KeyRound className="size-8" />} title="Use your recovery code">
            <p>Enter the code you saved when you set up chat. You will then choose a new PIN.</p>
          </StepHeading>
          <div className="space-y-2">
            <Label htmlFor="chat-recovery-code">Recovery code</Label>
            <Input
              id="chat-recovery-code"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="font-mono uppercase"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              value={code}
              readOnly={busy}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "chat-recovery-code-error" : undefined}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError("");
              }}
            />
            <FieldError id="chat-recovery-code-error" text={error} />
          </div>
          <Button type="submit" className="mt-5 w-full" disabled={busy || !code.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Checking…" : "Continue"}
          </Button>
          <div className="mt-4 flex flex-col items-center gap-1">
            <Button type="button" variant="link" size="sm" onClick={() => switchTo("pin")}>
              Back to PIN
            </Button>
            <Button type="button" variant="link" size="sm" onClick={() => switchTo("start-over")}>
              Lost the recovery code too?
            </Button>
          </div>
        </form>
      );
    }
    if (askPassword) {
      return (
        <PasswordStep
          title="Confirm your password"
          description="Your new PIN is locked together with your portal password."
          onDone={setPassword}
        />
      );
    }
    return (
      <CreatePin
        title="Choose a new PIN"
        busy={busy}
        error={error}
        onDone={async (newPin) => {
          setBusy(true);
          setError("");
          try {
            onCode(await recover(code, newPin, password));
          } catch (e) {
            const message = errorText(e, "Something went wrong. Try again.");
            setBusy(false);
            if (message.startsWith("That recovery code")) {
              setCodeAccepted(false);
            }
            setError(message);
          }
        }}
      />
    );
  }

  // --- Start over: warning, emailed code, then a new PIN -----------------------
  return <StartOverFlow onCode={onCode} onCancel={() => switchTo("pin")} knownPassword={password} />;
}

const RESET_CODE_LENGTH = 8;
const RESEND_SECONDS = 60;

function normaliseResetCode(value: string) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** The server's message for the code field, or the general one. */
function codeError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { error?: { message?: string; details?: { code?: string[] } } } | undefined;
    return body?.error?.details?.code?.[0] ?? body?.error?.message ?? fallback;
  }
  return errorText(error, fallback);
}

type StartOverStep = "warn" | "code" | "password" | "pin";

function StartOverFlow({
  onCode,
  onCancel,
  knownPassword,
}: {
  onCode: (code: string) => void;
  onCancel: () => void;
  /** Already confirmed on the unlock screen, so it is not asked for twice. */
  knownPassword?: string;
}) {
  const { startOver, needsPassword } = useChat();
  const [step, setStep] = useState<StartOverStep>("warn");
  const [agreed, setAgreed] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState("");
  const [password, setPassword] = useState<string | undefined>(knownPassword);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (!waitSeconds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitSeconds]);

  async function sendCode(again: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const sent = await sendResetCode();
      setSentTo(sent.sent_to);
      if (again) {
        setCode("");
        setNotice("A new code is on its way. Earlier codes no longer work.");
      }
      setStep("code");
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setNow(Date.now());
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        // One was sent under a minute ago: use that one.
        setStep("code");
        setNotice("We sent you a code less than a minute ago. Use that one, or send a new one shortly.");
        setResendAt(Date.now() + RESEND_SECONDS * 1000);
        setNow(Date.now());
      } else {
        setError(codeError(e, "Could not send the code. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "warn") {
    return (
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (agreed) void sendCode(false);
        }}
      >
        <StepHeading icon={<TriangleAlert className="size-8 text-destructive-text" />} title="Reset your chat">
          <p>Only if you have lost both your PIN and your recovery code. This cannot be undone.</p>
        </StepHeading>
        <ul className="space-y-2 rounded-lg border border-destructive-text/30 bg-destructive-text/5 p-3.5 text-sm text-foreground">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive-text" />
            Every message and file from before the reset stays unreadable to you, for good. Nobody, including IT, can bring them back.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive-text" />
            You get a new chat key, a new PIN and a new recovery code.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-destructive-text" />
            The people you chat with keep their copies, and their chats with you show that you reset your chat.
          </li>
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">To confirm it is you, we will email you a code.</p>
        <label className="mt-4 flex items-start gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[#0d47a1]"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (error) setError("");
            }}
          />
          <span>I understand my earlier messages will not be available to me.</span>
        </label>
        <Message text={error} />
        <Button type="submit" variant="destructive" className="mt-5 w-full" disabled={busy || !agreed}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Sending…" : "Email me a code"}
        </Button>
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="link" size="sm" onClick={onCancel}>
            Back to PIN
          </Button>
        </div>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          const typed = normaliseResetCode(code);
          if (typed.length !== RESET_CODE_LENGTH) {
            setError("That code is not right. Check your email and try again.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            await checkResetCode(typed);
            setCode(typed);
            setStep(needsPassword && password === undefined ? "password" : "pin");
          } catch (e) {
            setError(codeError(e, "Could not check the code. Try again."));
          } finally {
            setBusy(false);
          }
        }}
      >
        <StepHeading icon={<Mail className="size-8" />} title="Check your email">
          <p>
            We sent a code to {sentTo ? <strong className="font-medium text-foreground">{sentTo}</strong> : "your email"}. It
            expires in 15 minutes.
          </p>
        </StepHeading>
        <div className="space-y-2">
          <Label htmlFor="chat-reset-code">Reset code</Label>
          <Input
            id="chat-reset-code"
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
            maxLength={12}
            className="text-center font-mono text-lg tracking-[0.3em] uppercase"
            placeholder="XXXXXXXX"
            value={code}
            readOnly={busy}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? "chat-reset-code-error" : notice ? "chat-reset-code-notice" : undefined}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError("");
            }}
          />
          <FieldError id="chat-reset-code-error" text={error} />
          {notice && !error ? (
            <p id="chat-reset-code-notice" role="status" className="text-xs text-muted-foreground">
              {notice}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="mt-5 w-full" disabled={busy || !normaliseResetCode(code)}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? "Checking…" : "Continue"}
        </Button>
        <div className="mt-4 flex flex-col items-center gap-1">
          <Button type="button" variant="link" size="sm" disabled={busy || waitSeconds > 0} onClick={() => void sendCode(true)}>
            {waitSeconds > 0 ? `Send a new code in ${waitSeconds}s` : "Send a new code"}
          </Button>
          <Button type="button" variant="link" size="sm" onClick={onCancel}>
            Cancel and go back to PIN
          </Button>
        </div>
      </form>
    );
  }

  if (step === "password") {
    return (
      <PasswordStep
        title="Confirm your password"
        description="Your new PIN is locked together with your portal password."
        onDone={(value) => {
          setPassword(value);
          setStep("pin");
        }}
      />
    );
  }

  return (
    <CreatePin
      title="Choose a new PIN"
      busy={busy}
      error={error}
      onDone={async (newPin) => {
        setBusy(true);
        setError("");
        try {
          onCode(await startOver(newPin, code, password));
        } catch (e) {
          setBusy(false);
          if (axios.isAxiosError(e) && e.response?.status === 400) {
            // The code expired or was replaced while choosing the PIN.
            setStep("code");
            setCode("");
            setError(codeError(e, "That code no longer works. Send a new one."));
            return;
          }
          setError(errorText(e, "Something went wrong. Try again."));
        }
      }}
    />
  );
}

function RecoveryCodePanel({ code, onDone }: { code: string; onDone: () => void }) {
  const lastGroup = code.split("-").at(-1) ?? "";
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function finish(event: FormEvent) {
    event.preventDefault();
    if (normaliseRecoveryCode(typed) !== lastGroup) {
      setError("That does not match the last group of your code.");
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={finish} noValidate>
      <StepHeading icon={<ShieldCheck className="size-8 text-success-text" />} title="Save your recovery code">
        <p>
          If you forget your PIN, or your portal password is reset, this code is the only way back into your messages. Write it down or keep it in
          a password manager. It is not shown again.
        </p>
      </StepHeading>
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <p className="break-all text-center font-mono text-base font-semibold tracking-wider text-foreground" aria-label={`Recovery code ${code.split("").join(" ")}`}>
          {code}
        </p>
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        <Label htmlFor="recovery-check">Type the last four characters to confirm you saved it</Label>
        <Input
          id="recovery-check"
          autoComplete="off"
          spellCheck={false}
          maxLength={4}
          className="w-28 font-mono uppercase"
          value={typed}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "recovery-check-error" : undefined}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError("");
          }}
        />
        <FieldError id="recovery-check-error" text={error} />
      </div>
      <Button type="submit" className="mt-5 w-full">
        I have saved it
      </Button>
    </form>
  );
}
