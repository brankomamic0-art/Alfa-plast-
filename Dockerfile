# ---------- Build frontend ----------
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci || npm install
COPY client/ ./
RUN npm run build

# ---------- Server ----------
FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && (npm ci --omit=dev || npm install --omit=dev)
COPY server/ ./server/
COPY db/ ./db/
COPY --from=client-build /app/client/dist ./client/dist
ENV NODE_ENV=production
ENV UPLOAD_DIR=/data/uploads
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "index.js"]
