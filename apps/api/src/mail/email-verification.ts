import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '@cubic/database';
import type { RealtimeEvents } from '../realtime/events.js';
import { normalizeEmail } from '../auth/identity.js';
import { verifyPassword } from '../security/password.js';
import { MailDeliveryError, type MailTransport } from './transport.js';

export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
export const CHANGE_EMAIL_TTL_MS = 60 * 60 * 1000;
type Purpose = 'verify_email' | 'change_email';
type IssueResult = 'sent' | 'already_verified' | 'unavailable';
type ConsumeResult = 'verified' | 'changed' | 'invalid' | 'expired' | 'used' | 'conflict';

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

export class EmailChangeError extends Error {
  constructor(readonly reason: 'password' | 'same' | 'occupied' | 'invalid') {
    super('Email change rejected.');
  }
}

export class EmailVerificationService {
  constructor(
    private readonly database: Database,
    private readonly mail: MailTransport,
    private readonly events: RealtimeEvents
  ) {}

  get available(): boolean { return this.mail.available; }

  async state(userId: string) {
    const result = await this.database.pool.query<{ email: string; email_verified_at: Date | null }>(
      'select email, email_verified_at from users where id = $1', [userId]
    );
    const user = result.rows[0];
    return user ? { email: user.email, emailVerifiedAt: user.email_verified_at?.toISOString() ?? null, mailDeliveryAvailable: this.available } : null;
  }

  private async deliver(token: string, purpose: Purpose, recipient: string): Promise<void> {
    const expiry = purpose === 'verify_email' ? VERIFY_EMAIL_TTL_MS : CHANGE_EMAIL_TTL_MS;
    const url = `${this.mail.publicAppUrl.replace(/\/$/, '')}/verify-email#token=${token}`;
    const change = purpose === 'change_email';
    const action = change ? 'Verify your new email' : 'Verify your email';
    const lifetime = expiry === CHANGE_EMAIL_TTL_MS ? '1 hour' : '24 hours';
    const text = `Cubic — ${action}\n\n${change ? 'Verify this new address to complete your requested account email change. Completing the change signs out every Cubic session.' : 'Verify this address for your Cubic account.'}\n\n${url}\n\nThis link expires in ${lifetime}. If you did not request this, ignore this message.`;
    const html = `<p>Cubic — ${action}</p><p>${change ? 'Verify this new address to complete your requested account email change. Completing the change signs out every Cubic session.' : 'Verify this address for your Cubic account.'}</p><p><a href="${url}">${action}</a></p><p>This link expires in ${lifetime}. If you did not request this, ignore this message.</p>`;
    await this.mail.send({ to: recipient, subject: `Cubic: ${action}`, text, html });
  }

  async sendCurrent(userId: string): Promise<IssueResult> {
    if (!this.available) return 'unavailable';
    const token = randomBytes(32).toString('base64url');
    let recipient = '';
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ email: string; email_normalized: string; email_verified_at: Date | null }>(
        'select email, email_normalized, email_verified_at from users where id = $1 for no key update', [userId]
      );
      const user = result.rows[0];
      if (!user || user.email_verified_at) { await client.query('rollback'); return 'already_verified'; }
      recipient = user.email;
      await client.query(
        'delete from email_verification_tokens where user_id = $1 and purpose = $2 and used_at is null',
        [userId, 'verify_email']
      );
      await client.query(
        `insert into email_verification_tokens (user_id, purpose, token_digest, target_email_normalized, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [userId, 'verify_email', digest(token), user.email_normalized, new Date(Date.now() + VERIFY_EMAIL_TTL_MS)]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await this.deliver(token, 'verify_email', recipient);
    return 'sent';
  }

  async requestChange(userId: string, newEmail: string, currentPassword: string): Promise<void> {
    if (!this.available) throw new MailDeliveryError();
    const email = normalizeEmail(newEmail);
    const token = randomBytes(32).toString('base64url');
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ email_normalized: string; password_hash: string }>(
        'select email_normalized, password_hash from users where id = $1 for no key update', [userId]
      );
      const user = result.rows[0];
      if (!user) throw new EmailChangeError('invalid');
      if (!(await verifyPassword(user.password_hash, currentPassword)).valid) throw new EmailChangeError('password');
      if (user.email_normalized === email) throw new EmailChangeError('same');
      const occupied = await client.query('select id from users where email_normalized = $1', [email]);
      if (occupied.rows.length) throw new EmailChangeError('occupied');
      await client.query("delete from email_verification_tokens where user_id = $1 and purpose = 'change_email' and used_at is null", [userId]);
      await client.query(
        `insert into email_verification_tokens (user_id, purpose, token_digest, target_email_normalized, expires_at)
         values ($1, 'change_email', $2, $3, $4)`,
        [userId, digest(token), email, new Date(Date.now() + CHANGE_EMAIL_TTL_MS)]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await this.deliver(token, 'change_email', email);
  }

  async consume(rawToken: string): Promise<ConsumeResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return 'invalid';
    const client = await this.database.pool.connect();
    let revokedIds: string[] = [];
    let result: ConsumeResult = 'invalid';
    try {
      await client.query('begin');
      const found = await client.query<{ id: string; user_id: string }>(
        'select id, user_id from email_verification_tokens where token_digest = $1', [digest(rawToken)]
      );
      if (!found.rows[0]) { await client.query('rollback'); return 'invalid'; }
      const user = await client.query<{ email_normalized: string; disabled_at: Date | null }>(
        'select email_normalized, disabled_at from users where id = $1 for no key update', [found.rows[0].user_id]
      );
      const locked = await client.query<{ purpose: Purpose; target_email_normalized: string; expires_at: Date; used_at: Date | null }>(
        'select purpose, target_email_normalized, expires_at, used_at from email_verification_tokens where id = $1 for update',
        [found.rows[0].id]
      );
      const token = locked.rows[0];
      if (!user.rows[0] || user.rows[0].disabled_at || !token) result = 'invalid';
      else if (token.used_at) result = 'used';
      else if (token.expires_at.getTime() <= Date.now()) result = 'expired';
      else if (token.purpose === 'verify_email') {
        if (user.rows[0].email_normalized !== token.target_email_normalized) result = 'invalid';
        else {
          await client.query('update users set email_verified_at = now(), updated_at = now() where id = $1', [found.rows[0].user_id]);
          await client.query("update email_verification_tokens set used_at = now() where user_id = $1 and purpose = 'verify_email' and used_at is null", [found.rows[0].user_id]);
          result = 'verified';
        }
      } else if (token.purpose === 'change_email') {
        const occupied = await client.query('select id from users where email_normalized = $1 and id <> $2',
          [token.target_email_normalized, found.rows[0].user_id]);
        if (occupied.rows.length) result = 'conflict';
        else {
          await client.query('update users set email = $2, email_normalized = $2, email_verified_at = now(), updated_at = now() where id = $1',
            [found.rows[0].user_id, token.target_email_normalized]);
          await client.query('update email_verification_tokens set used_at = now() where user_id = $1 and used_at is null', [found.rows[0].user_id]);
          const sessions = await client.query<{ id: string }>('delete from sessions where user_id = $1 returning id', [found.rows[0].user_id]);
          revokedIds = sessions.rows.map((row) => row.id);
          result = 'changed';
        }
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      if (isUniqueViolation(error)) return 'conflict';
      throw error;
    } finally {
      client.release();
    }
    for (const sessionId of revokedIds) this.events.emitSessionRevoked({ sessionId });
    return result;
  }
}
