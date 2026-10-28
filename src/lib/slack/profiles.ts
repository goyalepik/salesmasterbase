const cache = new Map<string, string | null>();
let profilesBlocked = false;

type UserResponse = {
  ok?: boolean;
  error?: string;
  user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } };
};

function displayName(body: UserResponse): string | null {
  return body.user?.profile?.display_name || body.user?.real_name || body.user?.profile?.real_name || null;
}

async function usersInfo(token: string, userId: string): Promise<UserResponse> {
  const response = await fetch("https://slack.com/api/users.info", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user: userId }),
    signal: AbortSignal.timeout(15000),
  });
  return (await response.json()) as UserResponse;
}

export async function slackProfilesAvailable(token: string): Promise<boolean> {
  if (profilesBlocked) return false;
  const body = await usersInfo(token, "U00000000");
  if (body.error === "missing_scope") {
    profilesBlocked = true;
    return false;
  }
  return true;
}

export async function slackDisplayName(token: string, userId: string): Promise<string | null> {
  if (profilesBlocked) return null;
  if (cache.has(userId)) return cache.get(userId) ?? null;
  const body = await usersInfo(token, userId);
  if (body.error === "missing_scope") {
    profilesBlocked = true;
    return null;
  }
  const name = displayName(body);
  cache.set(userId, name);
  return name;
}
