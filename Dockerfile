FROM node:16

WORKDIR /app
COPY package.json ./
RUN yarn install
COPY . .
EXPOSE 8080
RUN yarn build
CMD [ "node", "lib/index.js" ]
