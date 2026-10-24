# Shared by the /api locations: strip the /api prefix and forward to the Go API.
rewrite ^/api/(.*)$ /$1 break;
proxy_pass http://api;

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# The API's own WriteTimeout is 30 s.
proxy_connect_timeout 5s;
proxy_send_timeout 35s;
proxy_read_timeout 35s;

# Stream large downloads (PDF/CSV exports) instead of spooling them to disk.
proxy_max_temp_file_size 0;

# Responses carry personal data: keep them out of shared caches. The PWA's
# own service worker still caches GETs per token (see front/README.md).
proxy_hide_header Cache-Control;
include /etc/nginx/conf.d/security-headers.inc;
add_header Cache-Control "private, no-cache" always;
