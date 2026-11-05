import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1.5 text-base text-foreground shadow-[0_1px_2px_rgba(9,9,11,0.03)] transition-[color,border-color,box-shadow] duration-150 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 focus-visible:border-[#0d47a1] focus-visible:ring-3 focus-visible:ring-[#0d47a1]/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[#dc2626] aria-invalid:ring-3 aria-invalid:ring-[#dc2626]/20 md:text-sm dark:bg-card dark:focus-visible:border-[#0d47a1] dark:aria-invalid:border-[#dc2626]/70",
        className
      )}
      {...props}
    />
  )
}

export { Input }
