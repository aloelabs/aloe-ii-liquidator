FROM ubuntu AS aloe-liquidator
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git \
  nano \
  nodejs \
  npm \
  && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/bin/bash"]