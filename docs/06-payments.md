# Payment Gateways

HostPanel supports **Stripe** and **PayPal** for invoice payments through the Client Portal.

---

## Stripe

### 1. Get your API keys

Log in to [dashboard.stripe.com](https://dashboard.stripe.com) and go to **Developers → API Keys**.

Copy:
- **Secret key** (`sk_live_...` or `sk_test_...` for testing)
- **Publishable key** (`pk_live_...` or `pk_test_...`)

### 2. Add keys to configuration

Either set them in `server/.env`:

```dotenv
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Or enter them in the panel under **Settings → Billing**.

### 3. Configure a Webhook

In the Stripe dashboard go to **Developers → Webhooks → Add endpoint**.

- Endpoint URL: `https://panel.yourdomain.com/api/stripe/webhook`
- Events to listen for: `checkout.session.completed`

Copy the **Signing secret** (`whsec_...`) and add it to `STRIPE_WEBHOOK_SECRET`.

The webhook marks the matching invoice as **paid** automatically when a payment completes.

### 4. How it works for clients

When a client opens an invoice in the **Client Portal** and clicks **Pay with Stripe**, the panel creates a Checkout Session and redirects them to Stripe's hosted payment page. On success, Stripe calls the webhook and the invoice status updates to `paid`.

---

## PayPal

### 1. Create an App

Log in to [developer.paypal.com](https://developer.paypal.com/dashboard/applications) and create a new app under your account. Copy the **Client ID** and **Secret**.

### 2. Add keys to configuration

Either in `server/.env`:

```dotenv
PAYPAL_CLIENT_ID=AXxx...
PAYPAL_SECRET=EGxx...
PAYPAL_MODE=sandbox   # change to "live" for production
```

Or enter them in the panel under **Settings → Billing**.

### 3. How it works for clients

When a client clicks **Pay with PayPal** in the portal, the panel:

1. Exchanges client credentials for an OAuth2 access token.
2. Creates a PayPal Order for the invoice amount.
3. Redirects the client to PayPal's approval page.
4. On return, the panel captures the order and marks the invoice paid.

### Sandbox Testing

Use PayPal sandbox buyer credentials from the Developer Dashboard to test end-to-end without real money. Set `PAYPAL_MODE=sandbox` during testing.

---

## Testing Without Real Payments

### Stripe test cards

| Card number | Result |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | Declined |
| `4000 0025 0000 3155` | 3D Secure required |

Use any future expiry date, any 3-digit CVC, and any ZIP code.

### PayPal sandbox

Create sandbox buyer and seller accounts at [developer.paypal.com/tools/sandbox/accounts](https://developer.paypal.com/tools/sandbox/accounts/). Use the buyer account credentials on the PayPal approval page when testing.

---

## Manual Payments

For offline payments (bank transfer, cash, etc.), admins can record a payment manually:

1. Go to **Billing → Invoices** and open the invoice.
2. Click **Record Payment**.
3. Enter the amount, method, and optional reference number.

Once the sum of payments equals the invoice total, the status automatically flips to **paid**.
