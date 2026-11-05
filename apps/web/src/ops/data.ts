// 데이터 변환: CSV·TSV·XLSX·JSON·YAML 사이. 순수 함수로 짜서 Node 테스트 가능.
import type { OpRunner } from '../core/types.ts';
import { ConvertError } from '../core/types.ts';
import { renameExt } from './codecs.ts';
import { formatFromName } from '@fc/shared';

export type DataFmt = 'csv' | 'tsv' | 'json' | 'yaml' | 'xlsx';
export const DATA_OUTS: DataFmt[] = ['csv', 'tsv', 'json', 'yaml', 'xlsx'];
type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;

// UTF-8로 읽어 보고 깨지면 EUC-KR(엑셀 한국어 기본 저장)로 다시 읽는다
// hint: 사용자가 보고 있는 화면 언어(ja면 Shift_JIS, zh면 GBK). 점수가 거의 같을 때만 가르는 0.03(0.15는 증거를 뒤집었다: 한국어 화면 17/20).
export function decodeText(buf: ArrayBuffer, hint?: string): { text: string; encoding: string } {
  const b = new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
  } catch { /* UTF-8이 아님 → 옛 인코딩 후보 */ }
  // 처음엔 UTF-8이 아니면 무조건 EUC-KR로 읽어서 일본(Shift_JIS)·중국(GBK)·유럽(Windows-1252) 엑셀 CSV가 깨졌다.
  // 같은 바이트가 여러 인코딩에서 '오류 없이' 읽히므로, 읽은 글자가 그 언어다운지 점수를 매긴다.
  let best = { text: '', encoding: 'windows-1252', score: -Infinity };
  for (const [enc, fit] of CANDIDATES) {
    let text: string;
    try { text = new TextDecoder(enc, { fatal: true }).decode(b); } catch { continue; }
    const s = fit(text) + (HINT[hint ?? ''] === enc ? 0.03 : 0);
    if (s > best.score) best = { text, encoding: enc, score: s };
  }
  if (best.score === -Infinity) return { text: new TextDecoder('windows-1252').decode(b), encoding: 'windows-1252' };
  return { text: best.text, encoding: best.encoding };
}

