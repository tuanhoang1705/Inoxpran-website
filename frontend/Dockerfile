# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS build
ENV NPM_CONFIG_FETCH_RETRIES=5 \
	NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
	NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
	NPM_CONFIG_FETCH_TIMEOUT=300000
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --fund=false
COPY . .
RUN npm run build

FROM node:20-alpine
ENV NPM_CONFIG_FETCH_RETRIES=5 \
	NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
	NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
	NPM_CONFIG_FETCH_TIMEOUT=300000
WORKDIR /app

COPY --from=build /app/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --fund=false

COPY --from=build /app/build ./build

ENV NODE_ENV=production
ENV PORT=4173
ENV BODY_SIZE_LIMIT=10M
EXPOSE 4173

CMD ["node", "build"]
