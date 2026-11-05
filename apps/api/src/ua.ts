// User-Agent → 낮은 카디널리티 라벨(브라우저 5종 × 기기 2종). 원문은 저장하지 않는다.
export type Browser = 'chrome' | 'edge' | 'safari' | 'firefox' | 'samsung' | 'other';
export type Device = 'mobile' | 'desktop';

export function classify(ua = ''): { browser: Browser; device: Device } {
  const u = ua.toLowerCase();
  const device: Device = /mobi|android|iphone|ipad|ipod/.test(u) ? 'mobile' : 'desktop';
  let browser: Browser = 'other';
  if (u.includes('samsungbrowser')) browser = 'samsung';
  else if (u.includes('edg/')) browser = 'edge';
  else if (u.includes('firefox/') || u.includes('fxios')) browser = 'firefox';
  else if (u.includes('chrome/') || u.includes('crios')) browser = 'chrome';
  else if (u.includes('safari/')) browser = 'safari';
  return { browser, device };
}

// 봇·크롤러 통계는 버린다(지표 오염 방지)
export function isBot(ua = '') {
  return /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests/i.test(ua);
}
