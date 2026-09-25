# 쿠팡 특가 알리미 - single-container deployment
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8787
ENV PORT=8787 HOST=0.0.0.0 DB_PATH=/app/data/deals.db
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server/main.js"]
