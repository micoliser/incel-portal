"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon };

// Every part of the service request feature is a tab of this section.
// Requests and approvals join Clients as they are built.
const TABS: Tab[] = [{ href: "/service-requests/clients", label: "Clients", icon: Briefcase }];

/**
 * Switches between the parts of Service Requests, in the same segmented style
 * as the portal's other view switchers (Users, Summary files). It only appears
 * once there is more than one part: a single tab would just repeat the page heading.
 */
function SectionNav({ pathname }: { pathname: string }) {
  if (TABS.length < 2) return null;
  return (
    <nav aria-label="Service Requests" className="flex">
      <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/60 p-1">
        {TABS.map(({ href, label, icon: Icon }) => {
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
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function ServiceRequestsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-5">
      <SectionNav pathname={pathname} />
      {children}
    </div>
  );
}
