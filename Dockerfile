FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
