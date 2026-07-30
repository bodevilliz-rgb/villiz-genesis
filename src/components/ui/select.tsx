import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Native select, styled.
 *
 * Decision: the platform's forms are submitted as FormData to Server Actions.
 * A native select posts its value without a hidden-input bridge, is fully
 * accessible for free, and opens instantly on every device. A Radix listbox
 * would add weight and a controlled-state dance for no operator benefit here.
 */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none rounded-md border border-border bg-input px-3 pr-9 text-sm text-foreground shadow-sm transition-colors",
          "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
      />
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
