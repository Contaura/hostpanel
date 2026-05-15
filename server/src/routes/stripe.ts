import { Router, Request, Response } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe');
import db from '../db';

const router = Router();

function getSetting(key: string): string {
  return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as any)?.value || '';
}

// Lazy-initialize Stripe — env takes precedence, falls back to DB settings
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || getSetting('stripe_secret_key');
  if (!key) throw new Error('Stripe secret key is not configured. Set it in Settings → Stripe.');
  return new StripeLib(key, { apiVersion: '2024-06-20' });
}

// ── Config ─────────────────────────────────────────────────
router.get('/config', (_req: Request, res: Response) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || getSetting('stripe_publishable_key');
  if (!publishableKey) return res.json({ configured: false });
  res.json({ configured: true, publishableKey });
});

// ── Checkout session ───────────────────────────────────────
router.post('/checkout', async (req: Request, res: Response) => {
  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id is required' });

  const invoice: any = db.prepare(`
    SELECT i.*, c.email as client_email, c.name as client_name, a.domain as account_domain
    FROM invoices i
    LEFT JOIN clients  c ON i.client_id  = c.id
    LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.id = ?
  `).get(invoice_id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice is already paid' });

  try {
    const stripe = getStripe();
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: invoice.client_email ?? undefined,
      line_items: [
        {
          price_data: {
            currency: (invoice.currency ?? 'usd').toLowerCase(),
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
              description: invoice.notes || (invoice.account_domain ? `Hosting — ${invoice.account_domain}` : 'Hosting service'),
            },
            unit_amount: Math.round(invoice.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoice_id: String(invoice.id),
        invoice_number: invoice.invoice_number,
      },
      success_url: `${clientUrl}/billing?payment=success&invoice_id=${invoice.id}`,
      cancel_url:  `${clientUrl}/billing?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Webhook ────────────────────────────────────────────────
// Registered in index.ts with express.raw() BEFORE express.json()
router.post('/webhook', (req: Request, res: Response) => {
  const sig           = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || getSetting('stripe_webhook_secret');

  let event: any;

  try {
    const stripe = getStripe();
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Development: no signature verification
      event = JSON.parse((req.body as Buffer).toString());
    }
  } catch (err: any) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId: string | undefined = session.metadata?.invoice_id;

    if (invoiceId && session.payment_status === 'paid') {
      db.prepare("UPDATE invoices SET status='paid', paid_date=date('now') WHERE id=?").run(invoiceId);
      db.prepare(`
        INSERT OR IGNORE INTO payments (invoice_id, amount, method, reference, notes)
        VALUES (?, ?, 'stripe', ?, 'Stripe Checkout')
      `).run(invoiceId, (session.amount_total ?? 0) / 100, session.id);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    console.log('Stripe payment failed:', event.data.object.id);
  }

  res.json({ received: true });
});

export default router;
