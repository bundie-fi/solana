"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "predict" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  // Earn Gold — default, used everywhere strategy-backing is the action.
  primary:
    "bg-earn-gold text-[#0a0a0f] hover:bg-gold-400 active:bg-gold-600 font-semibold focus-gold",
  // Predict Purple — used on prediction-market CTAs.
  predict:
    "bg-predict-purple text-white hover:bg-purple-500 active:bg-purple-600 font-semibold focus-purple",
  // Kept for backward compatibility with existing /markets and /portfolio calls.
  secondary:
    "bg-predict-purple text-white hover:bg-purple-500 active:bg-purple-600 font-semibold focus-purple",
  ghost:
    "bg-transparent text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 border border-neutral-300 hover:border-neutral-400 focus-gold",
  destructive:
    "bg-danger-500 text-white hover:bg-danger-400 font-semibold focus-gold",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-md",
  md: "h-10 md:h-10 px-4 text-sm rounded-lg",
  lg: "h-12 px-5 text-base rounded-lg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          "inline-flex items-center justify-center gap-2 transition-colors duration-180 ease-out-quick",
          "disabled:opacity-50 disabled:pointer-events-none",
          // Apple HIG 44px min tap target on mobile
          "min-h-[44px] md:min-h-0",
          sizeStyles[size],
          variantStyles[variant],
          className,
        ].join(" ")}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
