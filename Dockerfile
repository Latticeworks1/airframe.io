FROM node:20-slim

# The base image already contains a 'node' user with UID 1000.
WORKDIR /home/node/app

# Copy package files with ownership set to the node user
COPY --chown=node:node package*.json ./

# Switch to the node user for all subsequent commands
USER node

# Install dependencies
RUN npm ci

# Copy the rest of the application files
COPY --chown=node:node . .

# Build client and server bundles, then prune development dependencies
RUN npm run build && npm prune --omit=dev

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
