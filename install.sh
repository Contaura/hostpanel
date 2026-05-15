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
# php-cli + php-mysqlnd + php-curl are needed for the Script Installer's
# WordPress/Joomla/Drupal flows: roundcubemail pulls in php-fpm + a few
# extensions, but not the CLI binary or the MySQL driver, so WordPress
# would extract fine and then explode on first hit. Install them up front.
dnf install -y httpd mod_ssl mariadb-server postfix dovecot \
               bind bind-utils vsftpd certbot python3-certbot-apache \
               curl tar gzip openssl make gcc-c++ python3 roundcubemail \
               php-cli php-mysqlnd php-curl php-gd

# wp-cli — required by every endpoint in /api/wordpress/*. It's not in the
# RHEL repos so pull the official phar release. Pinned to LATEST stable to
# match what the WP team currently signs.
if [[ ! -x /usr/local/bin/wp ]]; then
  curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  chmod +x /usr/local/bin/wp
fi

systemctl enable --now httpd mariadb postfix dovecot named vsftpd php-fpm

# ── 3/9  MariaDB ─────────────────────────────────────────────────────────────
echo "[3/9] Configuring MariaDB..."

# Bind MariaDB to loopback only. The panel and every account on this box
# talk to MariaDB over localhost; the default 0.0.0.0 listener just gives
# port scanners a target. Drop-in lives under /etc/my.cnf.d/ so package
# upgrades don't clobber it.
cat >/etc/my.cnf.d/hostpanel-bind.cnf <<'MYCNF'
[mysqld]
bind-address = 127.0.0.1
skip-name-resolve
MYCNF
systemctl restart mariadb 2>/dev/null || true

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

# Connection limits — keep an idle client from holding a slot forever and
# cap concurrent connections per IP so a single client can't exhaust the
# server's session table.
idle_session_timeout=300
data_connection_timeout=120
max_clients=50
max_per_ip=10

# Fixed passive port range so we can open exactly those ports in firewalld
# instead of leaving the whole high range open. 21 is FTP control; the
# range below is the data channel.
pasv_enable=YES
pasv_min_port=10090
pasv_max_port=10100
VSFTPD
systemctl enable --now vsftpd

# ── 6/9  HostPanel dependencies + env ───────────────────────────────────────
echo "[6/9] Installing HostPanel..."
cd "$PANEL_DIR"
npm install --workspace=server
npm install --workspace=client

if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  # server/.env carries the JWT secret, the bcrypt admin hash, the MariaDB
  # root password, and (later) Stripe/PayPal/Cloudflare keys. Lock it down
  # before writing any of those into it so the secrets are never readable to
  # anyone but root.
  chmod 600 server/.env
  chown root:root server/.env 2>/dev/null || true

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

# ── 7/9  Build server + client ───────────────────────────────────────────────
echo "[7/9] Building server and client..."
cd "$PANEL_DIR"
npm run build --workspace=server
npm run build --workspace=client

# ── 8/9  Systemd service + Apache reverse proxy ─────────────────────────────
echo "[8/9] Creating systemd service and Apache reverse proxy..."

# Systemd unit. The panel runs as root because it has to edit /etc/httpd,
# /etc/postfix, /etc/named, /etc/vsftpd, /home/*/.ssh, and spawn a PTY for
# the terminal — but we can still tighten the sandbox around it.
#
# Notably NOT enabled (each would break a working feature):
#   ProtectSystem=full   — we write to /etc/httpd, /etc/postfix, /etc/named
#   ProtectHome=yes      — we manage /home/<account>/.ssh/authorized_keys
#   ProtectControlGroups — resource-limits.ts writes cgroup files
#   PrivateDevices=yes   — terminal needs /dev/ptmx
#   MemoryDenyWriteExecute=yes — Node V8 JIT needs RWX pages
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

# Sandbox hardening — these don't change what the service can do under root,
# they just narrow the blast radius if the Node process is ever compromised.
NoNewPrivileges=yes
PrivateTmp=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now hostpanel

