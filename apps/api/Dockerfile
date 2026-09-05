# Production image for the QUEST API (built by CI, pushed to ECR, referenced by Terraform var).
# Multi-stage: install → build → minimal runtime with a non-root user and read-only root FS.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @quest/api...
RUN pnpm --filter @quest/api... build
RUN pnpm --filter @quest/api --prod deploy --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S quest && adduser -S quest -G quest
COPY --from=build --chown=quest:quest /out /app
USER quest
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
