import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "border-[#0d47a1]/20 bg-[#0d47a1]/10 text-[#0d47a1] dark:border-[#0d47a1]/40 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] [a]:hover:bg-[#0d47a1]/20",
        solid:
          "border-transparent bg-[#0d47a1] text-white [a]:hover:bg-[#0a3880]",
        secondary:
          "border-border bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        success:
          "border-[#16a34a]/25 bg-[#16a34a]/10 text-[#16a34a] dark:border-[#16a34a]/40 dark:bg-[#16a34a]/20 dark:text-[#4ade80]",
        destructive:
          "border-[#dc2626]/25 bg-[#dc2626]/10 text-[#dc2626] focus-visible:ring-destructive/20 dark:border-[#dc2626]/40 dark:bg-[#dc2626]/20 dark:text-[#f87171] [a]:hover:bg-[#dc2626]/20",
        warning:
          "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300",
        outline:
          "border-border bg-card text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "border-transparent hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "border-transparent text-[#0d47a1] underline-offset-4 hover:underline dark:text-[#38bdf8]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
