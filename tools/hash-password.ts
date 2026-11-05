// 관리자 비밀번호 해시 만들기. 실행: node tools/hash-password.ts '비밀번호'
// 결과를 .env의 ADMIN_PASSWORD_HASH에 넣는다(비밀번호 원문은 어디에도 저장하지 않는다).
import { hashPassword } from '../apps/api/src/auth.ts';

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error('10자 이상 비밀번호를 인자로 주세요');
  process.exit(1);
}
console.log(hashPassword(pw));
