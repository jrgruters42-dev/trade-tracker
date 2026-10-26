FROM node:22-alpine

WORKDIR /app

COPY mcp-server/package*.json ./
RUN npm install --omit=dev

COPY mcp-server/ ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "standalone-sse-server.js"]
