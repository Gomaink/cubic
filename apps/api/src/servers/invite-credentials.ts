import { createHmac, timingSafeEqual } from 'node:crypto';

const KEY_ID = /^[a-z0-9_-]{1,24}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^v2\.([a-z0-9_-]{1,24})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const DOMAIN = 'cubic.server-invite-link.v2\0';

export class InviteCredentials {
  private readonly keys = new Map<string, Buffer>();

  constructor(readonly activeKeyId: string, encodedKeys: Record<string, string>) {
    if (!KEY_ID.test(activeKeyId) || !Object.keys(encodedKeys).length) throw new Error('Invite link HMAC keys are not configured.');
    for (const [id, encoded] of Object.entries(encodedKeys)) {
      if (!KEY_ID.test(id) || !KEY.test(encoded) || Buffer.from(encoded, 'base64url').length !== 32 ||
        Buffer.from(encoded, 'base64url').toString('base64url') !== encoded) {
        throw new Error('Invalid invite link HMAC key configuration.');
      }
      this.keys.set(id, Buffer.from(encoded, 'base64url'));
    }
    if (!this.keys.has(activeKeyId)) throw new Error('Active invite link HMAC key is missing.');
  }

  private signature(id: string, keyId: string): Buffer {
    return createHmac('sha256', this.keys.get(keyId)!).update(DOMAIN).update(id).digest();
  }

  issue(id: string): string {
    return `v2.${this.activeKeyId}.${id}.${this.signature(id, this.activeKeyId).toString('base64url')}`;
  }

  verify(token: string): string | null {
    const match = TOKEN.exec(token);
    if (!match || !this.keys.has(match[1]!)) return null;
    const actual = Buffer.from(match[3]!, 'base64url');
    if (actual.length !== 32 || actual.toString('base64url') !== match[3]) return null;
    const expected = this.signature(match[2]!, match[1]!);
    return timingSafeEqual(actual, expected) ? match[2]! : null;
  }
}

export function parseInviteCredentials(activeKeyId: string | undefined, serializedKeys: string | undefined): InviteCredentials | null {
  if (!activeKeyId || !serializedKeys) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(serializedKeys); } catch { throw new Error('Invalid invite link HMAC key configuration.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('Invalid invite link HMAC key configuration.');
  return new InviteCredentials(activeKeyId, parsed as Record<string, string>);
}
