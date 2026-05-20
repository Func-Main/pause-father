import { AudioLines } from "lucide-react";

import { cn } from "@/lib/utils";

export function AppLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-emerald-600 text-white shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="voicemark-logo-gradient absolute inset-y-0 left-0 flex w-[300%]"
      >
        <span className="h-full w-1/3 bg-[url('/voicemark-logo-gradient.jpg')] bg-[length:180%_180%] bg-[position:42%_48%]" />
        <span className="h-full w-1/3 scale-x-[-1] bg-[url('/voicemark-logo-gradient.jpg')] bg-[length:180%_180%] bg-[position:42%_48%]" />
        <span className="h-full w-1/3 bg-[url('/voicemark-logo-gradient.jpg')] bg-[length:180%_180%] bg-[position:42%_48%]" />
      </span>
      <span aria-hidden="true" className="absolute inset-0 bg-black/22" />
      <AudioLines className="relative z-10 size-5" />
    </span>
  );
}
