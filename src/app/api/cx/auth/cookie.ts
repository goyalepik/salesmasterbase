/** The session cookie: not readable by page scripts, sent only to this site, a week long. */
export function sessionCookie(maxAge = 7 * 86_400) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}
