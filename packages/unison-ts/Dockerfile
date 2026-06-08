FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN node -e "const fs=require('fs');const p='dist/start.js';let s=fs.readFileSync(p,'utf8');if(!s.startsWith('#!'))fs.writeFileSync(p,'#!/usr/bin/env node\n'+s);fs.chmodSync(p,0o755);"
ENTRYPOINT ["node", "dist/start.js"]
