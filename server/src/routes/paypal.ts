import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

function getPayPalConfig() {
  // Settings table is the source of truth — PAYPAL_* env vars are no longer
  // consulted at request time. Existing installs are migrated env → settings
  // on first boot of this build (see migrateEnvToSetting in db.ts).
  const setting = (key: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value || '';
  const clientId = setting('paypal_client_id');
  const secret   = setting('paypal_secret');
  const mode     = setting('paypal_mode') || 'sandbox';
  return { clientId, secret, mode, baseUrl: mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com' };
}

async function getAccessToken(cfg: ReturnType<typeof getPayPalConfig>) {
  const res = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json() as any;
  if (!data.access_token) throw new Error('PayPal auth failed: ' + JSON.stringify(data));
  return data.access_token as string;
}

/* ── Config check ────────────────────────────────────────── */

router.get('/config', (_req: Request, res: Response) => {
  const { clientId, mode } = getPayPalConfig();
  res.json({ configured: !!clientId, clientId, mode });
});

/* ── Create order ────────────────────────────────────────── */

router.post('/checkout', async (req: Request, res: Response) => {
  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const invoice: any = db.prepare(`
    SELECT i.*, c.email as client_email FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id
    WHERE i.id = ?
  `).get(invoice_id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });

  try {
    const cfg = getPayPalConfig();
    if (!cfg.clientId) return res.status(400).json({ error: 'PayPal not configured' });
    const token = await getAccessToken(cfg);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    const order = await fetch(`${cfg.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: String(invoice.id),
          description: `Invoice ${invoice.invoice_number}`,
          amount: { currency_code: (invoice.currency || 'USD').toUpperCase(), value: invoice.amount.toFixed(2) },
        }],
        application_context: {
          return_url: `${clientUrl}/billing?payment=success&invoice_id=${invoice.id}&gateway=paypal`,
          cancel_url: `${clientUrl}/billing?payment=cancelled`,
        },
      }),
    }).then(r => r.json()) as any;

    const approvalUrl = order.links?.find((l: any) => l.rel === 'approve')?.href;
    if (!approvalUrl) return res.status(500).json({ error: 'No approval URL from PayPal', detail: order });

    res.json({ url: approvalUrl, orderId: order.id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Capture payment (called after user approves) ─────────── */

router.post('/capture', async (req: Request, res: Response) => {
  const { orderId, invoice_id } = req.body;
  if (!orderId || !invoice_id) return res.status(400).json({ error: 'orderId and invoice_id required' });
  try {
    const cfg = getPayPalConfig();
    const token = await getAccessToken(cfg);

    const capture = await fetch(`${cfg.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }).then(r => r.json()) as any;

    if (capture.status === 'COMPLETED') {
      db.prepare("UPDATE invoices SET status='paid', paid_date=date('now') WHERE id=?").run(invoice_id);
      const amount = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0;
      db.prepare("INSERT OR IGNORE INTO payments (invoice_id, amount, method, reference, notes) VALUES (?, ?, 'paypal', ?, 'PayPal')").run(invoice_id, amount, orderId);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Payment not completed', status: capture.status });
    }
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
