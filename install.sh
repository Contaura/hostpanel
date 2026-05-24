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
# CRB (CodeReady Builder) carries libmemcached-awesome and sendmail-milter
# which are runtime deps for opendkim/opendkim-tools.
dnf config-manager --set-enabled crb 2>/dev/null || true
# php-cli + php-mysqlnd + php-curl are needed for the Script Installer's
# WordPress/Joomla/Drupal flows: roundcubemail pulls in php-fpm + a few
# extensions, but not the CLI binary or the MySQL driver, so WordPress
# would extract fine and then explode on first hit. Install them up front.
dnf install -y httpd mod_ssl mariadb-server postfix dovecot dovecot-pigeonhole \
               bind bind-utils vsftpd certbot python3-certbot-apache \
               curl tar gzip zip unzip openssl make gcc-c++ python3 roundcubemail \
               php-cli php-mysqlnd php-curl php-gd \
               opendkim opendkim-tools

# wp-cli — required by every endpoint in /api/wordpress/*. It's not in the
# RHEL repos so pull the official phar release. Pinned to LATEST stable to
# match what the WP team currently signs.
if [[ ! -x /usr/local/bin/wp ]]; then
  curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
  chmod +x /usr/local/bin/wp
fi

# pm2 — used by /api/apps/* and /api/node-apps/* to run user Node and Python
# apps under a process manager. Install globally via npm so it lands on
# /usr/local/bin/pm2 and systemd's default PATH picks it up.
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 2>&1 | tail -3
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
DB_ROOT_ARGS=()
if mysql -u root -e "SELECT 1" &>/dev/null; then
  echo "  MariaDB root is accessible without a password."
  echo "  It is strongly recommended to run mysql_secure_installation manually."
else
  echo "  Running mysql_secure_installation — set a strong root password when prompted."
  mysql_secure_installation
  echo ""
  read -rsp "  Re-enter the MariaDB root password you just set (it will be saved to server/.env): " DB_ROOT_PASS; echo
  DB_ROOT_ARGS=(-p"${DB_ROOT_PASS}")
fi

# Dedicated DB user for the panel. The Node process talks to MariaDB over
# TCP (127.0.0.1), but skip-name-resolve makes MariaDB treat that as the
# literal address "127.0.0.1" — which doesn't match a root@localhost
# socket user. Give the panel its own user@127.0.0.1 with full privileges
# (the Database Manager creates/drops databases and users on demand, so it
# needs WITH GRANT OPTION). Captured into the .env later in step 6.
DB_PANEL_USER=hostpanel
DB_PANEL_PASS=$(openssl rand -base64 24 | tr -d '=+/' | head -c 24)
mysql -u root "${DB_ROOT_ARGS[@]}" <<SQL
CREATE USER IF NOT EXISTS '${DB_PANEL_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PANEL_PASS}';
GRANT ALL PRIVILEGES ON *.* TO '${DB_PANEL_USER}'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL

# ── 4/9  Mail directories ────────────────────────────────────────────────────
echo "[4/9] Configuring mail directories..."
mkdir -p /etc/dovecot /var/mail/vhosts

# Two separate concerns here:
#   - The base postfix map files /etc/postfix/{virtual,vmailbox,transport}
#     are flat-file maps. Postfix itself reads these. Touch them so initial
#     `postmap` succeeds.
#   - The panel writes its own per-account mailbox/alias entries under a
#     dedicated *directory* set as VMAIL_DIR — server/src/routes/email.ts
#     opens `${VMAIL_DIR}/mailbox` and `${VMAIL_DIR}/aliases` as flat-file
#     maps. Using /etc/postfix/virtual directly would collide with the
#     base map file above (and previously failed with ENOTDIR because the
#     code tried to open a file-inside-a-file).
touch /etc/postfix/virtual /etc/postfix/vmailbox /etc/postfix/transport
postmap /etc/postfix/virtual /etc/postfix/vmailbox /etc/postfix/transport 2>/dev/null || true

