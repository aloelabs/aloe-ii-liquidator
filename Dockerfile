FROM node:20 as builder

WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install
COPY . .
RUN yarn build

FROM node:20-slim

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY package.json yarn.lock ./

EXPOSE 80
CMD [ "node", "lib/index.js" ]
