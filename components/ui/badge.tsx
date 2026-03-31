import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/95",
        secondary:
          "border-[var(--shell-border-subtle)] bg-[var(--shell-panel-muted)] text-[var(--shell-text-muted)] [a&]:hover:border-[var(--shell-border-strong)] [a&]:hover:text-[var(--shell-text-strong)]",
        destructive: "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90",
        outline:
          "border-[var(--shell-border-subtle)] text-[var(--shell-text-muted)] [a&]:hover:border-[var(--shell-border-strong)] [a&]:hover:bg-accent [a&]:hover:text-[var(--shell-text-strong)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
