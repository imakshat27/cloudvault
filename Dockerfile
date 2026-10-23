FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/backend/certs && node --input-type=module -e "import fs from 'node:fs'; const r=await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem'); if(!r.ok) throw Error('RDS CA download failed'); fs.writeFileSync('certs/rds.pem',await r.text());"
COPY backend/src ./src
COPY --from=web /app/frontend/dist /app/frontend/dist
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "src/start.js"]
