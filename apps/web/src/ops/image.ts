// 형식 변환 + 크기 조절. HEIC·PSD·SVG도 같은 경로(디코드 → 조절 → 인코드).
import type { OpRunner } from '../core/types.ts';
import { decodeImage, encodeImage, resizeImage, renameExt, IMAGE_OUTS, MIME, type ImageOut } from './codecs.ts';

export const run: OpRunner = async (inputs, options, ctx) => {
  const input = inputs[0]!;
  const to = (IMAGE_OUTS.includes(options.to as ImageOut) ? options.to : 'png') as ImageOut;
  ctx.progress(0.1, '여는 중');
  const maxWidth = options.maxWidth as number | undefined, maxHeight = options.maxHeight as number | undefined;
  const { img, from, note } = await decodeImage(input, { svgWidth: maxWidth, maxWidth, maxHeight });
  ctx.progress(0.4, '크기 조절');
  const sized = await resizeImage(img, options.maxWidth as number | undefined, options.maxHeight as number | undefined);
  ctx.progress(0.6, '저장 형식으로 바꾸는 중');
  const buf = await encodeImage(sized, to, { quality: options.quality as number | undefined, engine: options.engine as 'wasm' | 'native' | undefined });
  return {
    outputs: [{ name: renameExt(input.name, to), type: MIME[to], buf }],
    meta: { from, width: sized.width, height: sized.height, note },
  };
};
