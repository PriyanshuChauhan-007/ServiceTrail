# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:1.28-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY <<'NGINX' /etc/nginx/nginx.conf
worker_processes auto;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 1024; }
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /dev/stdout;
    sendfile on;
    server_tokens off;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;
    map $uri $response_cache_control {
        default "no-cache";
        ~^/api/ "no-store";
        ~^/assets/ "public, max-age=31536000, immutable";
        /sw.js "no-cache, no-store, must-revalidate";
    }
    server {
        listen 8080;
        root /usr/share/nginx/html;
        index index.html;
        client_max_body_size 11m;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy no-referrer always;
        add_header Cache-Control $response_cache_control always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;
        location /api/ {
            proxy_pass http://api:8000;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_no_cache 1;
            proxy_cache_bypass 1;
            proxy_read_timeout 60s;
        }
        location = /api { return 404; }
        location = /healthz { access_log off; default_type text/plain; return 200 "ok\n"; }
        location = /sw.js {
            add_header Cache-Control "no-cache, no-store, must-revalidate" always;
            add_header Service-Worker-Allowed "/" always;
            add_header X-Content-Type-Options nosniff always;
            try_files $uri =404;
        }
        location = /index.html { try_files $uri =404; }
        location = /manifest.webmanifest { default_type application/manifest+json; try_files $uri =404; }
        location /assets/ { try_files $uri =404; }
        location / { try_files $uri $uri/ /index.html; }
    }
}
NGINX
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
