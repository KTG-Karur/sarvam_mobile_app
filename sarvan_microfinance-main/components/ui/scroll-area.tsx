"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * When true, limits the max height and enables scrolling.
   */
  scrollY?: boolean
}

function ScrollArea({
  className,
  children,
  scrollY = true,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "relative",
        scrollY && "max-h-full overflow-y-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { ScrollArea }



