"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { fetchSuggestions } from "@/lib/api/service-requests";
import { hasNextPage } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & {
  field: "airline" | "vendor";
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * A text field that offers values used on earlier requests (most used first),
 * so the same airline or vendor is not typed three different ways. Typing
 * anything else is still allowed.
 */
export function SuggestInput({ field, value, onValueChange, className, ...props }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      setQuery(value.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSuggestions(field, query, page)
      .then((data) => {
        if (cancelled) return;
        setOptions((current) => (page === 1 ? data.results : [...current, ...data.results]));
        setHasMore(hasNextPage(data));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [field, query, page, open]);

  const shown = options.filter((option) => option.toLowerCase() !== value.trim().toLowerCase());

  function pick(option: string) {
    onValueChange(option);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <Input
        {...props}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        autoComplete="off"
        className={className}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (!open || !shown.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, shown.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            pick(shown[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && shown.length > 0 ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-md"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (hasMore && list.scrollTop + list.clientHeight >= list.scrollHeight - 24) setPage((current) => current + 1);
          }}
        >
          {shown.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              className={cn(
                "cursor-pointer truncate rounded-md px-2.5 py-1.5",
                index === active ? "bg-muted text-foreground" : "text-foreground hover:bg-muted/60",
              )}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
