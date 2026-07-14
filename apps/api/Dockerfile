FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @riftcoach/api... --frozen-lockfile=false
RUN pnpm --filter @riftcoach/api build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app ./
EXPOSE 8787
CMD ["pnpm", "--filter", "@riftcoach/api", "start"]
