FROM node:24-alpine AS build
WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY apps/web apps/web
RUN npm run build --workspace @cubic/web

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/web/build apps/web/build

USER node
EXPOSE 3000
CMD ["node", "apps/web/build"]
