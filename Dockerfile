FROM node:20-alpine
WORKDIR /app

# Install system dependencies for audio streaming and node builds
RUN apk add --no-cache python3 make g++ git ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/

ENV PORT=3001
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server/index.js"]
