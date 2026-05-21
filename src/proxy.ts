import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware({
  frontendApiProxy: {
    enabled: (url) => !["localhost", "127.0.0.1", "::1"].includes(url.hostname),
  },
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api)(.*)",
    "/__clerk/(.*)",
  ],
};
