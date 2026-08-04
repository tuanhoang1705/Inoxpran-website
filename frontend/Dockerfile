# syntax=docker/dockerfile:1.7

ARG NODE_RUNTIME_IMAGE=node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436

FROM ${NODE_RUNTIME_IMAGE} AS build
ENV NPM_CONFIG_FETCH_RETRIES=5 \
	NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
	NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
	NPM_CONFIG_FETCH_TIMEOUT=300000
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --fund=false
COPY . .
RUN npm run build

FROM ${NODE_RUNTIME_IMAGE}
ENV NPM_CONFIG_FETCH_RETRIES=5 \
	NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
	NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
	NPM_CONFIG_FETCH_TIMEOUT=300000
WORKDIR /app

COPY --from=build --chown=node:node /app/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --fund=false

COPY --from=build --chown=node:node /app/build ./build
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=4173
ENV BODY_SIZE_LIMIT=50M
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4173') + '/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

USER node
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build"]
