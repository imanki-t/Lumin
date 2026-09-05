# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ ffmpeg

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "--max-old-space-size=1024", "dist/index.js"]
