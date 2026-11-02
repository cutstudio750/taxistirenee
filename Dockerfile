# Image du site complet (Node.js) : docker build -t taxi-saint-irenee . && docker run -p 3000:3000 -v taxi-data:/data --env-file .env taxi-saint-irenee
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
