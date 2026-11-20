import { Lock, PanelRight, Paperclip, Radio } from "lucide-react";
import type { ReactNode } from "react";

export const metadata = {
  title: "Chat",
};

/** Placeholder until chat ships: what is coming. */
export default function ChatComingSoonPage() {
  return (
    <div className="flex min-h-full items-center justify-center py-6 lg:py-12">
      <section aria-labelledby="chat-soon-heading" className="w-full max-w-xl">
        <h2
          id="chat-soon-heading"
          className="text-center text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl"
        >
          Chat is coming soon.
        </h2>
        <p className="mt-4 text-center text-base leading-relaxed text-balance text-muted-foreground">
          Message any colleague one to one, right where you work, and keep those
          conversations between the two of you.
        </p>

        <ul className="mx-auto mt-10 max-w-md space-y-5">
          <Feature icon={<Lock className="size-4" />} title="Private by design">
            Messages are encrypted on your device. Only you and the person you
            are talking to can read them, not even IT.
          </Feature>
          <Feature
            icon={<Paperclip className="size-4" />}
            title="Photos, videos and files"
          >
            Share up to 25 MB at a time.
          </Feature>
          <Feature icon={<Radio className="size-4" />} title="Live">
            See when someone is online, typing, or has read your message.
          </Feature>
          <Feature
            icon={<PanelRight className="size-4" />}
            title="From any page"
          >
            Open a chat drawer wherever you are, without losing your place.
          </Feature>
        </ul>

        <p className="mt-10 text-center text-sm text-balance text-muted-foreground">
          Nothing to do yet. The first time you open chat, you will choose a
          6-digit chat PIN.
        </p>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/8 text-[#0d47a1] dark:bg-[#38bdf8]/12 dark:text-[#38bdf8]"
        aria-hidden="true"
      >
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">
          {children}
        </span>
      </span>
    </li>
  );
}
