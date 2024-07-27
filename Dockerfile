FROM node:18.20.4-bookworm-slim

WORKDIR /app

COPY package.json .

RUN npm ci

# the app will be mounted readonly in the future?
COPY . .

CMD ["npm", "start"]