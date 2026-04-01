FROM node:20-alpine
WORKDIR /app
# Copy backend deps
COPY self-hosted/package.json ./self-hosted/
RUN cd self-hosted && npm install --omit=dev
# Copy tool HTML
COPY tool.html ./
# Copy server
COPY self-hosted/server.js ./self-hosted/
EXPOSE 3000
CMD ["node", "self-hosted/server.js"]
