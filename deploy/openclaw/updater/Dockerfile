FROM node:24-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /opt/inoxpran-openclaw-updater
COPY docker-update-daemon.mjs docker-update-worker.mjs ./

USER node
CMD ["node", "docker-update-daemon.mjs"]
