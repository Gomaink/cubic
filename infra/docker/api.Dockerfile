FROM node:24-alpine AS build
WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/database packages/database
COPY packages/shared packages/shared
RUN npm run build:packages && npm run build --workspace @cubic/api

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/database/package.json packages/database/package.json
COPY --from=build /app/packages/database/dist packages/database/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist

USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
