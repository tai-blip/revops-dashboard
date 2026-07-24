// Completes Google sign-in: exchanges the code server-to-server, verifies the
// account is a momos.com Google account, then sets the signed session cookie.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, ALLOWED_DOMAIN, createSession } from "@/lib/session";

function deny(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:48px;max-width:520px;margin:auto">
     <h2>Sign-in not allowed</h2><p>${message}</p>
     <p><a href="/api/auth/login">Try again with your @${ALLOWED_DOMAIN} account</a></p></body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!clientId || !clientSecret || !authSecret) {
    return new NextResponse("OAuth env vars are not fully configured.", { status: 500 });
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.cookies.get("oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return deny("The sign-in attempt was invalid or expired (state mismatch).");
  }

  const origin = request.nextUrl.origin;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  const token = await tokenRes.json();
  if (!token.id_token) return deny("Google did not confirm the sign-in. Please try again.");

  // The id_token arrived directly from Google over TLS in a confidential-client
  // exchange; decode its payload and validate the claims that matter to us.
  let claims: { aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean };
  try {
    const payload = token.id_token.split(".")[1];
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return deny("Could not read the identity token.");
  }
  const okIss = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (claims.aud !== clientId || !okIss || !claims.exp || claims.exp * 1000 < Date.now()) {
    return deny("The identity token failed validation.");
  }
  const email = (claims.email ?? "").toLowerCase();
  if (!claims.email_verified || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return deny(`This dashboard is restricted to @${ALLOWED_DOMAIN} Google accounts.`);
  }

  const nextPath = request.cookies.get("oauth_next")?.value ?? "/";
  const res = NextResponse.redirect(new URL(nextPath.startsWith("/") ? nextPath : "/", origin));
  const secure = origin.startsWith("https");
  res.cookies.set(SESSION_COOKIE, await createSession(email, authSecret), {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 30 * 86400,
  });
  res.cookies.delete("oauth_state");
  res.cookies.delete("oauth_next");
  return res;
}
