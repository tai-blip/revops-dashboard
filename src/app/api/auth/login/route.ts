// Kicks off Google sign-in: redirects to Google's OAuth consent with a CSRF state
// cookie. The callback route completes the flow.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ALLOWED_DOMAIN } from "@/lib/session";

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return new NextResponse("GOOGLE_OAUTH_CLIENT_ID is not configured.", { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const state = crypto.randomUUID();

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email");
  auth.searchParams.set("hd", ALLOWED_DOMAIN); // UI hint; the callback re-verifies the domain
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(auth);
  const secure = origin.startsWith("https");
  res.cookies.set("oauth_state", state, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  res.cookies.set("oauth_next", next.startsWith("/") ? next : "/", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