# Postfix lookup maps the panel writes per-account entries into. These stay
# under /etc/postfix because that's where Postfix reads config from; they hold
# `<email>    <domain>/<user>/` (mailbox), forwarder pairs (aliases), and the
# accepted-domains list (domains).
mkdir -p /etc/postfix/vmail
touch /etc/postfix/vmail/mailbox /etc/postfix/vmail/aliases /etc/postfix/vmail/domains
postmap /etc/postfix/vmail/mailbox /etc/postfix/vmail/aliases /etc/postfix/vmail/domains 2>/dev/null || true
chmod 640 /etc/postfix/vmail/mailbox /etc/postfix/vmail/aliases /etc/postfix/vmail/domains
chown root:postfix /etc/postfix/vmail/mailbox /etc/postfix/vmail/aliases /etc/postfix/vmail/domains 2>/dev/null || true

# Virtual mail user that owns every Maildir under /var/mail/vhosts.
# UID/GID 5000 must match the value the panel writes into /etc/dovecot/users
# (server/src/routes/email.ts hard-codes 5000:5000 in the passwd-file entry).
#
# Storage must live OUTSIDE /etc: Dovecot's SELinux domain (dovecot_t) cannot
# traverse /etc/postfix (postfix_etc_t), and the upstream dovecot.service sets
# ProtectSystem=full which makes /etc read-only for the daemon. /var/mail/vhosts
# is the FHS-correct path and inherits the mail_spool_t label automatically.
getent group  vmail >/dev/null || groupadd -g 5000 vmail
getent passwd vmail >/dev/null || useradd -u 5000 -g 5000 -d /var/mail/vhosts -s /sbin/nologin -M vmail
mkdir -p /var/mail/vhosts
chown -R vmail:vmail /var/mail/vhosts
restorecon -R /var/mail/vhosts 2>/dev/null || true

# /etc/dovecot/users is the Dovecot passwd-file passdb. Dovecot's auth worker
# runs as the `dovecot` user, so root-only perms here silently break IMAP login
# with "open(/etc/dovecot/users) failed: Permission denied".
touch /etc/dovecot/users
chown root:dovecot /etc/dovecot/users
chmod 640 /etc/dovecot/users

# Switch Dovecot from default PAM/system auth to the passwd-file the panel
# manages, and tell it where the virtual maildirs live (the home from the
# passwd-file entry, i.e. /var/mail/vhosts/<domain>/<user>).
if ! grep -qE '^!include auth-passwdfile\.conf\.ext' /etc/dovecot/conf.d/10-auth.conf; then
  sed -i 's|^!include auth-system\.conf\.ext|#!include auth-system.conf.ext|'       /etc/dovecot/conf.d/10-auth.conf
  sed -i 's|^#!include auth-passwdfile\.conf\.ext|!include auth-passwdfile.conf.ext|' /etc/dovecot/conf.d/10-auth.conf
fi
if ! grep -qE '^mail_location\s*=\s*maildir:~/Maildir' /etc/dovecot/conf.d/10-mail.conf; then
  sed -i 's|^#mail_location =\s*$|mail_location = maildir:~/Maildir|' /etc/dovecot/conf.d/10-mail.conf
fi

# Expose Dovecot's LMTP socket inside Postfix's chroot so virtual delivery
# can reach it via virtual_transport = lmtp:unix:private/dovecot-lmtp. The
# upstream master.conf only creates the socket at /var/run/dovecot/lmtp,
# which lives outside the Postfix chroot.
if ! grep -q "/var/spool/postfix/private/dovecot-lmtp" /etc/dovecot/conf.d/10-master.conf; then
  python3 - <<'PY'
import re, pathlib
p = pathlib.Path('/etc/dovecot/conf.d/10-master.conf')
src = p.read_text()
# Append a second unix_listener inside the existing `service lmtp {}` block.
new = re.sub(
    r'(service lmtp \{[^}]*?unix_listener lmtp \{[^}]*?\}\n)',
    r'''\1
  # HostPanel: drop a second LMTP socket inside the Postfix chroot so the
  # Postfix lmtp(8) client can hand virtual mail off to Dovecot.
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode  = 0600
    user  = postfix
    group = postfix
  }
''',
    src,
    count=1,
    flags=re.DOTALL,
)
p.write_text(new)
PY
fi