# Apache reverse proxy
# mod_proxy and mod_proxy_wstunnel (both included in httpd on RHEL/Rocky) are required.
# mod_proxy_wstunnel handles the WebSocket upgrade for the built-in terminal.
cat >/etc/httpd/conf.d/hostpanel-panel.conf <<VHOST
# HostPanel reverse proxy — generated by install.sh
# The Node process binds to 127.0.0.1:3001 only; port 3001 is NOT opened in the firewall.
<VirtualHost *:80>
  ServerName ${PANEL_HOST}

  # WebSocket upgrade for the built-in xterm.js terminal. The server attaches
  # the WebSocketServer at /api/terminal (see server/src/terminal.ts) — the
  # general ProxyPass below would forward it as plain HTTP and the Upgrade
  # header would never reach Node, so we need an explicit ws:// rule first.
  ProxyPass        /api/terminal  ws://127.0.0.1:3001/api/terminal
  ProxyPassReverse /api/terminal  ws://127.0.0.1:3001/api/terminal

  # Roundcube webmail — keep this path on Apache, do not proxy to Node
  ProxyPass        /roundcube !

  # All other traffic forwarded to Node
  ProxyPreserveHost On
  ProxyPass        / http://127.0.0.1:3001/
  ProxyPassReverse / http://127.0.0.1:3001/
</VirtualHost>
VHOST

# Roundcube webmail — alias /roundcube to the installed package
if rpm -q roundcubemail &>/dev/null; then
  cat >/etc/httpd/conf.d/roundcubemail.conf <<'RCUBE'
Alias /roundcube /usr/share/roundcubemail

<Directory /usr/share/roundcubemail>
    Options -Indexes
    AllowOverride All
    Require all granted
</Directory>
RCUBE

  # The roundcubemail RPM ships /etc/roundcubemail with only .sample / .dist
  # files — without a real config.inc.php the webmail page shows the
  # "CONFIGURATION ERROR: config.inc.php was not found" message. Bootstrap
  # the minimal viable config (random DB password + DES key, local Dovecot
  # / Postfix) only when the file doesn't already exist so re-running the
  # installer doesn't rotate working credentials.
  if [[ ! -f /etc/roundcubemail/config.inc.php ]]; then
    RC_DB=roundcubemail
    RC_USER=roundcube
    RC_PASS=$(openssl rand -base64 24 | tr -d '=+/' | head -c 24)
    DES_KEY=$(openssl rand -base64 24 | tr -d '=+/' | head -c 24)
    # mysql_secure_installation in step 3 may have set a root password; pass
    # it through if we captured one, otherwise rely on socket auth.
    MYSQL_ROOT_ARGS=()
    [[ -n "${DB_ROOT_PASS}" ]] && MYSQL_ROOT_ARGS=(-p"${DB_ROOT_PASS}")

    mysql -u root "${MYSQL_ROOT_ARGS[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${RC_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${RC_USER}'@'localhost' IDENTIFIED BY '${RC_PASS}';
