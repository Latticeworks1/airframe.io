FROM node:20-slim

# Create a non-root user with UID 1000
RUN useradd -m -u 1000 user

WORKDIR /home/user/app

# Copy package files and install dependencies
COPY --chown=user package*.json ./
RUN npm ci

# Copy the rest of the application files
COPY --chown=user . .

# Build client and server bundles, then prune development dependencies
RUN npm run build && npm prune --omit=dev

# Switch to the non-root user
USER user

EXPOSE 7860

ENV PORT=7860
ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
