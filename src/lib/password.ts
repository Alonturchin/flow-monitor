// Password hashing via Node's built-in crypto (scrypt) — no external deps.

import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

const KEY_LEN = 64  // 64 bytes = 512-bit derived key
const COST = 16384  // scrypt N parameter (2^14), memory/time trade-off

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LEN, { N: COST }).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, expected] = stored.split(':')
    if (!salt || !expected) return false
    const actual = scryptSync(password, salt, KEY_LEN, { N: COST })
    const expectedBuf = Buffer.from(expected, 'hex')
    if (actual.length !== expectedBuf.length) return false
    return timingSafeEqual(actual, expectedBuf)
  } catch {
    return false
  }
}
