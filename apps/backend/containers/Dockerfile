FROM node:24-trixie-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash tmux git openssh-client curl ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN printf 'set -g default-shell /bin/bash\nset -g history-limit 2000\n' > /etc/tmux.conf
RUN npm install -g typescript
WORKDIR /workspace
CMD ["sleep", "infinity"]
