// Signed session cookie helpers (HMAC-SHA256 via Web Crypto — works in both the
// proxy/edge runtime and Node route handlers). Cookie value: base64url(payload).sig
// where payload = { e: email, x: expiry ms }.

export const SESSION_COOKIE = "momos_session";
export const ALLOWED_DOMAIN = "momos.com";
const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

export async function createSession(email: string, secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 86400000 })));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(cookie: string | undefined, secret: string): Promise<string | null> {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expect = await hmac(payload, secret);
  // constant-time-ish compare
  if (sig.length !== expect.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const { e, x } = JSON.parse(b64urlDecode(payload));
    if (typeof e !== "string" || typeof x !== "number" || Date.now() > x) return null;
    if (!e.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) return null;
    return e;
  } catch {
    return null;
  }
}

// Auth is enforced on the production deployment (the team-facing URL) and when
// explicitly forced (local testing). Previews/local stay open — they're behind
// Vercel's own deployment protection instead.
export function authEnforced(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.FORCE_AUTH === "1";
}
