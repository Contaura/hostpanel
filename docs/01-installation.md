# Installation Guide

Supported distributions: **RHEL 8/9 · Rocky Linux 8/9 · AlmaLinux 8/9**

---

## Prerequisites

| Requirement | Minimum |
|---|---|
| CPU | 2 vCPU |
| RAM | 2 GB |
| Disk | 20 GB |
| OS | RHEL/Rocky/AlmaLinux 8 or 9 |
| Access | Root or passwordless sudo |
| Network | Public IP, ports 80/443/3001 open |

---

## Option A — Automated Installer

```bash
git clone https://github.com/Contaura/hostpanel.git /opt/hostpanel
cd /opt/hostpanel
sudo bash install.sh
```

The script handles everything end-to-end. When it finishes, the panel is available at `http://<server-ip>:3001`.

---

## Option B — Manual Installation

### 1. Install Node.js 20

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
node -v   # should print v20.x.x
```

### 2. Install system packages

```bash
sudo dnf install -y epel-release
sudo dnf install -y \
  httpd mod_ssl \
  mariadb-server \
  postfix dovecot \
  bind bind-utils \
  vsftpd \
  certbot python3-certbot-apache \
  fail2ban \
  mod_security mod_security_crs \
  redis memcached \
  curl tar gzip openssl git
```

Enable and start core services:

```bash
sudo systemctl enable --now httpd mariadb postfix named vsftpd
```

### 3. Clone the repository

```bash
sudo git clone https://github.com/Contaura/hostpanel.git /opt/hostpanel
cd /opt/hostpanel
```

### 4. Install Node dependencies

```bash
npm install
npm install --workspace=server
npm install --workspace=client
```

### 5. Configure the environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at minimum:

```dotenv
JWT_SECRET=<random 64-char hex — see below>
ADMIN_USER=admin
ADMIN_PASS_HASH=<bcrypt hash — see below>
DB_ROOT_PASS=<your MariaDB root password>
```

Generate a JWT secret:

```bash
openssl rand -hex 64
```

Generate an admin password hash:

```bash
node -e "console.log(require('bcryptjs').hashSync('YourPassword', 12))"
```

See [Configuration Reference](02-configuration.md) for all available keys.

### 6. Configure MariaDB

```bash
sudo mysql_secure_installation
```

HostPanel uses SQLite for its own data (no MariaDB setup needed for the panel itself). MariaDB is used only when you create hosting-account databases through the panel.

### 7. Build the frontend

```bash
npm run build --workspace=client
```

The built assets land in `client/dist/` and are served automatically by Express in production mode.

### 8. Create the systemd service

```bash
sudo tee /etc/systemd/system/hostpanel.service > /dev/null <<EOF
[Unit]
Description=HostPanel Control Panel
After=network.target mariadb.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/hostpanel/server
ExecStart=/usr/bin/node /opt/hostpanel/server/dist/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now hostpanel
sudo systemctl status hostpanel
```

### 9. Open firewall ports

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --permanent --add-service=ftp
sudo firewall-cmd --permanent --add-service=smtp
sudo firewall-cmd --permanent --add-service=pop3s
sudo firewall-cmd --permanent --add-service=imaps
sudo firewall-cmd --reload
```

### 10. (Optional) Reverse-proxy behind Apache

To serve the panel on port 80/443 instead of 3001, create an Apache vhost:

```apacheconf
# /etc/httpd/conf.d/hostpanel.conf
<VirtualHost *:80>
    ServerName panel.yourdomain.com
    ProxyPreserveHost On
    ProxyPass /api/terminal ws://127.0.0.1:3001/api/terminal
    ProxyPassReverse /api/terminal ws://127.0.0.1:3001/api/terminal
    ProxyPass / http://127.0.0.1:3001/
    ProxyPassReverse / http://127.0.0.1:3001/
</VirtualHost>
```

```bash
sudo dnf install -y mod_proxy mod_proxy_http mod_proxy_wstunnel
sudo systemctl reload httpd
```

Then obtain SSL with Certbot:

```bash
sudo certbot --apache -d panel.yourdomain.com
```

---

## Verifying the Installation

```bash
sudo systemctl status hostpanel        # service running
sudo journalctl -u hostpanel -n 50     # last 50 log lines
curl -s http://localhost:3001/api/auth/status | python3 -m json.tool
```

Open `http://<server-ip>:3001` in a browser and log in with the admin credentials you set in `.env`.

---

## Uninstall

```bash
sudo systemctl disable --now hostpanel
sudo rm /etc/systemd/system/hostpanel.service
sudo systemctl daemon-reload
sudo rm -rf /opt/hostpanel
```
