FROM node:16

WORKDIR app/

COPY . .

ENTRYPOINT [ "/bin/bash" ]
