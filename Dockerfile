FROM node:24-alpine
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY --chown=node:node package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4317 NODE_ENV=production DATA_DIR=/app/data
EXPOSE 4317
CMD ["node", "src/server.mjs"]
