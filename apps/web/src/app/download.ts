import type { ConvertedFile } from '../core/client.ts';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// 이미 압축된 형식은 다시 압축하지 않고(level 0) 담기만 한다 → 빠르다
const STORED = /\.(jpe?g|png|webp|avif|gif|pdf|zip|xlsx|heic)$/i;

export function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map(n => {
    const c = used.get(n) ?? 0;
    used.set(n, c + 1);
    return c ? n.replace(/(\.[^.]+)?$/, ext => ` (${c + 1})${ext}`) : n;
  });
}

export async function downloadZip(files: ConvertedFile[], name: string) {
  const { zip } = await import('fflate');
  const names = uniqueNames(files.map(f => f.name));
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (let i = 0; i < files.length; i++) {
    const n = names[i]!;
    entries[n] = [new Uint8Array(await files[i]!.blob.arrayBuffer()), { level: STORED.test(n) ? 0 : 6 }];
  }
  const data = await new Promise<Uint8Array>((res, rej) => zip(entries, (err, out) => (err ? rej(err) : res(out))));
  downloadBlob(new Blob([data as BlobPart], { type: 'application/zip' }), name);
}
