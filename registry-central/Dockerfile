FROM node:20-alpine

# Instalar PostgreSQL client para migrations
RUN apk add --no-cache postgresql-client bash

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY init-db.sh ./

RUN npm run build
RUN chmod +x init-db.sh

EXPOSE 3000

# Executar migração e iniciar app
ENTRYPOINT ["./init-db.sh"]
CMD ["npm", "start"]
