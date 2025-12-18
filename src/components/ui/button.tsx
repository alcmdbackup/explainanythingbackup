import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-page text-sm font-ui font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary: Gold gradient with warm shadow
        default:
          "bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] text-[var(--text-on-primary)] shadow-warm hover:shadow-warm-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-page",
        // Destructive: Terracotta/rust tones
        destructive:
          "bg-destructive text-[var(--text-on-primary)] shadow-warm hover:bg-destructive/90 hover:shadow-warm-md",
        // Outline: Elegant bordered style
        outline:
          "border border-[var(--border-strong)] bg-[var(--surface-secondary)] text-[var(--text-primary)] shadow-warm-sm hover:border-[var(--accent-gold)] hover:bg-[var(--surface-elevated)] hover:shadow-warm",
        // Secondary: Muted scholarly look
        secondary:
          "bg-[var(--surface-elevated)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-copper)]",
        // Ghost: Minimal, text-like
        ghost:
          "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent-gold)]",
        // Link: Gold underline style
        link:
          "text-[var(--link)] underline-offset-4 hover:text-[var(--link-hover)] hover:underline",
        // Scholar Primary: Extra elegant gold button
        scholar:
          "bg-gradient-to-r from-[var(--accent-gold)] via-[var(--accent-copper)] to-[var(--accent-gold)] bg-[length:200%_100%] text-[var(--text-on-primary)] shadow-warm-md hover:bg-[position:100%_0] hover:shadow-warm-lg hover:-translate-y-0.5 transition-all duration-300",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-8 rounded-page px-3 text-xs",
        lg: "h-11 rounded-book px-8 text-base",
        icon: "h-10 w-10 rounded-page",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
