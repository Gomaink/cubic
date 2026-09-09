import * as argon2 from 'argon2';
import bcrypt from 'bcryptjs';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  raw: false
} as const;

export type PasswordVerification = {
  valid: boolean;
  needsUpgrade: boolean;
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  candidate: string
): Promise<PasswordVerification> {
  try {
    if (storedHash.startsWith('$argon2')) {
      const valid = await argon2.verify(storedHash, candidate);

      const needsUpgrade =
        valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS);

      return {
        valid,
        needsUpgrade
      };
    }

    // Cubic v1 used bcryptjs. A successful legacy login is transparently
    // upgraded to Argon2id by the auth route.
    if (
      storedHash.startsWith('$2a$') ||
      storedHash.startsWith('$2b$') ||
      storedHash.startsWith('$2y$')
    ) {
      const valid = await bcrypt.compare(candidate, storedHash);

      return {
        valid,
        needsUpgrade: valid
      };
    }

    return {
      valid: false,
      needsUpgrade: false
    };
  } catch {
    return {
      valid: false,
      needsUpgrade: false
    };
  }
}