# Expose a Dovecot SASL auth socket inside the Postfix chroot so the Postfix
# submission service (587) can validate MAIL FROM credentials against the
# same passwd-file IMAP uses. The upstream config has this listener stubbed
# out under `service auth`; uncomment it with the right perms.
if ! grep -q "^  unix_listener /var/spool/postfix/private/auth" /etc/dovecot/conf.d/10-master.conf; then
  python3 - <<'PY'
import pathlib
p = pathlib.Path('/etc/dovecot/conf.d/10-master.conf')
src = p.read_text()
old = (
    "  # Postfix smtp-auth\n"
    "  #unix_listener /var/spool/postfix/private/auth {\n"
    "  #  mode = 0666\n"
    "  #}\n"
)
new = (
    "  # Postfix smtp-auth — HostPanel: lets Postfix submission (587) validate\n"
    "  # MAIL FROM credentials against the same passwd-file IMAP uses.\n"
    "  unix_listener /var/spool/postfix/private/auth {\n"
    "    mode  = 0660\n"
    "    user  = postfix\n"
    "    group = postfix\n"
    "  }\n"
)
if old in src:
    p.write_text(src.replace(old, new))
PY
fi

# Postfix: route virtual recipients via Dovecot LMTP and accept the maps.
# smtpd_sasl_* wires the submission service below to Dovecot for AUTH.
postconf -e \
  "virtual_mailbox_domains = hash:/etc/postfix/vmail/domains" \
  "virtual_mailbox_maps    = hash:/etc/postfix/vmail/mailbox" \
  "virtual_alias_maps      = hash:/etc/postfix/vmail/aliases" \
  "virtual_transport       = lmtp:unix:private/dovecot-lmtp" \
  "virtual_mailbox_base    = /var/mail/vhosts" \
  "virtual_minimum_uid     = 100" \
  "virtual_uid_maps        = static:5000" \
  "virtual_gid_maps        = static:5000" \
  "inet_interfaces         = all" \
  "smtpd_sasl_type         = dovecot" \
  "smtpd_sasl_path         = private/auth" \
  "smtpd_sasl_local_domain =" \
  "smtpd_tls_auth_only     = yes"

# Uncomment the submission (587) service in master.cf with SASL + STARTTLS
# requirements. Done with sed -E so re-runs are idempotent (no-op if already
# uncommented). mua_* restriction macros are upstream's defaults and aren't
# set in main.cf, so we replace them with explicit policies.
if grep -qE '^#submission inet' /etc/postfix/master.cf; then
  python3 - <<'PY'
import pathlib
p = pathlib.Path('/etc/postfix/master.cf')
src = p.read_text()
old = (
    "#submission inet n       -       n       -       -       smtpd\n"
    "#  -o syslog_name=postfix/submission\n"
    "#  -o smtpd_tls_security_level=encrypt\n"
    "#  -o smtpd_sasl_auth_enable=yes\n"
    "#  -o smtpd_tls_auth_only=yes\n"
    "#  -o smtpd_reject_unlisted_recipient=no\n"
    "#  -o smtpd_client_restrictions=$mua_client_restrictions\n"
    "#  -o smtpd_helo_restrictions=$mua_helo_restrictions\n"
    "#  -o smtpd_sender_restrictions=$mua_sender_restrictions\n"
    "#  -o smtpd_recipient_restrictions=\n"
    "#  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject\n"
    "#  -o milter_macro_daemon_name=ORIGINATING\n"
)
new = (
    "submission inet n       -       n       -       -       smtpd\n"
    "  -o syslog_name=postfix/submission\n"
    "  -o smtpd_tls_security_level=encrypt\n"
    "  -o smtpd_sasl_auth_enable=yes\n"
    "  -o smtpd_tls_auth_only=yes\n"
    "  -o smtpd_reject_unlisted_recipient=no\n"
    "  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject\n"
    "  -o smtpd_relay_restrictions=permit_sasl_authenticated,reject\n"
    "  -o milter_macro_daemon_name=ORIGINATING\n"
)
if old in src:
    p.write_text(src.replace(old, new))
PY
fi

# OpenDKIM — wire as a Postfix milter so outbound mail is signed and inbound
# mail is verified. The RPM ships in single-KeyFile mode pointing at a file
# that doesn't exist (so the service won't start) and uses a unix socket
# under /run that Postfix can't reach from its chroot. Switch to KeyTable
# /SigningTable mode on an inet socket on loopback. Per-domain keys are
# generated + registered by the panel API (/api/dkim/:domain/generate-dkim).
python3 - <<'PY'
from pathlib import Path
import re

