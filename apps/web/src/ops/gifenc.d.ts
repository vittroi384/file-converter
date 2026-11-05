// gifenc(MIT)에는 타입 정의가 없어 쓰는 부분만 적는다. quantize·applyPalette는 출처가 불분명해 쓰지 않는다(gifpal.ts 참고)
declare module 'gifenc/src/index.js' {
  type Palette = number[][];
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
