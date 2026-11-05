// 명령 검색: 공백 무시, 한글 초성 검색('ㅎㅅ' → '형식 바꾸기')
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

export function initials(s: string) {
  return [...s].map(c => {
    const code = c.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHO[Math.floor(code / 588)] : c;
  }).join('');
}

export function matches(label: string, q: string) {
  const a = label.toLowerCase().replace(/\s/g, '');
  const b = q.toLowerCase().replace(/\s/g, '');
  return !b || a.includes(b) || initials(a).includes(b);
}
