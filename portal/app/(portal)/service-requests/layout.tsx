"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, ClipboardCheck, ClipboardList, type LucideIcon } from "lucide-react";

import { fetchAwaitingCount } from "@/lib/api/service-requests";
import { useMe, type Me } from "@/lib/use-me";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon; shown: (me: Me) => boolean; badge?: boolean };

// Every part of the service request feature is a tab of this section; each
// person sees only the parts they take part in.
const TABS: Tab[] = [
  { href: "/service-requests/requests", label: "Requests", icon: ClipboardList, shown: (me) => Boolean(me.can_view_requests) },
  {
    href: "/service-requests/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    shown: (me) => Boolean(me.can_approve_requests),
    badge: true,
  },
  { href: "/service-requests/clients", label: "Clients", icon: Briefcase, shown: (me) => Boolean(me.can_view_clients) },
];

/**
 * Switches between the parts of Service Requests, in the same segmented style
 * as the portal's other view switchers (Users, Summary files). It only appears
 * when the person has more than one part: a single tab would just repeat the
 * page heading.
 */
function SectionNav({ pathname, tabs, awaiting }: { pathname: string; tabs: Tab[]; awaiting: number }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Service Requests" className="flex">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/60 p-1">
        {tabs.map(({ href, label, icon: Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                active
                  ? "bg-[#0d47a1] text-white shadow-xs hover:bg-[#0a3880]"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
              {badge && awaiting > 0 ? (
                <span
                  className={cn(
                    "ml-0.5 min-w-5 rounded-full px-1.5 py-px text-center text-[11px] tabular-nums leading-4",
                    active ? "bg-white/20 text-white" : "bg-[#0d47a1] text-white",
                  )}
                  aria-label={`${awaiting} waiting`}
                >
                  {awaiting}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function ServiceRequestsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const [awaiting, setAwaiting] = useState(0);
  const tabs = me ? TABS.filter((tab) => tab.shown(me)) : [];
  const approver = Boolean(me?.can_approve_requests);

  useEffect(() => {
    if (!approver) return;
    let cancelled = false;
    fetchAwaitingCount()
      .then((count) => !cancelled && setAwaiting(count))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [approver, pathname]);

  return (
    <div className="space-y-5">
      <SectionNav pathname={pathname} tabs={tabs} awaiting={awaiting} />
      {children}
    </div>
  );
}
