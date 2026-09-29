import { createHash } from 'node:crypto';
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Database } from '@cubic/database';
import type { PoolClient } from 'pg';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class PasskeyReauthenticationError extends Error {
  constructor() { super('Passkey confirmation could not be completed.'); }
}

// A consumed, session-bound reauth challenge is the server-side recent-auth
// record. Enrollment challenges have a different purpose and never qualify.
export async function hasRecentPasskeyAuthentication(client: PoolClient, userId: string, sessionId: string) {
  const result = await client.query(
    `select 1 from passkey_challenges where user_id = $1 and session_id = $2 and purpose = 'reauth'
      and used_at > now() - interval '5 minutes' limit 1`,
    [userId, sessionId]
  );
  return result.rowCount === 1;
}

export class PasskeyReauthenticationService {
  constructor(private readonly database: Database, private readonly rpID: string, private readonly origin: string) {}

  async begin(userId: string, sessionId: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const account = (await client.query<{ disabled_at: Date | null; email_verified_at: Date | null }>(
        'select disabled_at, email_verified_at from users where id = $1 for no key update', [userId]
      )).rows[0];
      if (!account || account.disabled_at || !account.email_verified_at) throw new PasskeyReauthenticationError();
      const session = (await client.query('select id from sessions where id = $1 and user_id = $2 for key share', [sessionId, userId])).rows[0];
      if (!session) throw new PasskeyReauthenticationError();
      const credentials = await client.query<{ credential_id: string; transports: string[] }>(
        'select credential_id, transports from passkey_credentials where user_id = $1', [userId]
      );
      if (!credentials.rows.length) throw new PasskeyReauthenticationError();
      const options = await generateAuthenticationOptions({
        rpID: this.rpID, timeout: CHALLENGE_TTL_MS, userVerification: 'required',
        allowCredentials: credentials.rows.map((row) => ({ id: row.credential_id, transports: row.transports }))
      });
      await client.query("delete from passkey_challenges where purpose = 'reauth' and ((used_at is null and expires_at <= now()) or used_at <= now() - interval '5 minutes')");
      await client.query("delete from passkey_challenges where user_id = $1 and session_id = $2 and purpose = 'reauth' and used_at is null", [userId, sessionId]);
      const challenge = await client.query<{ id: string }>(
        "insert into passkey_challenges (user_id, session_id, purpose, challenge_digest, expires_at) values ($1, $2, 'reauth', $3, $4) returning id",
        [userId, sessionId, digest(options.challenge), new Date(Date.now() + CHALLENGE_TTL_MS)]
      );
      await client.query('commit');
      return { challengeId: challenge.rows[0]!.id, options };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async complete(userId: string, sessionId: string, challengeId: string, response: AuthenticationResponseJSON) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const account = (await client.query<{ disabled_at: Date | null; email_verified_at: Date | null }>(
        'select disabled_at, email_verified_at from users where id = $1 for no key update', [userId]
      )).rows[0];
      if (!account || account.disabled_at || !account.email_verified_at) throw new PasskeyReauthenticationError();
      const session = (await client.query('select id from sessions where id = $1 and user_id = $2 for key share', [sessionId, userId])).rows[0];
      if (!session) throw new PasskeyReauthenticationError();
      const challenge = (await client.query<{ challenge_digest: string; expires_at: Date; used_at: Date | null }>(
        "select challenge_digest, expires_at, used_at from passkey_challenges where id = $1 and user_id = $2 and session_id = $3 and purpose = 'reauth' for update",
        [challengeId, userId, sessionId]
      )).rows[0];
      if (!challenge || challenge.used_at || challenge.expires_at.getTime() <= Date.now()) throw new PasskeyReauthenticationError();
      if (typeof response?.id !== 'string' || !response.id || response.id.length > 2048) throw new PasskeyReauthenticationError();
      const credential = (await client.query<{ id: string; public_key: string; counter: string; transports: string[] }>(
        'select id, public_key, counter, transports from passkey_credentials where credential_id = $1 and user_id = $2 for update',
        [response.id, userId]
      )).rows[0];
      if (!credential) throw new PasskeyReauthenticationError();
      const counter = Number(credential.counter);
      if (!Number.isSafeInteger(counter) || counter < 0) throw new PasskeyReauthenticationError();
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response, expectedChallenge: (actual) => digest(actual) === challenge.challenge_digest,
          expectedOrigin: this.origin, expectedRPID: this.rpID,
          credential: { id: response.id, publicKey: Buffer.from(credential.public_key, 'base64url'), counter,
            transports: credential.transports },
          requireUserVerification: true
        });
      } catch { throw new PasskeyReauthenticationError(); }
      if (!verification.verified || !Number.isSafeInteger(verification.authenticationInfo.newCounter) ||
        verification.authenticationInfo.newCounter < 0) throw new PasskeyReauthenticationError();
      await client.query('update passkey_credentials set counter = $2, last_used_at = now() where id = $1',
        [credential.id, verification.authenticationInfo.newCounter]);
      await client.query('update passkey_challenges set used_at = now() where id = $1', [challengeId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
}
