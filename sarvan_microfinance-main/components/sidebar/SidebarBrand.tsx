"use client";

import Image from "next/image";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBrandNames } from "@/app/lib/brand-context";
import { cn } from "@/lib/utils";

interface SidebarBrandProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export function SidebarBrand({ isCollapsed, onToggle }: SidebarBrandProps) {
  const { companyNameShort, companyNameFull, logoVersion } = useBrandNames();
  const suffix = companyNameFull.toLowerCase().startsWith(companyNameShort.toLowerCase())
    ? companyNameFull.slice(companyNameShort.length).trim()
    : companyNameFull;

  return (
    <div
      className={cn(
        "flex min-h-16 items-center border-b border-sidebar-accent bg-sidebar px-4 py-1.5",
        // With the sidebar collapsed, the toggle button is the only child left in this
        // row — `justify-between` has nothing to space it from, so it sticks to the
        // left edge instead of sitting centered in the icon rail. Center it explicitly.
        isCollapsed ? "justify-center" : "justify-between"
      )}
    >
      {!isCollapsed && (
        <div className="flex min-w-0 items-center gap-3">
          {/* Logo circle with yellow ring */}
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-white/10 p-0.5 ring-2 ring-secondary/60">
            <Image
              src={`/api/branding/asset/logo-icon?v=${logoVersion}`}
              alt={companyNameFull}
              fill
              className="object-cover rounded-full"
              unoptimized
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 leading-tight" title={companyNameFull}>
            {/* Sizes come from the theme (--sidebar-brand-font-size /
                --sidebar-fullname-font-size, set in app/layout.tsx). Both
                names wrap onto the next line when they don't fit — never an
                ellipsis — and the header (min-h, not fixed h) grows with them. */}
            <span
              className="break-words font-extrabold text-white tracking-wide"
              style={{ fontSize: 'var(--sidebar-brand-font-size, 18px)' }}
            >
              {companyNameShort}
            </span>
            {suffix && (
              <span
                className="break-words font-medium tracking-widest text-secondary uppercase"
                style={{ fontSize: 'var(--sidebar-fullname-font-size, 10px)' }}
              >
                {suffix}
              </span>
            )}
          </div>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        // Desktop-only icon-rail collapse toggle. On mobile the sidebar is either fully
        // open or fully closed (the X button, or the backdrop) — this control's own
        // `isCollapsed` state drives lg:w-16/lg:w-72, which do nothing below the lg
        // breakpoint, so on mobile it used to just sit there as a second, non-functional
        // "hamburger" next to the real (mobile) X close button.
        className="hidden h-8 w-8 shrink-0 text-white hover:bg-primary/60 lg:flex"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Menu className="h-4 w-4" />
      </Button>
    </div>
  );
}
