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
  md: { primary: "text-[1.0625rem]", secondary: "text-[0.5625rem]", gap: "mt-1" },
  lg: { primary: "text-3xl sm:text-4xl", secondary: "text-xs sm:text-sm", gap: "mt-2" },
};

/**
 * Strong & Hanni wordmark, set as type: no logo file has been supplied, so
 * the lockup is the identity. Use `on-blue` over a navy anchor surface and
 * `on-light` on the workspace, paper or white.
 */
export default function Wordmark({
  variant = "on-light",
  size = "md",
  as: Tag = "div",
  className = "",
}: Props) {
  const s = SIZES[size];
  const primaryColor = variant === "on-blue" ? "text-white" : "text-navy";
  const secondaryColor = variant === "on-blue" ? "text-on-navy-soft" : "text-tertiary";

  return (
    <Tag className={`select-none font-sans leading-none ${className}`}>
      <div className={`font-extrabold tracking-[0.08em] ${s.primary} ${primaryColor}`}>
        STRONG <span className="font-medium">&amp;</span> HANNI
      </div>
      <div className={`font-semibold tracking-[0.32em] ${s.secondary} ${s.gap} ${secondaryColor}`}>
        LAW FIRM
      </div>
    </Tag>
  );
}
