import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// SharedArrayBuffer(WASM 스레드)를 쓰려면 교차 출처 격리 헤더가 필요하다
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const ACCEPT = {
  'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.heic', '.heif', '.svg'],
  'image/vnd.adobe.photoshop': ['.psd'],
  'application/pdf': ['.pdf'],
  'text/csv': ['.csv'],
  'text/tab-separated-values': ['.tsv'],
  'application/json': ['.json'],
  'application/yaml': ['.yaml', '.yml'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'video/mp4': ['.mp4', '.m4v'],
  'video/quicktime': ['.mov'],
  'video/webm': ['.webm'],
  'audio/mp4': ['.m4a'],
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false, // src/pwa.ts에서 직접 등록
      // 오프라인 캐시 없음(사용자 결정 2026-11-04). 서비스 워커는 공유하기 받기만 → 미리 저장 목록을 넣지 않는다
      injectManifest: { injectionPoint: undefined, rollupFormat: 'iife' },
      manifest: {
        name: '파일 변환 — 업로드 없이 브라우저에서',
        short_name: '파일 변환',
        description: '사진·PDF·엑셀을 서버로 보내지 않고 이 기기 안에서 변환해요.',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#3b5bfd',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 모바일 '공유하기' 목록에 나타나게
        share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data', params: { files: [{ name: 'files', accept: Object.values(ACCEPT).flat() }] } },
        // PC에 설치하면 '연결 프로그램'에 나타나게
        file_handlers: [{ action: '/', accept: ACCEPT }],
      } as never,
    }),
  ],
  server: { headers: isolation, proxy: { '/api': 'http://localhost:8787' } },
  preview: { headers: isolation, proxy: { '/api': 'http://localhost:8787' } },
  worker: { format: 'es' },
  // WASM을 new URL(..., import.meta.url)로 찾는 패키지는 사전 번들링에서 빼야 경로가 안 깨진다
  optimizeDeps: { exclude: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/webp', '@jsquash/avif', '@jsquash/oxipng', '@jsquash/resize', '@resvg/resvg-wasm', 'libheif-js'] },
  build: { target: 'es2022' },
});
