# SSL Certificates

---

## Standard Per-Domain SSL (Let's Encrypt)

HostPanel uses Certbot with the Apache plugin for single-domain certificates.

From the **Web Extras → SSL Certificates** tab, click **Issue SSL** next to a domain. This runs:

```bash
certbot --apache -d example.com --non-interactive --agree-tos --email admin@example.com
```

The domain must already point at your server's IP before issuing.

Certificates auto-renew via the Certbot timer (`certbot-renew.timer`). Verify it is active:

```bash
sudo systemctl status certbot-renew.timer
```

---

## Wildcard SSL (DNS Challenge)

Wildcard certs (`*.example.com`) require a DNS challenge because the subdomain cannot be reached via HTTP. Go to **SSL Advanced → Wildcard SSL**.

### Requirements

Install the DNS plugin for your DNS provider:

```bash
# Cloudflare
sudo dnf install -y python3-certbot-dns-cloudflare

# Route 53
sudo dnf install -y python3-certbot-dns-route53

# DigitalOcean
sudo pip3 install certbot-dns-digitalocean

# Generic (manual)
# Leave dns_plugin blank — you will be given a TXT record to add manually
```

### Credentials File

Create a credentials file for your provider, e.g. for Cloudflare:

```ini
# /etc/letsencrypt/cloudflare.ini
dns_cloudflare_api_token = YOUR_API_TOKEN_HERE
```

```bash
sudo chmod 600 /etc/letsencrypt/cloudflare.ini
```

The CF token needs **Zone:Read** and **DNS:Edit** permissions.

### Issuing the Certificate

In the panel:

1. Enter the base domain (e.g. `example.com` — the panel automatically adds `*.example.com`).
2. Select the DNS plugin.
3. Enter the credentials file path.
4. Click **Request Wildcard Certificate**.

The panel shows the full Certbot output. A successful run ends with:

```
Congratulations! Your certificate and chain have been saved at:
/etc/letsencrypt/live/example.com/fullchain.pem
```

---

## SSL/TLS Cipher Configuration

Go to **SSL Advanced → Cipher Config** to set the TLS security level globally.

| Preset | Protocols | Compatibility |
|---|---|---|
| **Modern** | TLS 1.3 only | Latest browsers only |
| **Intermediate** *(recommended)* | TLS 1.2 + 1.3 | All modern browsers |
| **Legacy** | TLS 1.0 – 1.3 | Old clients (not recommended) |

Changing the preset writes `/etc/httpd/conf.d/ssl_ciphers.conf` and runs `apachectl graceful` — no downtime.

The **Intermediate** preset also enables **HSTS** (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).

---

## Per-Domain SSL Test

Go to **SSL Advanced → Test Certificate** and enter any domain. The panel connects via `openssl s_client`, parses the certificate, and shows:

- Subject and issuer
- Valid-from and expiry dates
- Days remaining (color-coded: green > 30d, amber > 7d, red ≤ 7d)

This works for any publicly reachable HTTPS domain, not just ones managed by the panel.

---

## Renewal Troubleshooting

```bash
# Test renewal dry-run
sudo certbot renew --dry-run

# Force renew a specific domain
sudo certbot certonly --force-renewal -d example.com

# Check logs
sudo journalctl -u certbot-renew
sudo cat /var/log/letsencrypt/letsencrypt.log | tail -50
```
