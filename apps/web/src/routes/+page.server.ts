import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

type ApiHealth = {
  status: 'ok' | 'degraded';
  version: string;
  database: 'up' | 'down';
};

export const load: PageServerLoad = async ({ fetch }) => {
  const apiUrl = env.API_INTERNAL_URL ?? 'http://localhost:3001';

  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(2_000)
    });

    const health = (await response.json()) as ApiHealth;
    return { apiReachable: response.ok, health };
  } catch {
    return {
      apiReachable: false,
      health: null
    };
  }
};
