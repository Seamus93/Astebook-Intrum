FROM node:20-alpine

WORKDIR /app

# Usa env per porta e ambiente; niente configurazioni hard-coded del VPS
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["npm", "start"]
