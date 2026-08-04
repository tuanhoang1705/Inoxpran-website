ARG NODE_RUNTIME_IMAGE=node:24.18.0-alpine3.23@sha256:595398b0081eacda8e1c4c5b97b76cd1020e4d58a8ebcb4843b9bca1e79e7436
FROM ${NODE_RUNTIME_IMAGE}

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /opt/inoxpran-openclaw-updater
COPY docker-update-daemon.mjs docker-update-worker.mjs ./

USER node
CMD ["node", "docker-update-daemon.mjs"]
