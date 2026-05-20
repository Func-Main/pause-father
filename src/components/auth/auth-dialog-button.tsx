"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type AuthDialogButtonProps = {
  children: React.ReactNode;
  className?: string;
  mode: "sign-in" | "sign-up";
  variant?: "default" | "outline";
};

export function AuthDialogButton({
  children,
  className,
  mode,
  variant = "default",
}: AuthDialogButtonProps) {
  const clerk = useClerk();
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    if (!isOpening) {
      return;
    }

    const timeout = window.setTimeout(() => setIsOpening(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [isOpening]);

  function openAuthDialog() {
    setIsOpening(true);

    if (mode === "sign-in") {
      clerk.openSignIn({
        fallbackRedirectUrl: "/",
        signUpUrl: "/sign-up",
      });
      return;
    }

    clerk.openSignUp({
      fallbackRedirectUrl: "/",
      signInUrl: "/sign-in",
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={isOpening}
      onClick={openAuthDialog}
    >
      {isOpening ? (
        <>
          <LoaderCircle className="size-4 animate-spin" />
          Opening...
        </>
      ) : (
        children
      )}
    </Button>
  );
}
