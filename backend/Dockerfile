# syntax=docker/dockerfile:1.7

ARG NODE_RUNTIME_IMAGE=node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436
FROM ${NODE_RUNTIME_IMAGE}
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000

WORKDIR /app

# Cài deps trước để tận dụng cache
COPY package*.json ./

# Cài dependency production đúng lockfile; thiếu lockfile phải fail build.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --fund=false

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=3056
EXPOSE 3056

USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3056/health/ready').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
