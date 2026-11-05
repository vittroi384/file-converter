// 타입 정의가 없는 패키지
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}
