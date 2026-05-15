#!/usr/bin/env bash
# HostPanel installer — RHEL 8/9 / Rocky Linux / AlmaLinux
set -euo pipefail

PANEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="20"

echo "======================================="
echo "  HostPanel Installer"
echo "======================================="

# --- Root check ---
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run as root (sudo ./install.sh)" >&2
  exit 1
fi

# ── 1/9  Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt $NODE_VERSION ]]; then
  echo "[1/9] Installing Node.js $NODE_VERSION..."
  curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
  dnf install -y nodejs
fi
echo "[1/9] Node.js $(node -v) ready."

# ── 2/9  System packages ─────────────────────────────────────────────────────
echo "[2/9] Installing system packages..."
dnf install -y epel-release 2>/dev/null || true
dnf install -y httpd mod_ssl mariadb-server postfix dovecot \
               bind bind-utils vsftpd certbot python3-certbot-apache \
               curl tar gzip openssl make gcc-c++ python3

systemctl enable --now httpd mariadb postfix named vsftpd

# ── 3/9  MariaDB ─────────────────────────────────────────────────────────────
echo "[3/9] Configuring MariaDB..."
DB_ROOT_PASS=""
if mysql -u root -e "SELECT 1" &>/dev/null; then
  echo "  MariaDB root is accessible without a password."
  echo "  It is strongly recommended to run mysql_secure_installation manually."
else
  echo "  Running mysql_secure_installation — set a strong root password when prompted."
  mysql_secure_installation
  echo ""
  read -rsp "  Re-enter the MariaDB root password you just set (it will be saved to server/.env): " DB_ROOT_PASS; echo
fi

# ── 4/9  Mail directories ────────────────────────────────────────────────────
echo "[4/9] Configuring mail directories..."
mkdir -p /etc/dovecot /var/mail/vhosts
# /etc/postfix/virtual and /etc/postfix/vmailbox are flat files (Postfix maps),
# not directories — touch them if they don't already exist.
touch /etc/postfix/virtual /etc/postfix/vmailbox /etc/postfix/transport
postmap /etc/postfix/virtual /etc/postfix/vmailbox /etc/postfix/transport 2>/dev/null || true
touch /etc/dovecot/users
chmod 640 /etc/dovecot/users

# ── 5/9  vsftpd ──────────────────────────────────────────────────────────────
echo "[5/9] Configuring FTP..."
mkdir -p /etc/vsftpd/users
touch /etc/vsftpd/user_list
cat >/etc/vsftpd/vsftpd.conf <<'VSFTPD'
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
xferlog_enable=YES
xferlog_std_format=YES
chroot_local_user=YES
allow_writeable_chroot=YES
listen=YES
listen_ipv6=NO
pam_service_name=vsftpd
userlist_enable=YES
userlist_deny=NO
userlist_file=/etc/vsftpd/user_list
user_config_dir=/etc/vsftpd/users
VSFTPD
systemctl enable --now vsftpd

# ── 6/9  HostPanel dependencies + env ───────────────────────────────────────
echo "[6/9] Installing HostPanel..."
cd "$PANEL_DIR"
npm install --workspace=server
npm install --workspace=client