// 점수 = 그 언어에서 '자주 쓰는' 글자 비율 − 이상한 글자 비율. 표본은 앞 4만 자.
// 1차 시도는 '한자 비율'만 봐서, 가나 없이 한자뿐인 일본어 주소록(山田太郎, 東京都新宿区)을 GBK로 오판했다.
// 잘못 읽은 바이트는 대개 드문 한자로 나오므로, 상용 한자 목록에 드는지를 본다.
const JA_COMMON = '日本人年大十二一国中長出三時行見月分後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨会社者事自方地場動新所業代思明手同度家通部田内全問最物発都市区町村県府道京駅住電話番号氏様株式有限佐藤鈴木高橋渡辺伊加藤吉松井山口林清池森阿部太郎花子一郎次郎和美由恵子郵便丁目番地';
const ZH_COMMON = '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台象记边共风战干接它许八特觉望直服毛林题建南度统色字请交爱让认算论百吃义科怎元社术结六功指思非流每青管夫连远资队跟带花快条院变联言权往展该领传近留红治决周保达办运武半候七必城父强步完革深区即求品士转量空甚众技轻程告江语英基派满式李息写呢识极令黄德收脸钱党倒未持取设始版双历越史商千片容研像找友孩站广改议形委早房音火际则首单据导影失拿网香似斯专石若兵弟谁校读志飞观争究包组造落视济喜离虽坏兴切希集址话号码省县镇街乡州浙苏粤沪湘鄂豫鲁陕津渝闽赣皖辽吉黑桂贵滇藏蒙宁新疆琼伟娜丽芳敏静磊洋勇艳杰涛超明霞秀娟';
const KO_HANGUL = /[가-힣]/g;
// 한국어 상용 음절(일반 빈도 기준, 시험 데이터를 보지 않고 작성). GBK 한자 바이트가 EUC-KR 한글 범위와 겹쳐서
// 중국어 파일이 '오류 없이 한글로' 읽히는데, 그렇게 나온 음절은 대개 드물다(두 번째 검증 세트 gb18030-1에서 발견).
const KO_COMMON = '이다는에의하고를을지가기리사서로자어수시대도정일한아나인적해장전그구주상부들성소것국제니게무비경라우원거화여보동오마문신만공생관내연조방위분년세중행실요와면학과계명개회물발있었습되던었니까데된할함된서울부산인천대구광주전남북충청강원경기제주김이박최윤임송권황안류홍손배백허유남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경범호양전화번호주소이름성명날짜메모비고합계금액수량단가품목상품가격재고매출목표부서팀직급사원과장차장부장대리회사학교학년반병원진료환자도서저자출판지점본점지역시군구읍면동리로길층호실월일시분초요일오전후년도분기분류코드번호담당자연락처이메일계좌은행카드현금결제완료대기취소진행중예정';
// 한중일만 힌트. windows-1252는 어떤 바이트든 오류 없이 읽어서 가산점을 주면 진짜 증거(한자·가나)를 이겼다(영어 화면 18/20로 악화).
const HINT: Record<string, string> = { ko: 'euc-kr', ja: 'shift_jis', zh: 'gb18030' };
const ratio = (t: string, re: RegExp) => { const s = t.slice(0, 40000); return s.length ? (s.match(re)?.length ?? 0) / s.length : 0; };
const commonRatio = (t: string, common: string) => {
  let cjk = 0, hit = 0;
  for (const ch of t.slice(0, 40000)) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x4e00 && c <= 0x9fff) { cjk++; if (common.includes(ch)) hit++; }
  }
  return cjk ? hit / cjk : 0;
};
const koCommon = (t: string) => {
  let n = 0, hit = 0;
  for (const ch of t.slice(0, 40000)) if (ch >= '가' && ch <= '힣') { n++; if (KO_COMMON.includes(ch)) hit++; }
  return n ? hit / n : 0;
};
const ODD = /[\u0080-\u009f�㐀-䶿-]/g; // 제어 문자·대체 문자·희귀 한자·사용자 정의 영역
const CANDIDATES: [string, (t: string) => number][] = [
  ['euc-kr', t => ratio(t, KO_HANGUL) * koCommon(t) - 3 * ratio(t, ODD) - ratio(t, /[一-鿿]/g)], // 한국어 CSV에 한자는 드물다
  ['shift_jis', t => ratio(t, /[぀-ヿ]/g) * 1.5 + ratio(t, /[一-鿿]/g) * commonRatio(t, JA_COMMON) - 3 * ratio(t, ODD) - ratio(t, /[ｦ-ﾟ]/g)],
  ['gb18030', t => ratio(t, /[一-鿿]/g) * commonRatio(t, ZH_COMMON) - 3 * ratio(t, ODD) - 2 * ratio(t, /[぀-ヿ가-힣]/g)],
  ['windows-1252', t => 0.05 + ratio(t, /[A-Za-zÀ-ÿ]/g) * 0.1 - 3 * ratio(t, ODD) - ratio(t, /[ÃÂ][\u0080-¿]/g) * 5], // 최후 후보(유럽어)
];

// 숫자처럼 보여도 앞자리 0(전화번호·우편번호)이나 아주 긴 수(카드·주문번호)는 문자열로 둔다
export function inferCell(s: string): Cell {
  const t = s.trim();
  if (t === '') return null;
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  return s;
}

export function flattenObject(obj: unknown, prefix = '', out: Row = {}): Row {
  if (obj === null || typeof obj !== 'object') { out[prefix || 'value'] = obj as Cell; return out; }
  if (Array.isArray(obj) && obj.every(v => v === null || typeof v !== 'object')) { out[prefix || 'value'] = obj.join(', '); return out; }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') flattenObject(v, key, out);
    else out[key] = v as Cell;
  }
  return out;
}

