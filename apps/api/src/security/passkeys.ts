import { createHash } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Database } from '@cubic/database';
import { verifyPassword } from './password.js';
import { hasRecentPasskeyAuthentication } from './passkey-reauthentication.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const AUTHENTICATOR_TRANSPORTS = new Set([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb'
]);

function sanitizeTransports(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value.filter(
      (item): item is string =>
        typeof item === 'string' &&
        AUTHENTICATOR_TRANSPORTS.has(item)
    )
  )].slice(0, AUTHENTICATOR_TRANSPORTS.size);
}

export type PasskeyFailure = 'unavailable' | 'password' | 'reauth' | 'invalid' | 'expired' | 'duplicate' | 'missing';
export class PasskeyError extends Error {
  constructor(readonly reason: PasskeyFailure) { super(reason); }
}

export class PasskeyService {
  constructor(private readonly database: Database, private readonly rpID: string, private readonly rpName: string, private readonly origin: string) {}

  async list(userId: string) {
    const result = await this.database.pool.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null; device_type: string; backed_up: boolean }>(
      'select id, label, created_at, last_used_at, device_type, backed_up from passkey_credentials where user_id = $1 order by created_at desc', [userId]
    );
    return result.rows.map((row) => ({ id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
      deviceType: row.device_type, backedUp: row.backed_up }));
  }

  async rename(userId: string, credentialId: string, label: string) {
    const result = await this.database.pool.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null; device_type: string; backed_up: boolean }>(
      'update passkey_credentials set label = $3 where id = $1 and user_id = $2 returning id, label, created_at, last_used_at, device_type, backed_up',
      [credentialId, userId, label]
    );
    const row = result.rows[0];
    if (!row) throw new PasskeyError('missing');
    return { id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at,
      deviceType: row.device_type, backedUp: row.backed_up };
  }

  async begin(userId: string, sessionId: string, currentPassword?: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const account = (await client.query<{ username: string; display_name: string; password_hash: string; email_verified_at: Date | null; disabled_at: Date | null }>(
        'select username, display_name, password_hash, email_verified_at, disabled_at from users where id = $1 for no key update', [userId]
      )).rows[0];
      if (!account || account.disabled_at || !account.email_verified_at) throw new PasskeyError('unavailable');
      const session = (await client.query('select id from sessions where id = $1 and user_id = $2 for key share', [sessionId, userId])).rows[0];
      if (!session) throw new PasskeyError('unavailable');
      if (currentPassword === undefined) {
        if (!(await hasRecentPasskeyAuthentication(client, userId, sessionId))) throw new PasskeyError('reauth');
      } else if (!(await verifyPassword(account.password_hash, currentPassword)).valid) throw new PasskeyError('password');
      const existing = await client.query<{ credential_id: string; transports: string[] }>(
        'select credential_id, transports from passkey_credentials where user_id = $1', [userId]
      );
      const options = await generateRegistrationOptions({
        rpName: this.rpName, rpID: this.rpID, userName: account.username,
        userDisplayName: account.display_name,
        userID: Buffer.from(userId.replaceAll('-', ''), 'hex'),
        attestationType: 'none', timeout: CHALLENGE_TTL_MS,
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: existing.rows.map((row) => ({ id: row.credential_id, transports: row.transports }))
      });
      await client.query("delete from passkey_challenges where user_id = $1 and session_id = $2 and purpose in ('enroll', 'enroll_reauth')", [userId, sessionId]);
      const challenge = await client.query<{ id: string }>(
        'insert into passkey_challenges (user_id, session_id, purpose, challenge_digest, expires_at) values ($1, $2, $3, $4, $5) returning id',
        [userId, sessionId, currentPassword === undefined ? 'enroll_reauth' : 'enroll', digest(options.challenge), new Date(Date.now() + CHALLENGE_TTL_MS)]
      );
      await client.query('commit');
      return { challengeId: challenge.rows[0]!.id, options };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async complete(userId: string, sessionId: string, challengeId: string, response: RegistrationResponseJSON, label: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const account = (await client.query<{ email_verified_at: Date | null; disabled_at: Date | null }>(
        'select email_verified_at, disabled_at from users where id = $1 for no key update', [userId]
      )).rows[0];
      if (!account || account.disabled_at || !account.email_verified_at) throw new PasskeyError('unavailable');
      const session = (await client.query('select id from sessions where id = $1 and user_id = $2 for key share', [sessionId, userId])).rows[0];
      if (!session) throw new PasskeyError('unavailable');
      const challenge = (await client.query<{ challenge_digest: string; expires_at: Date; used_at: Date | null; purpose: string }>(
        "select challenge_digest, expires_at, used_at, purpose from passkey_challenges where id = $1 and user_id = $2 and session_id = $3 and purpose in ('enroll', 'enroll_reauth') for update",
        [challengeId, userId, sessionId]
      )).rows[0];
      if (!challenge || challenge.used_at) throw new PasskeyError('invalid');
      if (challenge.expires_at.getTime() <= Date.now()) throw new PasskeyError('expired');
      if (challenge.purpose === 'enroll_reauth' && !(await hasRecentPasskeyAuthentication(client, userId, sessionId))) throw new PasskeyError('reauth');
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response, expectedChallenge: (actual) => digest(actual) === challenge.challenge_digest,
          expectedOrigin: this.origin, expectedRPID: this.rpID, requireUserVerification: true
        });
      } catch { throw new PasskeyError('invalid'); }
      if (!verification.verified) throw new PasskeyError('invalid');
      const info = verification.registrationInfo;
      await client.query(
        'insert into passkey_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up, label) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)',
        [userId, info.credential.id, Buffer.from(info.credential.publicKey).toString('base64url'), info.credential.counter,
          JSON.stringify(sanitizeTransports(response.response.transports)), info.credentialDeviceType, info.credentialBackedUp, label]
      );
      await client.query('update passkey_challenges set used_at = now() where id = $1', [challengeId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      if ((error as { code?: string }).code === '23505') throw new PasskeyError('duplicate');
      throw error;
    } finally { client.release(); }
  }

  async remove(userId: string, sessionId: string, credentialId: string, currentPassword?: string) {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const account = (await client.query<{ password_hash: string; disabled_at: Date | null; email_verified_at: Date | null }>(
        'select password_hash, disabled_at, email_verified_at from users where id = $1 for no key update', [userId]
      )).rows[0];
      if (!account || account.disabled_at) throw new PasskeyError('unavailable');
      const session = (await client.query('select id from sessions where id = $1 and user_id = $2 for key share', [sessionId, userId])).rows[0];
      if (!session) throw new PasskeyError('unavailable');
      if (currentPassword === undefined) {
        if (!account.email_verified_at || !(await hasRecentPasskeyAuthentication(client, userId, sessionId))) throw new PasskeyError('reauth');
      } else if (!(await verifyPassword(account.password_hash, currentPassword)).valid) throw new PasskeyError('password');
      const removed = await client.query('delete from passkey_credentials where id = $1 and user_id = $2 returning id', [credentialId, userId]);
      if (!removed.rows[0]) throw new PasskeyError('missing');
      await client.query("delete from passkey_challenges where user_id = $1 and purpose = 'reauth'", [userId]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
}
