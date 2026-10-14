import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-[linear-gradient(135deg,var(--primary),var(--signal-violet))] text-primary-foreground shadow-[0_8px_28px_rgba(139,92,246,0.2)] hover:brightness-110",
        secondary: "border border-border-strong bg-card text-foreground hover:bg-card-hover",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        danger: "border border-transparent bg-danger-soft text-danger hover:bg-danger hover:text-background",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-11 px-3 text-[13px]",
        md: "h-11 px-4",
        lg: "h-12 px-5",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