p = Path('/etc/opendkim.conf')
src = p.read_text()

def upsert(text, key, value):
    # opendkim.conf ships duplicate keys for some options (e.g. two Socket
    # lines). Strip every occurrence (active or commented) and append a
    # single canonical line at the end so the file converges no matter how
    # many times this runs.
    pat = re.compile(rf'^\s*#?\s*{key}\b.*\n?', re.M)
    text = pat.sub('', text)
    return text.rstrip() + '\n' + f'{key}\t{value}' + '\n'

# Static KeyFile would shadow the per-domain KeyTable — comment it out.
src = re.sub(r'^\s*KeyFile\b', '#KeyFile', src, flags=re.M)
src = upsert(src, 'Socket',             'inet:8891@localhost')
src = upsert(src, 'KeyTable',           'refile:/etc/opendkim/KeyTable')
src = upsert(src, 'SigningTable',       'refile:/etc/opendkim/SigningTable')
src = upsert(src, 'ExternalIgnoreList', 'refile:/etc/opendkim/TrustedHosts')
src = upsert(src, 'InternalHosts',      'refile:/etc/opendkim/TrustedHosts')
src = upsert(src, 'Mode',               'sv')
src = upsert(src, 'PidFile',            '/run/opendkim/opendkim.pid')

p.write_text(src)
PY

# Tables + trusted-hosts file. Touch so opendkim has something to read even
# before the first domain is signed; ownership matters because keys live
# alongside.
touch /etc/opendkim/KeyTable /etc/opendkim/SigningTable /etc/opendkim/TrustedHosts
grep -qx '127.0.0.1' /etc/opendkim/TrustedHosts || echo '127.0.0.1' >> /etc/opendkim/TrustedHosts
grep -qx '::1'        /etc/opendkim/TrustedHosts || echo '::1'        >> /etc/opendkim/TrustedHosts
chown -R opendkim:opendkim /etc/opendkim
chmod 640 /etc/opendkim/KeyTable /etc/opendkim/SigningTable /etc/opendkim/TrustedHosts
[ -d /etc/opendkim/keys ] && chmod 750 /etc/opendkim/keys

# Rspamd — content/spam filter, attached to Postfix as a second milter after
# OpenDKIM. Not in EPEL on EL9, so pull from the upstream stable repo.
if ! rpm -q rspamd >/dev/null 2>&1; then
  if [ ! -f /etc/yum.repos.d/rspamd.repo ]; then
    curl -fsSL https://rspamd.com/rpm-stable/centos-9/rspamd.repo \
      -o /etc/yum.repos.d/rspamd.repo
  fi
  dnf -y install rspamd redis >/dev/null 2>&1 || true
fi

# Always inject scan-result headers so admins and recipients can see why
# a message did or didn't get flagged. Rspamd defaults strip these for
# authenticated and local-network senders; opt back in explicitly.
mkdir -p /etc/rspamd/local.d
cat > /etc/rspamd/local.d/milter_headers.conf <<'RSPAMD_HDR'
use = ["authentication-results", "x-spamd-bar", "x-spam-status"];
authenticated_headers = ["authentication-results", "x-spamd-bar", "x-spam-status"];
local_headers         = ["authentication-results", "x-spamd-bar", "x-spam-status"];
extended_spam_headers = true;
RSPAMD_HDR

systemctl enable --now redis  >/dev/null 2>&1 || true
systemctl enable --now rspamd >/dev/null 2>&1 || true

# Wire Postfix to both milters. OpenDKIM signs first (port 8891), Rspamd
# scans second (port 11332). milter_default_action=accept means a transient
# milter outage delivers unsigned/unscanned rather than bouncing.
MILTERS="inet:127.0.0.1:8891"
if command -v rspamd >/dev/null 2>&1; then
  MILTERS="${MILTERS} inet:127.0.0.1:11332"
fi
postconf -e \
  "smtpd_milters         = ${MILTERS}" \
  "non_smtpd_milters     = ${MILTERS}" \
  "milter_default_action = accept" \
  "milter_protocol       = 6"

