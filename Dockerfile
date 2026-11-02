FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BILI_BROWSER_FETCH=1

RUN apk add --no-cache python3 py3-pip \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --only-binary=:all: curl_cffi==0.17.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js resolver.js bili-link.js streams.js ./
COPY server ./server

EXPOSE 3000

CMD ["npm", "start"]