GRANT ALL PRIVILEGES ON \`${RC_DB}\`.* TO '${RC_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
    mysql -u "${RC_USER}" -p"${RC_PASS}" "${RC_DB}" </usr/share/roundcubemail/SQL/mysql.initial.sql

    cat >/etc/roundcubemail/config.inc.php <<PHP
<?php
\$config = [];
\$config['db_dsnw']      = 'mysql://${RC_USER}:${RC_PASS}@localhost/${RC_DB}';
\$config['imap_host']    = 'localhost:143';
\$config['smtp_host']    = 'localhost:587';
\$config['smtp_user']    = '%u';
\$config['smtp_pass']    = '%p';
\$config['des_key']      = '${DES_KEY}';
\$config['support_url']  = '';
\$config['product_name'] = 'HostPanel Webmail';
\$config['plugins']      = [];
\$config['language']     = 'en_US';
\$config['skin']         = 'elastic';
PHP
    chown root:apache /etc/roundcubemail/config.inc.php
    chmod 640 /etc/roundcubemail/config.inc.php
    mkdir -p /var/lib/roundcubemail /var/log/roundcubemail
    chown apache:apache /var/lib/roundcubemail /var/log/roundcubemail
    # Block the installer dir from being web-reachable now that setup is done.
    echo "Require all denied" >/usr/share/roundcubemail/installer/.htaccess
  fi

  # Roundcube needs PHP — make sure PHP-FPM is running so Apache can fcgi to it.
  systemctl enable --now php-fpm
  echo "  Roundcube webmail configured at /roundcube"
fi

# Apache global hardening — hide the version banner, refuse mime-sniffing
# downstream, prevent framing of the panel, drop referer to off-site links,
# and set HSTS (effective once TLS is in front of the box). Filename is
# prefixed `zz-` so it loads after distribution defaults.
cat >/etc/httpd/conf.d/zz-hostpanel-headers.conf <<'HEADERS'
ServerTokens Prod
ServerSignature Off
TraceEnable Off

Header always set X-Content-Type-Options "nosniff"
Header always set X-Frame-Options "DENY"
Header always set Referrer-Policy "no-referrer"
Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
HEADERS

# Allow Apache to proxy to local network ports (blocked by SELinux on RHEL/AlmaLinux by default)
setsebool -P httpd_can_network_connect 1

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
    # SMTP_FROM no longer lives in .env (it's in the settings table now), so
    # fall straight back to admin@<host> as the certbot contact email.
    ADMIN_EMAIL="admin@${PANEL_HOST}"
    if certbot --apache -d "${PANEL_HOST}" --non-interactive --agree-tos -m "${ADMIN_EMAIL}"; then
      sed -i "s|^CLIENT_URL=http://|CLIENT_URL=https://|" "${PANEL_DIR}/server/.env"
      PANEL_PROTO="https"

      # Force HTTP → HTTPS at the :80 vhost so the HSTS header we set above
      # actually takes effect on the first hit. certbot drops a :443 vhost
      # alongside ours; we keep the proxy rules there and let :80 just
      # redirect. Skip the Roundcube alias on :80 so plain-text webmail
      # login pages also get redirected, not silently served over HTTP.
      cat >/etc/httpd/conf.d/hostpanel-panel.conf <<VHOST
# HostPanel reverse proxy — generated by install.sh (HTTPS active)
<VirtualHost *:80>
  ServerName ${PANEL_HOST}
  RewriteEngine On
  RewriteRule ^/(.*)\$ https://${PANEL_HOST}/\$1 [R=301,L]
</VirtualHost>
<VirtualHost *:443>
  ServerName ${PANEL_HOST}
  SSLEngine on
  SSLCertificateFile    /etc/letsencrypt/live/${PANEL_HOST}/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/${PANEL_HOST}/privkey.pem

  ProxyPass        /api/terminal  ws://127.0.0.1:3001/api/terminal
  ProxyPassReverse /api/terminal  ws://127.0.0.1:3001/api/terminal

  ProxyPass        /roundcube !

  ProxyPreserveHost On
  ProxyPass        / http://127.0.0.1:3001/
  ProxyPassReverse / http://127.0.0.1:3001/
</VirtualHost>
VHOST
      systemctl reload httpd
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
  # FTP passive data range — matches pasv_min/max_port in /etc/vsftpd/vsftpd.conf
  firewall-cmd --permanent --add-port=10090-10100/tcp
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
echo "  ── Next steps (configure from the panel UI) ─────"
echo ""
echo "  All application config lives in the SQLite settings table and is"
echo "  editable from the panel itself — no .env editing required."
echo ""
echo "    SMTP (outbound mail)        → ${PANEL_URL_FINAL}/settings"
echo "    Stripe payments             → ${PANEL_URL_FINAL}/settings"
echo "    PayPal payments             → ${PANEL_URL_FINAL}/settings"
echo "    Cloudflare zones / tokens   → ${PANEL_URL_FINAL}/cloudflare"
echo "    Company info / branding     → ${PANEL_URL_FINAL}/settings"
echo ""
echo "  Stripe webhook endpoint to register at https://dashboard.stripe.com/webhooks:"
echo "    ${PANEL_URL_FINAL}/api/stripe/webhook"
echo ""
echo "  Bootstrap values that DO live in ${PANEL_DIR}/server/.env (rarely changed):"
echo "    JWT_SECRET, ADMIN_USER, ADMIN_PASS_HASH, CLIENT_URL, DB_HOST/PORT/USER/PASS"
echo "  After editing those, restart the panel: systemctl restart hostpanel"
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
