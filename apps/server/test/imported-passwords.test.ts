import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';

process.env.JWT_SECRET ||= 'test-secret-for-imported-passwords-0123456789';
const { hashPassword, isImportedHash, verifyPassword } = await import('../src/auth.js');

describe('imported (Laravel bcrypt) passwords', () => {
  it('accepts the right password for a $2y$ hash and refuses a wrong one', async () => {
    const laravel = bcrypt.hashSync('old-password-1', 10).replace(/^\$2b\$/, '$2y$');
    expect(isImportedHash(laravel)).toBe(true);
    expect(await verifyPassword(laravel, 'old-password-1')).toBe(true);
    expect(await verifyPassword(laravel, 'wrong-password')).toBe(false);
  });

  it('keeps checking our own hashes as before', async () => {
    const ours = await hashPassword('new-password-2');
    expect(isImportedHash(ours)).toBe(false);
    expect(await verifyPassword(ours, 'new-password-2')).toBe(true);
    expect(await verifyPassword(ours, 'nope')).toBe(false);
  });
});
