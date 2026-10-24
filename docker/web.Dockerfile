# syntax=docker/dockerfile:1
# Vue PWA built with Node, served by nginx, which is also the reverse proxy in
# front of the API. Build context: ./front; the nginx config comes from the
# extra build context "nginx" (./docker/nginx, see compose.yaml).

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# The MSW worker is dev-only; never ship it.
RUN npm run build && rm -f dist/mockServiceWorker.js

# Unprivileged nginx: runs as uid 101 and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY --from=nginx nginx.conf /etc/nginx/nginx.conf
COPY --from=nginx conf.d/ /etc/nginx/conf.d/
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/nginx-health || exit 1
