import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import Link from "next/link";

import { AppLogo } from "@/components/app-logo";

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <AppLogo />
            <span className="text-xl font-semibold">The Pausefather</span>
          </Link>
          <Link className="text-sm font-medium text-muted-foreground hover:text-foreground" href="/">
            Back to editor
          </Link>
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-7xl items-center gap-8 px-5 py-10 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="max-w-xl">
          <p className="text-sm font-medium text-emerald-700">Save your workspace</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-normal text-balance">
            Sign in without leaving the flow behind.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Keep your transcript, pause plan, exports, billing, and provider keys connected to your account.
          </p>
        </div>

        <div className="flex min-h-[430px] items-center justify-center">
          <ClerkLoading>
            <div className="w-full max-w-[400px] rounded-md border bg-card p-6 shadow-sm">
              <div className="space-y-3 text-center">
                <div className="mx-auto size-10 animate-pulse rounded-md bg-muted" />
                <div className="mx-auto h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="mx-auto h-4 w-56 animate-pulse rounded bg-muted" />
              </div>
              <div className="mt-8 grid grid-cols-3 gap-2">
                <div className="h-9 animate-pulse rounded-md bg-muted" />
                <div className="h-9 animate-pulse rounded-md bg-muted" />
                <div className="h-9 animate-pulse rounded-md bg-muted" />
              </div>
              <div className="mt-7 space-y-3">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
              </div>
            </div>
          </ClerkLoading>
          <ClerkLoaded>
            <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
          </ClerkLoaded>
        </div>
      </section>
    </main>
  );
}
