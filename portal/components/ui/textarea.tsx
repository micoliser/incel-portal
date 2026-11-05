import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground shadow-[0_1px_2px_rgba(9,9,11,0.03)] transition-[color,border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/80 focus-visible:border-[#0d47a1] focus-visible:ring-3 focus-visible:ring-[#0d47a1]/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[#dc2626] aria-invalid:ring-3 aria-invalid:ring-[#dc2626]/20 md:text-sm dark:bg-card dark:focus-visible:border-[#0d47a1] dark:aria-invalid:border-[#dc2626]/70",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
