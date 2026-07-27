// Auth gate (Next 16 "proxy" — the renamed middleware convention).
// On the production deployment every page and the dashboard data API require a
// valid Momos session cookie; anyone without one is bounced to Google sign-in.
// Previews/local are exempt (they sit behind Vercel's own deployment protection).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, authEnforced } from "@/lib/session";

export async function proxy(request: NextRequest) {
  if (!authEnforced()) return NextResponse.next();

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Misconfiguration must fail CLOSED on a revenue dashboard, never open.
    return new NextResponse("Auth is enforced but AUTH_SECRET is not set.", { status: 500 });
  }

  const email = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  if (email) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const login = new URL("/api/auth/login", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except static assets and the auth endpoints themselves.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|svg|ico)$).*)"],
};
