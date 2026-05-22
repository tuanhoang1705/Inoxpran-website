# syntax=docker/dockerfile:1.7

FROM node:20-alpine
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000

WORKDIR /app

# Cài deps trước để tận dụng cache
COPY package*.json ./

# Nếu có lock thì dùng npm ci, nếu không thì fallback npm install
RUN --mount=type=cache,target=/root/.npm npm install --omit=dev --no-audit --fund=false

COPY . .

ENV NODE_ENV=production
ENV PORT=3056
EXPOSE 3056

CMD ["node", "server.js"]
