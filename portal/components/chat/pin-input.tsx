"use client";

import { useEffect, useId, useRef, useState } from "react";

import { PIN_LENGTH } from "@/lib/chat/crypto";
import { cn } from "@/lib/utils";

/**
 * A row of circles for the chat PIN. One real (password) input sits over the
 * circles, so typing, pasting, mobile number pads and screen readers all work;
 * the circles only show how many digits are in and which comes next.
 */
export function PinInput({
  label,
  value,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
  autoFocus = true,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus && !disabled) inputRef.current?.focus();
  }, [autoFocus, disabled]);

  return (
    <div className="flex flex-col items-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className={cn("relative", invalid && "motion-safe:animate-[pin-shake_0.35s_ease-in-out]")}>
        <div className="flex gap-3 sm:gap-4" aria-hidden="true">
          {Array.from({ length: PIN_LENGTH }, (_, index) => {
            const filled = index < value.length;
            const next = focused && index === Math.min(value.length, PIN_LENGTH - 1) && !filled;
            return (
              <span
                key={index}
                className={cn(
                  "flex size-11 items-center justify-center rounded-full border-2 transition-colors duration-150 sm:size-12",
                  invalid
                    ? "border-destructive-text"
                    : next
                      ? "border-[#0d47a1] dark:border-[#38bdf8]"
                      : filled
                        ? "border-foreground/70"
                        : "border-border",
                )}
              >
                {filled ? <span className="size-3 rounded-full bg-foreground" /> : null}
              </span>
            );
          })}
        </div>
        <input
          ref={inputRef}
          id={id}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
            onChange(digits);
            if (digits.length === PIN_LENGTH) onComplete?.(digits);
          }}
          className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0 disabled:cursor-default"
        />
      </div>
    </div>
  );
}
