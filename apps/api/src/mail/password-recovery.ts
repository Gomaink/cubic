import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@cubic/database';
import type { RealtimeEvents } from '../realtime/events.js';
import { hashPassword } from '../security/password.js';
import type { MailTransport } from './transport.js';

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
type ResetResult = 'changed' | 'invalid' | 'expired' | 'used';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class PasswordRecoveryService {
  constructor(
    private readonly database: Database,
    private readonly mail: MailTransport,
    private readonly events: RealtimeEvents
  ) {}

  get available(): boolean { return this.mail.available; }

  async request(identifier: string): Promise<void> {
    if (!this.available) return;
    const normalized = identifier.trim().toLowerCase();
    const match = await this.database.pool.query<{ id: string }>(
      'select id from users where email_normalized = $1 or username_normalized = $1 limit 1', [normalized]
    );
    const userId = match.rows[0]?.id;
    if (!userId) return;
    const rawToken = randomBytes(32).toString('base64url');
    let recipient = '';
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ email: string; email_normalized: string; email_verified_at: Date | null; disabled_at: Date | null; username_normalized: string }>(
        'select email, email_normalized, email_verified_at, disabled_at, username_normalized from users where id = $1 for no key update', [userId]
      );
      const user = result.rows[0];
      if (!user || user.disabled_at || !user.email_verified_at || (user.email_normalized !== normalized && user.username_normalized !== normalized)) {
        await client.query('rollback');
        return;
      }
      recipient = user.email;
      await client.query('delete from password_reset_tokens where user_id = $1 and used_at is null', [userId]);
      await client.query(
        'insert into password_reset_tokens (user_id, token_digest, target_email_normalized, expires_at) values ($1, $2, $3, $4)',
        [userId, digest(rawToken), user.email_normalized, new Date(Date.now() + PASSWORD_RESET_TTL_MS)]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const url = `${this.mail.publicAppUrl.replace(/\/$/, '')}/reset-password#token=${rawToken}`;
    const text = `Cubic — Reset your password\n\nA password reset was requested for your Cubic account. Use this link to set a new password:\n\n${url}\n\nThe link expires in 30 minutes. Completing the reset signs out every Cubic session. If you did not request this, ignore this message.`;
    const html = `<p>Cubic — Reset your password</p><p>A password reset was requested for your Cubic account.</p><p><a href="${url}">Reset your password</a></p><p>The link expires in 30 minutes. Completing the reset signs out every Cubic session. If you did not request this, ignore this message.</p>`;
    await this.mail.send({ to: recipient, subject: 'Cubic: Reset your password', text, html });
  }

  async consume(rawToken: string, newPassword: string): Promise<ResetResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return 'invalid';
    const client = await this.database.pool.connect();
    let revokedIds: string[] = [];
    let result: ResetResult = 'invalid';
    try {
      await client.query('begin');
      const found = await client.query<{ id: string; user_id: string }>(
        'select id, user_id from password_reset_tokens where token_digest = $1', [digest(rawToken)]
      );
      if (!found.rows[0]) { await client.query('rollback'); return 'invalid'; }
      const user = await client.query<{ email_normalized: string; email_verified_at: Date | null; disabled_at: Date | null }>(
        'select email_normalized, email_verified_at, disabled_at from users where id = $1 for no key update', [found.rows[0].user_id]
      );
      const locked = await client.query<{ target_email_normalized: string; expires_at: Date; used_at: Date | null }>(
        'select target_email_normalized, expires_at, used_at from password_reset_tokens where id = $1 for update', [found.rows[0].id]
      );
      const token = locked.rows[0];
      const account = user.rows[0];
      if (!account || account.disabled_at || !account.email_verified_at || !token || token.target_email_normalized !== account.email_normalized) result = 'invalid';
      else if (token.used_at) result = 'used';
      else if (token.expires_at.getTime() <= Date.now()) result = 'expired';
      else {
        const passwordHash = await hashPassword(newPassword);
        await client.query('update users set password_hash = $2, updated_at = now() where id = $1', [found.rows[0].user_id, passwordHash]);
        await client.query('update password_reset_tokens set used_at = now() where user_id = $1 and used_at is null', [found.rows[0].user_id]);
        await client.query("update email_verification_tokens set used_at = now() where user_id = $1 and purpose = 'change_email' and used_at is null", [found.rows[0].user_id]);
        const revoked = await client.query<{ id: string }>('delete from sessions where user_id = $1 returning id', [found.rows[0].user_id]);
        revokedIds = revoked.rows.map((row) => row.id);
        result = 'changed';
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    for (const sessionId of revokedIds) this.events.emitSessionRevoked({ sessionId });
    return result;
  }
}
