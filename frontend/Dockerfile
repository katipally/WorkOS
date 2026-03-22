FROM node:22-alpine AS builder

WORKDIR /app

# Accept API URL as build arg — empty string means relative URLs (for nginx proxy)
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Backend URL for server-side rewrites (within Docker network)
ARG BACKEND_URL="http://backend:8000"
ENV BACKEND_URL=${BACKEND_URL}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV BACKEND_URL="http://backend:8000"

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
