FROM node:24-alpine
WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/database packages/database

CMD ["npm", "run", "db:migrate", "--workspace", "@cubic/database"]
