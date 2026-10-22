import React from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";

interface LogoProps {
    isCollapsed: boolean;
}

/**
 * Brand mark: a rounded square in the SkillCat orange with a geometric
 * "notes + waveform" glyph in currentColor (1.5px strokes, no emoji).
 */
export function BrandMark({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="sc-mark-fill" cx="30%" cy="25%" r="90%">
          <stop offset="0%" stopColor="#F05523" />
          <stop offset="100%" stopColor="#C43A12" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#sc-mark-fill)" />
      <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* note lines */}
        <path d="M11 13.5h12" />
        <path d="M11 19.5h8" />
        <path d="M11 25.5h6" />
        {/* waveform */}
        <path d="M21 25.5v-3" />
        <path d="M24.5 27.5v-7" />
        <path d="M28 29v-10" />
      </g>
    </svg>
  );
}

const Logo = React.forwardRef<HTMLButtonElement, LogoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button
          ref={ref}
          title={APP_NAME}
          className={`flex items-center gap-2 cursor-pointer bg-transparent border-none p-0 hover:opacity-85 transition-opacity ${isCollapsed ? "justify-center" : "justify-start"}`}
        >
          <BrandMark size={isCollapsed ? 28 : 22} />
          {!isCollapsed && (
            <span className="text-sm font-semibold text-gray-900 tracking-tight">{APP_SHORT_NAME}</span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About {APP_NAME}</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Logo.displayName = "Logo";

export default Logo;
