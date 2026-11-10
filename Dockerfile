FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4317 NODE_ENV=production DATA_DIR=/app/data
EXPOSE 4317
CMD ["node", "src/server.mjs"]
