FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build client and server bundles, then prune development dependencies
RUN npm run build && npm prune --omit=dev

# Change ownership of the application directory to the non-root node user
RUN chown -R node:node /app

# Switch to the node user for runtime execution
USER node

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
