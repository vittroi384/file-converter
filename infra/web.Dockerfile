# 웹: 한 번 빌드해 두 이미지로 — web(nginx, 구운 HTML·정적 파일)과 ssr(Node, 롱테일 주소 스트리밍 렌더)
# PUBLIC_URL은 canonical·hreflang·사이트맵 주소에 박히므로 빌드 때 정한다.
FROM node:24-alpine AS build
WORKDIR /app
ARG PUBLIC_URL=http://localhost:8080
ARG BUILD_ID=dev
ENV PUBLIC_URL=$PUBLIC_URL BUILD_ID=$BUILD_ID
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @fc/web

# SSR 실행에 필요한 것만(react·react-dom·아이콘). 개발 도구·WASM 코덱은 서버 렌더에 안 쓴다.
# 버전은 개발 잠금 파일과 같게(서버·브라우저 렌더가 어긋나면 하이드레이션이 깨진다)
FROM node:24-alpine AS ssr-deps
WORKDIR /deps
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund react@19.3.1 react-dom@19.3.1 @phosphor-icons/react@2.1.10

FROM node:24-alpine AS ssr
WORKDIR /app/apps/web
ENV NODE_ENV=production PORT=8790
COPY --from=ssr-deps /deps/node_modules /app/node_modules
COPY --from=build /app/apps/web/dist-server ./dist-server
COPY --from=build /app/apps/web/scripts/ssr-server.mjs ./scripts/ssr-server.mjs
USER node
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8790/__ssr/metrics >/dev/null || exit 1
CMD ["node", "scripts/ssr-server.mjs"]

FROM nginx:1.29-alpine AS web
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/security.conf /etc/nginx/snippets/security.conf
COPY infra/nginx/grafana-security.conf /etc/nginx/snippets/grafana-security.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
