FROM node:20

WORKDIR /app
COPY package.json ./
RUN yarn install
COPY . .
EXPOSE 8080
RUN yarn build
CMD [ "node", "lib/index.js" ]
