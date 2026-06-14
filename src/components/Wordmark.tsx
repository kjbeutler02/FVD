import type { JSX } from "react";

type Variant = "on-blue" | "on-light";
type Size = "sm" | "md" | "lg";

interface Props {
  variant?: Variant;
  size?: Size;
  as?: keyof JSX.IntrinsicElements;
  className?: string;
}

const SIZES: Record<Size, { primary: string; secondary: string; gap: string }> = {
  sm: { primary: "text-sm", secondary: "text-[0.5rem]", gap: "mt-0.5" },
  md: { primary: "text-lg", secondary: "text-[0.625rem]", gap: "mt-1" },
  lg: { primary: "text-3xl sm:text-4xl", secondary: "text-xs sm:text-sm", gap: "mt-2" },
};

/**
 * Strong & Hanni wordmark lockup, recreated in type per the brand guide.
 * No symbol; the wordmark is the identity. Use `on-blue` over the deep-blue
 * band, `on-light` on white / canvas.
 */
export default function Wordmark({
  variant = "on-light",
  size = "md",
  as: Tag = "div",
  className = "",
}: Props) {
  const s = SIZES[size];
  const primaryColor = variant === "on-blue" ? "text-white" : "text-brand";
  const secondaryColor = variant === "on-blue" ? "text-white/70" : "text-muted";

  return (
    <Tag className={`font-sans leading-none select-none ${className}`}>
      <div className={`font-bold tracking-[0.08em] ${s.primary} ${primaryColor}`}>
        STRONG <span className="font-medium">&amp;</span> HANNI
      </div>
      <div
        className={`font-medium tracking-[0.32em] ${s.secondary} ${s.gap} ${secondaryColor}`}
      >
        LAW FIRM
      </div>
    </Tag>
  );
}