if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env

  # Randomise JWT secret
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s|change-this-to-a-long-random-string-in-production|${JWT_SECRET}|" server/.env

  # Admin password — piped via stdin to avoid shell-expansion of special characters
  # (single quotes, dollar signs, backticks in the password would break shell interpolation)
  read -rsp "Set HostPanel admin password: " ADMIN_PASS; echo
  HASH=$(printf '%s' "${ADMIN_PASS}" | node -e "
    const bcrypt = require('bcryptjs');
    let pw = '';
    process.stdin.on('data', d => pw += d);
    process.stdin.on('end', () => process.stdout.write(bcrypt.hashSync(pw.trim(), 12)));
  ")
  sed -i "s|\\\$2b\\\$12\\\$examplehashhere|${HASH//\//\\/}|" server/.env

  # MariaDB root password
  if [[ -n "${DB_ROOT_PASS}" ]]; then
    sed -i "s|^DB_ROOT_PASS=.*|DB_ROOT_PASS=${DB_ROOT_PASS}|" server/.env
  fi

  # Panel hostname — used for CORS (CLIENT_URL) and the Apache VirtualHost
  echo ""
  read -rp "  Hostname the panel will be accessed at (e.g. panel.example.com) — leave blank to use server IP: " PANEL_HOST_INPUT
  # Strip any accidental protocol prefix the user may have typed
  PANEL_HOST="${PANEL_HOST_INPUT#https://}"
  PANEL_HOST="${PANEL_HOST#http://}"
  PANEL_HOST="${PANEL_HOST%%/*}"
  if [[ -z "${PANEL_HOST}" ]]; then
    PANEL_HOST=$(hostname -I | awk '{print $1}')
    PANEL_PROTO="http"
  else
    PANEL_PROTO="https"
  fi
  sed -i "s|^CLIENT_URL=.*|CLIENT_URL=${PANEL_PROTO}://${PANEL_HOST}|" server/.env
else
  echo "  server/.env already exists — skipping credential prompts."
  # Re-read from existing .env for use in later steps
  _client_url=$(grep -E '^CLIENT_URL=' server/.env | cut -d= -f2-)
  PANEL_PROTO="${_client_url%%://*}"
  PANEL_HOST="${_client_url#*://}"
  PANEL_HOST="${PANEL_HOST%%/*}"
fi

# ── 7/9  Build client ────────────────────────────────────────────────────────
echo "[7/9] Building client..."
cd "$PANEL_DIR"
npm run build --workspace=client

# ── 8/9  Systemd service + Apache reverse proxy ─────────────────────────────
echo "[8/9] Creating systemd service and Apache reverse proxy..."

# Systemd unit
cat >/etc/systemd/system/hostpanel.service <<SERVICE
[Unit]
Description=HostPanel Control Panel
After=network.target mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=${PANEL_DIR}/server
ExecStart=/usr/bin/node ${PANEL_DIR}/server/dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now hostpanel

# Apache reverse proxy
# mod_proxy and mod_proxy_wstunnel (both included in httpd on RHEL/Rocky) are required.
# mod_proxy_wstunnel handles the WebSocket upgrade for the built-in terminal (/ws).
cat >/etc/httpd/conf.d/hostpanel-panel.conf <<VHOST
# HostPanel reverse proxy — generated by install.sh
# The Node process binds to 127.0.0.1:3001 only; port 3001 is NOT opened in the firewall.
<VirtualHost *:80>
  ServerName ${PANEL_HOST}

  # WebSocket upgrade for the built-in terminal endpoint
  ProxyPass        /ws  ws://127.0.0.1:3001/ws
  ProxyPassReverse /ws  ws://127.0.0.1:3001/ws

  # All other traffic forwarded to Node
  ProxyPreserveHost On
  ProxyPass        / http://127.0.0.1:3001/
  ProxyPassReverse / http://127.0.0.1:3001/
</VirtualHost>
VHOST

systemctl reload httpd

# Optional TLS via Let's Encrypt — only applicable when PANEL_HOST is a real domain name
if [[ "${PANEL_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "  Panel host is an IP address — skipping TLS certificate."
  echo "  To add TLS later: point a domain at this server, then run:"
  echo "    certbot --apache -d <your-domain>"
else
  echo ""
  read -rp "  Obtain a Let's Encrypt TLS certificate for ${PANEL_HOST}? [y/N] " WANT_TLS
  if [[ "${WANT_TLS,,}" == "y" ]]; then
    ADMIN_EMAIL=$(grep -E '^SMTP_FROM=' "${PANEL_DIR}/server/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
    ADMIN_EMAIL="${ADMIN_EMAIL:-admin@${PANEL_HOST}}"
    if certbot --apache -d "${PANEL_HOST}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}"; then
      sed -i "s|^CLIENT_URL=http://|CLIENT_URL=https://|" "${PANEL_DIR}/server/.env"
      PANEL_PROTO="https"
      systemctl restart hostpanel
    else
      echo "  WARNING: certbot failed. Run manually after DNS is fully propagated:"
      echo "    certbot --apache -d ${PANEL_HOST}"
    fi
  fi
fi

# ── 9/9  Firewall ────────────────────────────────────────────────────────────
echo "[9/9] Configuring firewall..."
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --permanent --add-service=ftp
  # Port 3001 is proxied through Apache — keep it internal only
  firewall-cmd --permanent --remove-port=3001/tcp 2>/dev/null || true
  firewall-cmd --reload
fi

PANEL_URL_FINAL=$(grep -E '^CLIENT_URL=' "${PANEL_DIR}/server/.env" 2>/dev/null | cut -d= -f2- || echo "http://$(hostname -I | awk '{print $1}')")

echo ""
echo "======================================="
echo "  HostPanel installed successfully!"
echo "======================================="
echo ""
echo "  URL    : ${PANEL_URL_FINAL}"
echo "  Config : ${PANEL_DIR}/server/.env"
echo "  Logs   : journalctl -u hostpanel -f"
echo ""
echo "  ── Manual configuration still required ──────────"
echo ""
echo "  1. SMTP (outbound email — alerts, password resets):"
echo "     Edit ${PANEL_DIR}/server/.env and set:"
echo "       SMTP_HOST=smtp.yourprovider.com"
echo "       SMTP_PORT=587"
echo "       SMTP_USER=your-smtp-username"
echo "       SMTP_PASS=your-smtp-password"
echo "       SMTP_FROM=noreply@yourdomain.com"
echo ""
echo "  2. Stripe payments (optional):"
echo "     Edit ${PANEL_DIR}/server/.env and set:"
echo "       STRIPE_SECRET_KEY=sk_live_..."
echo "       STRIPE_WEBHOOK_SECRET=whsec_..."
echo "       STRIPE_PRICE_ID=price_..."
echo "     Register the webhook endpoint at https://dashboard.stripe.com/webhooks:"
echo "       ${PANEL_URL_FINAL}/api/stripe/webhook"
echo ""
echo "  3. PayPal payments (optional):"
echo "     Edit ${PANEL_DIR}/server/.env and set:"
echo "       PAYPAL_CLIENT_ID=..."
echo "       PAYPAL_CLIENT_SECRET=..."
echo "       PAYPAL_MODE=live"
echo ""
echo "  4. Cloudflare DNS management (optional):"
echo "     Edit ${PANEL_DIR}/server/.env and set:"
echo "       CLOUDFLARE_API_TOKEN=..."
echo ""
echo "  5. After editing .env, restart the panel:"
echo "       systemctl restart hostpanel"
echo ""
echo "  ── Apache modules required (verify they are loaded) ─"
echo "     /etc/httpd/conf.modules.d/00-proxy.conf should contain:"
echo "       LoadModule proxy_module ..."
echo "       LoadModule proxy_http_module ..."
echo "       LoadModule proxy_wstunnel_module ..."
echo "     If the WebSocket terminal does not connect, run:"
echo "       httpd -M | grep proxy"
echo ""
echo "======================================="
