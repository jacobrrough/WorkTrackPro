FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git

COPY . .

RUN npm ci
RUN npm run build

EXPOSE 4173

CMD ["npm", "start"]
