import { env } from '$env/dynamic/private';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export async function getCurrentUser(
  fetcher: typeof fetch,
  cookieHeader: string | null
): Promise<SessionUser | null> {
  if (!cookieHeader) return null;

  const apiUrl = env.API_INTERNAL_URL ?? 'http://localhost:3001';

  try {
    const response = await fetcher(`${apiUrl}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(2_000)
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { user?: SessionUser };
    return payload.user ?? null;
  } catch {
    return null;
  }
}
