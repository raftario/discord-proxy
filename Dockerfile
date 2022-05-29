FROM node:16-alpine

RUN apk add --no-cache python3 make g++

COPY . .

RUN npm ci
RUN npm run build

CMD ["npm", "run", "prod"]
