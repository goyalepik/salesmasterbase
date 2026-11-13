// The Sagepilot write guard (v5 section 1.1). Pure, so tests can prove it. Sagepilot is read-only for this module:
// GET is allowed; POST only to the read endpoints below, which take their filters in a POST body. Anything else
// throws before any request is made.

export class SagepilotError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Read endpoints that Sagepilot only offers as POST (search and list bodies). Nothing else may be POSTed. */
export const POST_READ_ALLOWLIST: ReadonlySet<string> = new Set([
  // Lists tickets ("chats") with filters, sort and cursor in the body. Reads only.
  "/platform-api/v1/chats/list",
  // Lists one ticket's messages, paged with a cursor in the body. Reads only.
  "/platform-api/v1/messages/list",
  // A contact's recent calls (Customer 360). Reads only.
  "/platform-api/v1/customers/recent_calls",
]);

/** Throws unless the request only reads: GET, or POST to an allow-listed read endpoint. */
export function guardRequest(method: string, path: string): void {
  const m = method.toUpperCase();
  if (m === "GET") return;
  if (m === "POST" && POST_READ_ALLOWLIST.has(path)) return;
  throw new SagepilotError(`Blocked: ${m} ${path} would change Sagepilot. This module only reads from Sagepilot.`, 405);
}