systemctl enable opendkim >/dev/null 2>&1 || true
systemctl restart opendkim || true

# Sieve — Dovecot pre-script that auto-files rspamd-flagged spam into Junk.
# Anything with score >= reject_threshold (15) is already 554'd at SMTP-time
# by rspamd; this catches the "add header" / "rewrite subject" band so it
# stays out of INBOX. sieve_before runs before any per-user .dovecot.sieve.
mkdir -p /etc/dovecot/sieve-before.d
cat > /etc/dovecot/sieve-before.d/10-spam-to-junk.sieve <<'SIEVE'
require ["fileinto", "mailbox"];

if anyof (
  header :is        "X-Spam"        "Yes",
  header :is        "X-Spam-Flag"   "YES",
  header :contains  "X-Spam-Status" "Yes,"
) {
  fileinto :create "Junk";
  stop;
}
SIEVE
sievec /etc/dovecot/sieve-before.d/10-spam-to-junk.sieve 2>/dev/null || true

# Enable sieve plugin on LMTP and point sieve_before at the global dir.
python3 - <<'PY'
from pathlib import Path
import re

# 1. protocol lmtp { mail_plugins = $mail_plugins sieve }
lmtp = Path('/etc/dovecot/conf.d/20-lmtp.conf')
src = lmtp.read_text()
def patch_lmtp(text):
    pat = re.compile(r'(protocol\s+lmtp\s*\{)(.*?)(\n\})', re.S)
    def repl(m):
        head, body, tail = m.group(1), m.group(2), m.group(3)
        body = re.sub(r'^\s*#?\s*mail_plugins\s*=.*\n', '', body, flags=re.M)
        if not body.endswith('\n'): body += '\n'
        body += '  mail_plugins = $mail_plugins sieve\n'
        return head + body + tail
    return pat.sub(repl, text, count=1)
new = patch_lmtp(src)
if new != src: lmtp.write_text(new)

# 2. plugin { sieve_before = /etc/dovecot/sieve-before.d }
sf = Path('/etc/dovecot/conf.d/90-sieve.conf')
src = sf.read_text()
src = re.sub(r'^\s*#?\s*sieve_before\d*\s*=.*\n', '', src, flags=re.M)
pat = re.compile(r'(plugin\s*\{)(.*?)(\n\})', re.S)
def repl(m):
    head, body, tail = m.group(1), m.group(2), m.group(3)
    return head + body + '\n  sieve_before = /etc/dovecot/sieve-before.d\n' + tail.lstrip('\n')
new = pat.sub(repl, src, count=1)
if new != src: sf.write_text(new)
PY

systemctl restart dovecot
systemctl restart postfix

# Open SMTP + submission. firewalld on RHEL 9 doesn't ship a 'submission'
# service alias, so reference the port directly.
firewall-cmd --permanent --add-service=smtp     >/dev/null 2>&1 || true
firewall-cmd --permanent --add-port=587/tcp     >/dev/null 2>&1 || true
firewall-cmd --reload                            >/dev/null 2>&1 || true

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

  # MariaDB connection — point the panel at the dedicated hostpanel user we
  # created in step 3 instead of root. The env var names stay DB_ROOT_USER /
  # DB_ROOT_PASS for backward compatibility, but the actual user is now a
  # non-root account with global privileges (it has to be — the Database
  # Manager creates per-account DBs and users on demand).
  sed -i "s|^DB_ROOT_USER=.*|DB_ROOT_USER=${DB_PANEL_USER}|" server/.env
  if grep -q '^DB_ROOT_PASS=' server/.env; then
    sed -i "s|^DB_ROOT_PASS=.*|DB_ROOT_PASS=${DB_PANEL_PASS}|" server/.env
  else
    echo "DB_ROOT_PASS=${DB_PANEL_PASS}" >> server/.env
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
// tls:// forces STARTTLS; Postfix submission rejects unencrypted AUTH.
// allow_self_signed lets us use the default Postfix self-signed cert for
// the loopback hop (a real cert would need extra wiring outside install.sh).
\$config['smtp_host']    = 'tls://localhost:587';
\$config['smtp_user']    = '%u';
\$config['smtp_pass']    = '%p';
\$config['smtp_conn_options'] = [
    'ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true],
];
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
