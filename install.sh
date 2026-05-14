#!/usr/bin/env bash
# HostPanel installer for RHEL / Rocky Linux / AlmaLinux
set -euo pipefail

PANEL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="20"

echo "=============================="
echo "  HostPanel Installer"
echo "=============================="

# --- Root check ---
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run as root (sudo ./install.sh)" >&2
  exit 1
fi

# --- Install Node.js via NodeSource ---
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt $NODE_VERSION ]]; then
  echo "[1/6] Installing Node.js $NODE_VERSION..."
  curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
  dnf install -y nodejs
fi
echo "[1/6] Node.js $(node -v) ready."

# --- Install required packages ---
echo "[2/6] Installing system packages..."
dnf install -y epel-release 2>/dev/null || true
dnf install -y httpd mod_ssl mariadb-server postfix dovecot bind bind-utils \
               vsftpd certbot python3-certbot-apache curl tar gzip openssl

systemctl enable --now httpd mariadb postfix named vsftpd

# --- MariaDB root password (if not set) ---
echo "[3/6] Configuring MariaDB..."
if mysql -u root -e "SELECT 1" &>/dev/null; then
  echo "MariaDB root already accessible."
else
  echo "Please set MariaDB root password now:"
  mysql_secure_installation
fi

# --- Setup virtual mail directories ---
echo "[4/6] Configuring mail directories..."
mkdir -p /etc/postfix/virtual /etc/dovecot /var/mail/vhosts
touch /etc/postfix/virtual/mailbox /etc/postfix/virtual/aliases
touch /etc/dovecot/users
chmod 640 /etc/dovecot/users

# --- Setup vsftpd ---
echo "[5/6] Configuring FTP..."
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

# --- Install HostPanel dependencies ---
echo "[6/6] Installing HostPanel..."
cd "$PANEL_DIR"
npm install --workspace=server
npm install --workspace=client

# --- Copy env if not present ---
if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i "s|change-this-to-a-long-random-string-in-production|${JWT_SECRET}|" server/.env

  read -rsp "Set HostPanel admin password: " ADMIN_PASS; echo
  HASH=$(node -e "console.log(require('bcryptjs').hashSync('${ADMIN_PASS}', 12))")
  sed -i "s|\\\$2b\\\$12\\\$examplehashhere|${HASH//\//\\/}|" server/.env
fi

# --- Build client ---
cd "$PANEL_DIR"
npm run build --workspace=client

# --- Systemd service ---
cat >/etc/systemd/system/hostpanel.service <<SERVICE
[Unit]
Description=HostPanel Control Panel
After=network.target

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

# --- Firewall ---
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  firewall-cmd --permanent --add-port=3001/tcp
  firewall-cmd --permanent --add-service=ftp
  firewall-cmd --reload
fi

SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=============================="
echo "  HostPanel installed!"
echo "  http://${SERVER_IP}:3001"
echo "=============================="
