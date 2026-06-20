FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
