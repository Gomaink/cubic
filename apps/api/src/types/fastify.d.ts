import 'fastify';
import type { SessionIdentity } from '../security/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionIdentity | null;
  }
}
