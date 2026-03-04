# ============================================
# PROPTREX Early Access — Coolify-Ready Dockerfile
# ============================================

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install --production

# ============================================

FROM node:20-alpine

WORKDIR /app

# Güvenlik: non-root kullanıcı
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Bağımlılıkları kopyala
COPY --from=builder /app/node_modules ./node_modules

# Uygulama dosyalarını kopyala
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/

# Non-root olarak çalıştır
USER appuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

# Veritabanını başlat, sonra sunucuyu çalıştır
CMD ["sh", "-c", "node src/db-init.js && node src/server.js"]
