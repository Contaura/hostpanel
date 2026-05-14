# Client Portal

The Client Portal is a standalone, public-facing interface that lets your hosting clients log in, view their invoices, and pay online — without any access to the admin panel.

---

## Enabling Portal Access for a Client

1. Go to **Billing → Clients** and find the client.
2. Click the **Set Portal Password** button in their row.
3. Enter a password (minimum 8 characters) and save.

The client can now log in at `http://<server-ip>:3001/portal`.

Alternatively, send the client their credentials and the portal URL. The portal is completely independent of the admin login.

---

## Client Portal URL

```
http://<server-ip>:3001/portal
```

Or with a reverse proxy:

```
https://panel.yourdomain.com/portal
```

You can also link clients directly to the portal from a custom domain by pointing a subdomain (e.g. `client.yourdomain.com`) to the same server and configuring a separate Apache/Nginx vhost.

---

## What Clients Can Do

| Action | Available |
|---|---|
| View all their invoices | ✅ |
| Download invoice PDFs | ✅ |
| Pay via Stripe | ✅ (if configured) |
| Pay via PayPal | ✅ (if configured) |
| See total amount due across all invoices | ✅ |
| View account details | — (planned) |
| Open support tickets | — (planned) |

---

## Portal Authentication

The portal uses a separate JWT (`role: "client"`) that is valid for 7 days. The admin JWT is not accepted on portal routes.

Client passwords are bcrypt-hashed (cost factor 12) and stored in the `clients` table (`password_hash` column). They are completely separate from admin user passwords.

---

## Portal API Endpoints

These are public (no admin auth required):

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/portal/login` | Client login, returns JWT |
| `GET` | `/api/portal/me` | Authenticated client's profile |
| `GET` | `/api/portal/invoices` | Authenticated client's invoices |
| `GET` | `/api/portal/invoices/:id` | Single invoice with payment history |

Invoice PDF download uses the admin route (`/api/billing/invoices/:id/pdf`) which accepts client JWTs for their own invoices.

---

## Customising the Portal

The portal is a React page at `client/src/pages/ClientPortal.tsx`. You can edit it to add your company logo, change colours, or add extra sections. Run `npm run build --workspace=client` and restart the service to deploy changes.
