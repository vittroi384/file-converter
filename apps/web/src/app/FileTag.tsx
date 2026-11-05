// 파일 형식 라벨: 실제 프로그램 파일 아이콘처럼 귀퉁이가 접힌 꼬리표. 색은 형식마다 고정(대상을 따른다).
const TONE: Record<string, string> = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', heic: 'heic', gif: 'gif', bmp: 'bmp', psd: 'psd', svg: 'svg',
  pdf: 'pdf', xlsx: 'xlsx', csv: 'csv', tsv: 'csv', json: 'json', yaml: 'yaml', zip: 'zip',
};
export function FileTag({ fmt, small }: { fmt: string; small?: boolean }) {
  const f = fmt.toLowerCase();
  return <span className={`ftag t-${TONE[f] ?? 'other'}${small ? ' sm' : ''}`}>{f === 'jpeg' ? 'JPG' : f.toUpperCase()}</span>;
}
