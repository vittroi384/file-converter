import type { LandingTemplates, Fmt } from './landings.ts';
import type { LandingCopy } from './types.ts';

const name: Record<Fmt, string> = { heic: 'HEIC', jpg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', psd: 'PSD', svg: 'SVG', pdf: 'PDF', xlsx: '엑셀', csv: 'CSV', json: 'JSON', yaml: 'YAML' };
// 조사: 읽었을 때 끝소리 기준(JSON=제이슨 → 받침 ㄴ, 엑셀·YAML=ㄹ, 나머지는 모음으로 끝남)
const JONG: Partial<Record<Fmt, 'n' | 'l'>> = { json: 'n', xlsx: 'l', yaml: 'l' };
const eul = (f: Fmt) => `${name[f]}${JONG[f] ? '을' : '를'}`; // 을/를
const ro = (f: Fmt) => `${name[f]}${JONG[f] === 'n' ? '으로' : '로'}`; // ㄹ 받침과 모음 뒤는 '로'
const facts: Record<Fmt, string> = {
  heic: 'HEIC는 아이폰이 사진을 기본으로 저장하는 형식이에요. 윈도우 프로그램이나 웹사이트 상당수가 아직 못 열어요.',
  jpg: 'JPG는 가장 널리 쓰이는 사진 형식이라 어떤 폰·브라우저·문서 프로그램에서도 열려요.',
  png: 'PNG는 화질 손실이 없고 투명 배경을 지원해 캡처·로고·그래픽에 좋지만, 사진은 용량이 커요.',
  webp: 'WebP는 웹용 최신 형식이라 비슷한 화질에서 보통 JPG보다 25~35% 작아요.',
  avif: 'AVIF는 가장 새로운 이미지 형식으로 대개 가장 작지만, 일부 오래된 프로그램은 못 열어요.',
  psd: 'PSD는 포토샵 문서 형식이에요. LocalConvert는 합성 이미지를 읽고, 합성 이미지 없이 저장된 파일은 보이는 레이어를 직접 겹쳐요.',
  svg: 'SVG는 벡터 형식이에요. PNG로 바꾸면 정해진 크기로 그려져서 이미지만 받는 곳 어디서든 쓸 수 있어요.',
  pdf: 'PDF는 어떤 기기에서도 문서 모양이 그대로 보이는 형식이에요.',
  xlsx: 'XLSX는 마이크로소프트 엑셀 통합 문서 형식이에요.',
  csv: 'CSV는 쉼표로 값을 나눈 글자 파일이라 거의 모든 프로그램이 불러올 수 있어요.',
  json: 'JSON은 웹 API와 자바스크립트 앱의 표준 데이터 형식이에요.',
  yaml: 'YAML은 사람이 읽기 쉬운 데이터 형식으로 설정 파일에 자주 써요.',
};
const privacyQ = { q: '파일이 서버로 올라가나요?', a: '아니요. 변환은 브라우저 탭 안에서 일어나고, 사이트 보안 정책이 다른 서버로의 연결을 막아서 파일이 기기 밖으로 나갈 수 없어요.' };
const costQ = { q: '무료인가요? 용량 제한이 있나요?', a: '회원가입·광고 없이 무료예요. 정해진 용량 제한은 없고, 아주 큰 파일은 기기 메모리에 따라 달라요. 기기에 비해 너무 크면 화면에서 알려 줘요.' };
const iosQ = { q: '아이폰·안드로이드에서도 되나요?', a: '네. 사파리·크롬·삼성 인터넷 등 최신 브라우저에서 돼요. 안드로이드에선 공유하기 메뉴로 바로 보낼 수도 있어요(아이폰은 이 기능을 지원하지 않아요).' };

function build(d: Parameters<LandingTemplates['build']>[0]): LandingCopy {
  switch (d.kind) {
    case 'convert': {
      const f = name[d.from], t = name[d.to];
      return {
        title: `${eul(d.from)} ${ro(d.to)} 변환 — 무료, 업로드 없음`,
        metaDescription: `${eul(d.from)} ${ro(d.to)} 브라우저에서 바로 바꿔요. 파일이 기기 밖으로 나가지 않고, 가입·광고 없이 여러 장을 ZIP 하나로 받아요.`,
        intro: `${facts[d.from]} ${facts[d.to]} 아래에 ${f} 파일을 넣으면 여기서 바로 ${ro(d.to)} 바꿔요.`,
        steps: [`${f} 파일을 끌어다 놓거나 골라요(여러 개도 한 번에).`, `${t}${JONG[d.to] ? '은' : '는'} 이미 골라져 있어요. 필요하면 크기나 화질을 바꿔요.`, '변환하고 하나씩 받거나 ZIP으로 한 번에 받아요.'],
        faq: [
          privacyQ,
          { q: `${ro(d.to)} 바꾸면 화질이 떨어지나요?`, a: d.to === 'png' ? 'PNG는 손실이 없는 형식이라 변환 자체로 화질이 떨어지지 않아요.' : `${t}${JONG[d.to] ? '은' : '는'} 압축 형식이에요. 기본 화질은 원본과 똑같아 보이도록 정해져 있고, 더 필요하면 '높게'를 고르면 돼요.` },
          ...(d.from === 'heic' ? [{ q: '사진 방향은 그대로인가요?', a: '네. 사진에 저장된 회전 정보를 적용하고, 위치 정보(GPS)는 새 파일에 옮기지 않아요.' }] : []),
          iosQ, costQ,
        ],
      };
    }
    case 'compress': {
      const f = d.fmt ? name[d.fmt] : '이미지';
      return {
        title: `${f} 용량 줄이기 — 눈으로 차이 없는 선에서 가장 작게`,
        metaDescription: `${f} 용량을 화질 차이 없이 줄여요. 유사도(SSIM)를 재서 가장 작은 파일을 자동으로 찾아요. 브라우저에서, 업로드 없이.`,
        intro: `화질 숫자를 짐작하는 대신, 몇 가지 설정으로 만들어 보고 원본과 얼마나 같은지 SSIM으로 재서 기준을 넘는 것 중 가장 작은 걸 남겨요. 보통 3~4번이면 찾아요.${d.fmt === 'png' ? ' PNG 사진은 보통 몇 배 작은 WebP로 저장해요.' : ''}`,
        steps: ['이미지를 넣어요.', '기준을 골라요: 거의 원본, 균형, 최대한 작게.', '결과를 받아요. 이미 충분히 작은 파일은 원본 그대로 둬요.'],
        faq: [privacyQ, { q: '얼마나 작아지나요?', a: '사진마다 달라요. 시험에서는 220KB JPG가 "균형"에서 눈에 띄는 차이 없이 130KB(-41%)가 됐어요.' }, { q: '여러 장을 한꺼번에 줄일 수 있나요?', a: '네. CPU 여러 개로 동시에 처리하고 ZIP 하나로 받아요.' }, iosQ],
      };
    }
    case 'resize':
      return {
        title: '이미지 크기 줄이기 — 무료, 브라우저에서',
        metaDescription: '메일·SNS·웹에 맞게 사진 해상도를 줄여요. 고품질 Lanczos 방식, 업로드·가입 없음.',
        intro: '가로 크기(4K, FHD, SNS, 작게)를 고르면 고품질 Lanczos 필터로 줄여요. 아주 큰 사진은 처음부터 줄여서 열기 때문에 5000만 화소 사진도 메모리에 들어가요.',
        steps: ['이미지를 넣어요.', '가로 크기와 저장 형식을 골라요.', '줄인 이미지나 ZIP을 받아요.'],
        faq: [privacyQ, { q: '비율이 유지되나요?', a: '네. 줄이기만 하고 늘이거나 찌그러뜨리지 않아요.' }, iosQ, costQ],
      };
    case 'merge-pdf':
      return {
        title: 'PDF 합치기 — 무료, 업로드 없음',
        metaDescription: '여러 PDF(와 사진)를 브라우저에서 하나로 합쳐요. 끌어서 순서를 바꾸고, 페이지는 다시 압축하지 않아요.',
        intro: '페이지를 그대로 복사해서 글자가 선명하고 다시 압축되지 않아요. PDF와 사진을 섞어도 되고, 사진은 한 장씩 페이지가 돼요.',
        steps: ['PDF 두 개 이상을 넣어요.', '끌거나 화살표로 순서를 맞춰요.', '합치고 PDF 하나를 받아요.'],
        faq: [privacyQ, { q: '암호 걸린 PDF도 합쳐지나요?', a: '아직은 안 돼요. 암호 걸린 PDF는 깨진 파일을 만드는 대신 알려 드려요.' }, costQ],
      };
    case 'split-pdf':
      return {
        title: 'PDF 나누기 — 원하는 쪽만, 무료',
        metaDescription: 'PDF를 한 쪽씩, 또는 1-3,5,8- 같은 범위로 브라우저에서 나눠요. 업로드 없음.',
        intro: '범위를 비우면 한 쪽씩 파일이 되고, 1-3, 4-6, 8-(끝까지)처럼 적으면 그대로 나눠요.',
        steps: ['PDF를 넣어요.', '쪽 범위를 적거나 비워 둬요.', '파일들을 ZIP으로 받아요.'],
        faq: [privacyQ, { q: '나누면 화질이 떨어지나요?', a: '아니요. 페이지를 다시 인코딩하지 않고 복사해요.' }, costQ],
      };
    case 'compress-pdf':
      return {
        title: 'PDF 용량 줄이기 — 스캔 PDF를 메일로 보낼 크기로',
        metaDescription: 'PDF 안의 사진만 다시 압축해 용량을 줄이고 글자는 선명하게 둬요. 브라우저에서, 업로드 없이.',
        intro: '스캔 문서는 대부분 사진이에요. 그 사진들을 여러 작업자가 동시에 다시 압축·축소하고 글자와 도형은 건드리지 않아요. 시험에서는 1.9MB 스캔이 0.46MB(-76%)가 됐어요.',
        steps: ['PDF를 넣어요.', '약하게·보통·강하게 중에 골라요.', '작아진 PDF를 받아요. 작아지지 않으면 원본을 그대로 둬요.'],
        faq: [privacyQ, { q: '글자가 흐려지나요?', a: '아니요. 안에 든 사진만 다시 압축하고 글자는 글자 그대로예요.' }, { q: '어떤 PDF가 많이 줄어드나요?', a: '스캔본이나 큰 사진이 든 PDF요. 글자만 있는 PDF는 보통 이미 작아요.' }, costQ],
      };
    case 'pdf-to-image': {
      const t = name[d.to];
      return {
        title: `PDF를 ${ro(d.to)} — 페이지마다 이미지로`,
        metaDescription: `PDF 페이지를 화면용·인쇄용 해상도의 ${t} 이미지로 바꿔요. 1-3,5처럼 쪽을 고를 수 있어요. 업로드 없음.`,
        intro: `모질라의 PDF 엔진(pdf.js)으로 페이지를 96·150·300 DPI로 그려 ${ro(d.to)} 저장해요. ${facts[d.to]}`,
        steps: ['PDF를 넣어요.', '해상도와 필요하면 쪽 범위를 골라요.', `${t} 파일들을 ZIP으로 받아요.`],
        faq: [privacyQ, { q: '해상도는 뭘 고르면 되나요?', a: '화면과 대부분의 문서는 150 DPI, 인쇄용은 300 DPI가 좋아요.' }, costQ],
      };
    }
    case 'images-to-pdf':
      return {
        title: 'JPG를 PDF로 — 사진 여러 장을 PDF 하나로',
        metaDescription: '사진을 브라우저에서 PDF 하나로 묶어요. JPG는 다시 압축하지 않아 화질이 그대로예요. 업로드 없음.',
        intro: 'JPG는 바이트 그대로 PDF에 넣어서 화질 손실이 없어요. 페이지는 사진 크기대로 또는 여백 있는 A4로 고를 수 있어요. 아이폰 HEIC 사진도 돼요.',
        steps: ['사진들을 넣어요.', '순서와 페이지 크기를 정해요.', 'PDF 하나를 받아요.'],
        faq: [privacyQ, { q: 'PDF가 흐려지나요?', a: '아니요. JPG는 그대로 넣고, 다른 형식은 높은 화질로 바꿔 넣어요.' }, iosQ],
      };
    case 'data': {
      const f = name[d.from], t = name[d.to];
      return {
        title: `${eul(d.from)} ${ro(d.to)} 변환 — 한글 깨짐·앞자리 0 사라짐 없이`,
        metaDescription: `${eul(d.from)} ${ro(d.to)} 브라우저에서 바꿔요. 글자 인코딩을 자동으로 알아내고, 전화번호처럼 0으로 시작하는 값을 지켜요. 업로드 없음.`,
        intro: `${facts[d.from]} ${facts[d.to]} 007이나 010-1234 같은 값은 숫자로 바뀌지 않고 글자로 남고, 엑셀이 저장한 EUC-KR CSV도 자동으로 알아봐요.`,
        steps: [`${f} 파일을 넣어요.`, `${t}${JONG[d.to] ? '은' : '는'} 이미 골라져 있어요.`, '바뀐 파일을 받아요.'],
        faq: [privacyQ, { q: '엑셀에서 CSV 한글이 깨지지 않나요?', a: '네. CSV를 UTF-8 표시(BOM)와 함께 저장해서 엑셀에서도 한글이 제대로 보여요.' }, { q: '중첩된 JSON은요?', a: '표로 바꿀 때 address.city처럼 점으로 이은 열 이름이 돼요.' }],
      };
    }
  }
}

export const landingKo: LandingTemplates = { name, facts, build };
