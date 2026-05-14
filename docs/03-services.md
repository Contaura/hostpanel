# Service Setup

HostPanel integrates with the underlying Linux services. This page covers the minimum configuration each service needs to work correctly with the panel.

---

## Apache (httpd)

HostPanel creates vhost config files in `VHOST_DIR` (default `/etc/httpd/conf.d`).

```bash
sudo dnf install -y httpd mod_ssl
sudo systemctl enable --now httpd
```

Ensure `IncludeOptional conf.d/*.conf` is present in `/etc/httpd/conf/httpd.conf` (it is by default on RHEL).

SELinux — allow Apache to write config files and connect to local ports:

```bash
sudo setsebool -P httpd_can_network_connect 1
sudo setsebool -P httpd_unified 1
```

---

## MariaDB

```bash
sudo dnf install -y mariadb-server
sudo systemctl enable --now mariadb
sudo mysql_secure_installation
```

Set the root password during `mysql_secure_installation` and put it in `server/.env` as `DB_ROOT_PASS`. HostPanel uses this only to create/drop databases and users for hosting accounts.

---

## Postfix (Outbound & Virtual Mailboxes)

```bash
sudo dnf install -y postfix
sudo systemctl enable --now postfix
```

Add these lines to `/etc/postfix/main.cf` to enable virtual mailboxes:

```
virtual_mailbox_domains = /etc/postfix/virtual/domains
virtual_mailbox_base = /var/mail/vhosts
virtual_mailbox_maps = hash:/etc/postfix/virtual/mailbox
virtual_alias_maps = hash:/etc/postfix/virtual/aliases
virtual_minimum_uid = 100
virtual_uid_maps = static:5000
virtual_gid_maps = static:5000
```

Create the directory and initial map files:

```bash
sudo mkdir -p /etc/postfix/virtual /var/mail/vhosts
sudo touch /etc/postfix/virtual/mailbox /etc/postfix/virtual/aliases /etc/postfix/virtual/domains
sudo postmap /etc/postfix/virtual/mailbox
sudo postmap /etc/postfix/virtual/aliases
sudo systemctl reload postfix
```

---

## Dovecot (IMAP/POP3)

```bash
sudo dnf install -y dovecot
sudo systemctl enable --now dovecot
```

Minimal `/etc/dovecot/conf.d/10-auth.conf` changes:

```
auth_mechanisms = plain login
```

Point Dovecot at the passwd file HostPanel manages (`/etc/dovecot/users`):

```
# /etc/dovecot/conf.d/auth-passwdfile.conf.ext
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT /etc/dovecot/users
}
userdb {
  driver = passwd-file
  args = /etc/dovecot/users
}
```

```bash
sudo systemctl reload dovecot
```

---

## BIND (named) — DNS

```bash
sudo dnf install -y bind bind-utils
sudo systemctl enable --now named
```

Allow BIND to write zone files (needed for the DNS zone editor):

```bash
# /etc/named.conf — add inside options {}
allow-recursion { 127.0.0.1; };
directory "/var/named";

# Make sure named can write zone files
sudo chown named:named /var/named
sudo chmod 770 /var/named
```

SELinux:

```bash
sudo setsebool -P named_write_master_zones 1
```

---

## vsftpd (FTP)

```bash
sudo dnf install -y vsftpd
```

The installer writes a minimal `/etc/vsftpd/vsftpd.conf`. Key settings HostPanel depends on:

```
chroot_local_user=YES
allow_writeable_chroot=YES
user_config_dir=/etc/vsftpd/users
userlist_enable=YES
userlist_deny=NO
userlist_file=/etc/vsftpd/user_list
```

```bash
sudo systemctl enable --now vsftpd
```

---

## Fail2Ban

```bash
sudo dnf install -y fail2ban
sudo systemctl enable --now fail2ban
```

HostPanel reads jail status from `fail2ban-client`. The default jails (sshd, etc.) appear automatically. To add custom jails, drop `.conf` files in `/etc/fail2ban/jail.d/`.

---

## ModSecurity WAF

```bash
sudo dnf install -y mod_security mod_security_crs
sudo systemctl reload httpd
```

HostPanel detects ModSecurity via `httpd -M | grep security2` and reads/writes the engine mode in `/etc/httpd/conf.d/mod_security.conf` (or `ssl_ciphers.conf`). The panel sets `SecRuleEngine On|DetectionOnly|Off`.

---

## Redis

```bash
sudo dnf install -y redis
sudo systemctl enable --now redis
```

HostPanel connects to Redis on `127.0.0.1:6379` (default, no auth). To add a password, update `/etc/redis/redis.conf` and restart.

---

## Memcached

```bash
sudo dnf install -y memcached
sudo systemctl enable --now memcached
```

HostPanel connects on `127.0.0.1:11211`.

---

## Certbot (SSL)

```bash
sudo dnf install -y certbot python3-certbot-apache
```

For wildcard SSL (DNS challenge), install the DNS plugin for your provider, e.g.:

```bash
sudo dnf install -y python3-certbot-dns-cloudflare
```

Place credentials at `/etc/letsencrypt/cloudflare.ini`:

```ini
dns_cloudflare_api_token = YOUR_CF_TOKEN
```

```bash
sudo chmod 600 /etc/letsencrypt/cloudflare.ini
```

Then use **SSL Advanced → Wildcard SSL** in the panel UI.

---

## PM2 (App Manager)

```bash
sudo npm install -g pm2
pm2 startup systemd -u root --hp /root
sudo systemctl enable pm2-root
```

HostPanel calls `pm2 start|stop|restart|delete|jlist|logs` directly. Apps you deploy through the **App Manager** page are registered with PM2 and survive reboots.

---

## OpenDKIM (DKIM signing)

```bash
sudo dnf install -y opendkim opendkim-tools
sudo systemctl enable --now opendkim
```

HostPanel generates DKIM key pairs with `opendkim-genkey -b 2048 -d <domain> -D <dir>`. Keys land in `/etc/opendkim/keys/<domain>/`. You then add the public key as a DNS TXT record — the panel shows you exactly what to paste.

---

## nvm (Node version manager)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
```

HostPanel runs `nvm list` and `nvm install <version>` via bash subshell. It must be installed for the **Runtime Versions → Node.js** tab to work.

---

## pyenv (Python version manager)

```bash
sudo dnf install -y gcc zlib-devel bzip2 bzip2-devel readline-devel \
  sqlite sqlite-devel openssl-devel tk-devel libffi-devel
curl https://pyenv.run | bash
echo 'export PATH="$HOME/.pyenv/bin:$PATH"' >> ~/.bashrc
echo 'eval "$(pyenv init -)"' >> ~/.bashrc
source ~/.bashrc
```

HostPanel calls `pyenv versions` and `pyenv install <version>` for the **Runtime Versions → Python** tab.
