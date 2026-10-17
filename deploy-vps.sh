#!/usr/bin/env bash
# ==============================================================================
# SCRIPT DE INSTALACIÓN Y DESPLIEGUE EN VPS (Ubuntu/Debian)
# Servidor destino: 173.224.115.126 | Dominio No-IP: powerpanel.ddns.net
# ==============================================================================
set -e

export DEBIAN_FRONTEND=noninteractive

echo "🚀 [1/6] Actualizando paquetes e instalando Nginx, Git, Curl y Certbot..."
apt-get update -y
apt-get install -y curl git ufw nginx certbot python3-certbot-nginx build-essential

echo "🟢 [2/6] Verificando Node.js 20 LTS..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "⚙️ [3/6] Instalando PM2 globalmente..."
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "📦 [4/6] Instalando dependencias de OmniPanel en /opt/omnipanel-consorcio..."
cd /opt/omnipanel-consorcio
npm install --omit=dev

echo "🌐 [5/6] Configurando Nginx Reverse Proxy para powerpanel.ddns.net y 173.224.115.126..."
cat >/etc/nginx/sites-available/omnipanel <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name powerpanel.ddns.net 173.224.115.126 _;

    client_max_body_size 35M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/omnipanel /etc/nginx/sites-enabled/omnipanel
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "🔥 [6/6] Iniciando OmniPanel con PM2 y configurando Firewall..."
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root || true

ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 3000/tcp || true

# Intentar emitir certificado SSL gratuito con Let's Encrypt para powerpanel.ddns.net si ya apunta a esta IP
echo "🔒 Verificando certificado SSL (Let's Encrypt) para powerpanel.ddns.net..."
certbot --nginx -d powerpanel.ddns.net --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "ℹ️ Aviso SSL: Certbot se omitió o el dominio aún está propagando DNS. HTTP activo en puerto 80 y 3000."

echo "================================================================"
echo "✅ OMNIPANEL DESPLEGADO EXITOSAMENTE EN EL VPS"
echo "🌐 Dominio: http://powerpanel.ddns.net (y https:// si SSL activo)"
echo "🖥️ IP Directa: http://173.224.115.126 y http://173.224.115.126:3000"
echo "================================================================"
