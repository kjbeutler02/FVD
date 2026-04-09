interface UserEntry {
  username: string;
  password: string;
}

let cachedUsers: UserEntry[] | null = null;

function getUsers(): UserEntry[] {
  if (cachedUsers) return cachedUsers;

  const raw = process.env.APP_USERS;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    cachedUsers = parsed.filter(
      (u: unknown) =>
        u &&
        typeof u === "object" &&
        typeof (u as UserEntry).username === "string" &&
        typeof (u as UserEntry).password === "string"
    );
    return cachedUsers!;
  } catch {
    console.error("Failed to parse APP_USERS env var");
    return [];
  }
}

export function validateCredentials(
  username: string,
  password: string
): string | null {
  const users = getUsers();
  const match = users.find(
    (u) =>
      u.username.toLowerCase() === username.toLowerCase().trim() &&
      u.password === password
  );
  return match ? match.username : null;
}

export function hasUsersConfigured(): boolean {
  return getUsers().length > 0;
}

/**
 * Create a simple signed cookie value: username:hmac
 * Uses SESSION_SECRET as the signing key.
 */
export async function createAuthCookie(username: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || "dev-secret";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(username)
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${username}:${hex}`;
}

export async function verifyAuthCookie(cookie: string): Promise<string | null> {
  const colonIndex = cookie.indexOf(":");
  if (colonIndex === -1) return null;

  const username = cookie.slice(0, colonIndex);
  const expected = await createAuthCookie(username);
  if (cookie === expected) return username;
  return null;
}