export interface Parsed {
  rows?: Row[]; // 표
  tree?: unknown; // 표로 못 바꾸는 구조(JSON/YAML 원본)
  sheets?: Record<string, Row[]>;
  encoding?: string;
}

export async function parse(buf: ArrayBuffer, from: DataFmt, opts: { typed?: boolean; lang?: string } = {}): Promise<Parsed> {
  const typed = opts.typed ?? true;
  if (from === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    const sheets: Record<string, Row[]> = {};
    for (const name of wb.SheetNames) sheets[name] = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name]!, { defval: null, raw: true });
    return { sheets, rows: sheets[wb.SheetNames[0]!] ?? [] };
  }
  const { text, encoding } = decodeText(buf, opts.lang);
  if (from === 'csv' || from === 'tsv') {
    const Papa = (await import('papaparse')).default;
    const r = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', delimiter: from === 'tsv' ? '\t' : '' });
    if (r.errors.length && !r.data.length) throw new ConvertError('decode', 'CSV를 읽을 수 없어요');
    const rows = r.data.map(rec => Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, typed ? inferCell(v ?? '') : (v ?? '')]))) as Row[];
    return { rows, encoding };
  }
  let tree: unknown;
  try {
    tree = from === 'json' ? JSON.parse(text) : (await import('yaml')).parse(text);
  } catch {
    throw new ConvertError('decode', `${from.toUpperCase()} 문법 오류`);
  }
  const arr = Array.isArray(tree) ? tree : null;
  const rows = arr && arr.every(v => v !== null && typeof v === 'object' && !Array.isArray(v)) ? arr.map(v => flattenObject(v)) : undefined;
  return { tree, rows, encoding };
}

function columns(rows: Row[]) {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  return cols;
}

export async function serialize(p: Parsed, to: DataFmt, opts: { bom?: boolean } = {}): Promise<ArrayBuffer> {
  const enc = (s: string, bom = false) => new TextEncoder().encode((bom ? '﻿' : '') + s).buffer as ArrayBuffer;
  if (to === 'json' || to === 'yaml') {
    const value = p.tree ?? (p.sheets && Object.keys(p.sheets).length > 1 ? p.sheets : p.rows);
    if (to === 'json') return enc(JSON.stringify(value, null, 2) + '\n');
    return enc((await import('yaml')).stringify(value));
  }
  const rows = p.rows ?? (p.tree !== undefined ? [flattenObject(p.tree)] : []);
  if (to === 'xlsx') {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const sheets = p.sheets && Object.keys(p.sheets).length > 1 ? p.sheets : { Sheet1: rows };
    for (const [name, rs] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rs, { header: columns(rs) }), name.slice(0, 31));
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
    return out;
  }
  const Papa = (await import('papaparse')).default;
  const cols = columns(rows);
  const text = Papa.unparse({ fields: cols, data: rows.map(r => cols.map(c => r[c] ?? '')) }, { delimiter: to === 'tsv' ? '\t' : ',', newline: '\r\n' });
  return enc(text + '\r\n', opts.bom ?? to === 'csv'); // 엑셀이 한글을 제대로 열도록 CSV엔 BOM
}

export const run: OpRunner = async (inputs, o) => {
  const p = inputs[0]!;
  const from = formatFromName(p.name) as DataFmt;
  if (!DATA_OUTS.includes(from)) throw new ConvertError('unsupported', '데이터 파일이 아니에요');
  const to = (DATA_OUTS.includes(o.to as DataFmt) ? o.to : 'json') as DataFmt;
  const parsed = await parse(p.buf, from, { typed: o.typed !== false, lang: o.lang as string | undefined });
  const buf = await serialize(parsed, to, { bom: o.bom as boolean | undefined });
  const mime: Record<DataFmt, string> = { csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', yaml: 'application/yaml', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return {
    outputs: [{ name: renameExt(p.name, to), type: mime[to], buf }],
    meta: { rows: parsed.rows?.length ?? 0, sheets: parsed.sheets ? Object.keys(parsed.sheets).length : 0, encoding: parsed.encoding },
  };
};
