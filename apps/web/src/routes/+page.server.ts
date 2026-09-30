import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { getCurrentUser } from '$lib/server/auth';

type ApiHealth = {
  status: 'ok' | 'degraded';
  version: string;
  database: 'up' | 'down';
  auth?: 'ready';
};

export const load: PageServerLoad = async ({ fetch, request }) => {
  const apiUrl = env.API_INTERNAL_URL ?? 'http://localhost:3001';
  const userPromise = getCurrentUser(fetch, request.headers.get('cookie'));

  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(2_000)
    });

    const result = (await response.json()) as Partial<ApiHealth>;
    const health = response.ok && typeof result.version === 'string' && result.version.length > 0
      ? result as ApiHealth : null;
    return { apiReachable: health !== null, health, user: await userPromise };
  } catch {
    return {
      apiReachable: false,
      health: null,
      user: await userPromise
    };
  }
};
