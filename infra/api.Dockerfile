# API: Node 24는 .ts를 그대로 실행(타입만 지움). 빌드 단계 없음.
FROM node:24-alpine
WORKDIR /app
ARG BUILD_ID=dev
ENV NODE_ENV=production BUILD_ID=$BUILD_ID
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts -w @fc/api -w @fc/shared --include-workspace-root=false
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
# 볼륨은 처음 만들 때 이 폴더의 소유권을 따른다 → node 사용자가 쓸 수 있게(안 하면 EACCES, 실제로 겪음)
RUN mkdir -p /data /ctl && chown node:node /data /ctl
USER node
EXPOSE 8787 9464
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "apps/api/src/main.ts"]
