"use client";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A destructive submit that asks first. Native confirm() is used deliberately:
 * it cannot be missed, needs no state, and cannot be dismissed accidentally by
 * a stray click outside a modal.
 */
export function ConfirmSubmit({
  message,
  children,
  ...props
}: ButtonProps & { message: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      {...props}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
