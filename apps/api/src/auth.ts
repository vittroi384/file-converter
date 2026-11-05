// 관리자 로그인: scrypt 비밀번호 해시 + HMAC 서명 세션 토큰(서버 저장소 없이 검증)
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const got = scryptSync(pw, Buffer.from(saltB64, 'base64url'), expected.length, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

// 토큰: 만료시각.서명
export function issueSession(secret: string, ttlMs = 12 * 3600_000, now = Date.now()): string {
  const exp = String(now + ttlMs);
  return `${exp}.${sign(secret, exp)}`;
}

export function checkSession(secret: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const want = Buffer.from(sign(secret, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) && Number(exp) > now;
}
