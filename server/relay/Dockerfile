# som-relay: device relay for WiFi OTA + serial (see README.md).
# Two stages: compile TypeScript, then a runtime image with production deps only, non-root.

FROM node:22-alpine AS build
WORKDIR /app
# pnpm version comes from the `packageManager` field in package.json.
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=build /app/dist ./dist
# The node image ships an unprivileged `node` user.
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
