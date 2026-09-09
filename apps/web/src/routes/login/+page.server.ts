import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCurrentUser } from '$lib/server/auth';

export const load: PageServerLoad = async ({ fetch, request }) => {
  const user = await getCurrentUser(fetch, request.headers.get('cookie'));
  if (user) redirect(303, '/app');
  return {};
};
