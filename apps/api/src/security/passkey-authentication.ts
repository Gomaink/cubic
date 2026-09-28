import { createHash } from 'node:crypto';
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Database } from '@cubic/database';
import type { SessionService } from './session.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class PasskeyAuthenticationError extends Error {
  constructor() { super('Passkey sign-in could not be completed.'); }
}

export class PasskeyAuthenticationService {
  constructor(
    private readonly database: Database,
    private readonly sessions: SessionService,
    private readonly rpID: string,
    private readonly origin: string
  ) {}

  async begin() {
    // Public challenges have no user row to cascade from. Keep this table
    // bounded by removing expired ceremonies before issuing another one.
    await this.database.pool.query('delete from passkey_authentication_challenges where expires_at <= now()');
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [],
      userVerification: 'required',
      timeout: CHALLENGE_TTL_MS
    });
    const inserted = await this.database.pool.query<{ id: string }>(
      'insert into passkey_authentication_challenges (challenge_digest, expires_at) values ($1, $2) returning id',
      [digest(options.challenge), new Date(Date.now() + CHALLENGE_TTL_MS)]
    );
    return { challengeId: inserted.rows[0]!.id, options };
  }

  async complete(challengeId: string, response: AuthenticationResponseJSON, ttlDays: number, userAgent?: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const challenge = (await client.query<{ challenge_digest: string; expires_at: Date; used_at: Date | null }>(
        'select challenge_digest, expires_at, used_at from passkey_authentication_challenges where id = $1 for update',
        [challengeId]
      )).rows[0];
      if (!challenge || challenge.used_at || challenge.expires_at.getTime() <= Date.now()) throw new PasskeyAuthenticationError();
      if (typeof response?.id !== 'string' || !response.id || response.id.length > 2048) throw new PasskeyAuthenticationError();

      // The assertion identifies a credential. Its owner is resolved entirely
      // from server state, then locked before checking eligibility and counter.
      const owner = (await client.query<{ user_id: string }>(
        'select user_id from passkey_credentials where credential_id = $1', [response.id]
      )).rows[0];
      if (!owner) throw new PasskeyAuthenticationError();
      const account = (await client.query<{ id: string; disabled_at: Date | null; email_verified_at: Date | null }>(
        'select id, disabled_at, email_verified_at from users where id = $1 for no key update', [owner.user_id]
      )).rows[0];
      if (!account || account.disabled_at || !account.email_verified_at) throw new PasskeyAuthenticationError();
      const credential = (await client.query<{ id: string; public_key: string; counter: string; transports: string[] }>(
        'select id, public_key, counter, transports from passkey_credentials where credential_id = $1 and user_id = $2 for update',
        [response.id, owner.user_id]
      )).rows[0];
      if (!credential) throw new PasskeyAuthenticationError();
      const counter = Number(credential.counter);
      if (!Number.isSafeInteger(counter) || counter < 0) throw new PasskeyAuthenticationError();

      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response,
          expectedChallenge: (actual) => digest(actual) === challenge.challenge_digest,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          credential: {
            id: response.id,
            publicKey: Buffer.from(credential.public_key, 'base64url'),
            counter,
            transports: credential.transports
          },
          requireUserVerification: true
        });
      } catch { throw new PasskeyAuthenticationError(); }
      if (
        !verified.verified ||
        !Number.isSafeInteger(verified.authenticationInfo.newCounter) ||
        verified.authenticationInfo.newCounter < 0
      ) throw new PasskeyAuthenticationError();

      await client.query('update passkey_credentials set counter = $2, last_used_at = now() where id = $1',
        [credential.id, verified.authenticationInfo.newCounter]);
      await client.query('update users set last_login_at = now() where id = $1', [account.id]);
      await client.query('update passkey_authentication_challenges set used_at = now() where id = $1', [challengeId]);
      const session = await this.sessions.create(account.id, ttlDays, userAgent,
        async (userId, tokenHash, expiresAt, clientLabel) => {
          await client.query('insert into sessions (user_id, token_hash, expires_at, client_label) values ($1, $2, $3, $4)',
            [userId, tokenHash, expiresAt, clientLabel]);
        });
      await client.query('commit');
      const identity = await this.sessions.resolveToken(session.token);
      if (!identity) throw new PasskeyAuthenticationError();
      return { session, user: identity.user };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      if (error instanceof PasskeyAuthenticationError) throw error;
      throw error;
    } finally { client.release(); }
  }
}
