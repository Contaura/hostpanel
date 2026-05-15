import { Router, Response } from 'express';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = process.env.LOGO_DIR || '/var/lib/hostpanel';
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, 'company_logo' + path.extname(file.originalname)),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /\.(png|jpg|jpeg|gif|svg)$/i.test(file.originalname)),
});

const router = Router();

function getSetting(key: string) {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? '';
}

function getSmtpTransporter() {
  const host = getSetting('smtp_host');
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(getSetting('smtp_port')) || 587,
    secure: getSetting('smtp_secure') === '1',
    auth: getSetting('smtp_user') ? { user: getSetting('smtp_user'), pass: getSetting('smtp_pass') } : undefined,
  });
}

/* ─── Plans ─────────────────────────────────────────────── */

router.get('/plans', (_req, res: Response) => {
  res.json(db.prepare('SELECT * FROM plans ORDER BY price ASC').all());
});

router.post('/plans', (req, res: Response) => {
  const { name, description, price, billing_cycle, disk_quota, bandwidth, email_accts, databases, subdomains, ftp_accts, ssl } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price are required' });
  try {
    const r = db.prepare(`
      INSERT INTO plans (name, description, price, billing_cycle, disk_quota, bandwidth, email_accts, databases, subdomains, ftp_accts, ssl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || '', price, billing_cycle || 'monthly', disk_quota ?? 10240, bandwidth ?? 102400, email_accts ?? 10, databases ?? 5, subdomains ?? 10, ftp_accts ?? 5, ssl ?? 1);
    res.json(db.prepare('SELECT * FROM plans WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/plans/:id', (req, res: Response) => {
  // Partial updates: keep whatever's already in the row when a field is
  // omitted. The previous form blanked everything to NULL and 500'd with
  // "NOT NULL constraint failed: plans.disk_quota" the moment someone PUT
  // a minimal {name,price} body (which is the common "rename a plan" flow).
  const current: any = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Plan not found' });
  const pick = <T,>(k: string, fallback: T) => (req.body[k] !== undefined ? req.body[k] : fallback);
  try {
    db.prepare(`
      UPDATE plans SET name=?, description=?, price=?, billing_cycle=?, disk_quota=?, bandwidth=?,
        email_accts=?, databases=?, subdomains=?, ftp_accts=?, ssl=?
      WHERE id=?
    `).run(
      pick('name',          current.name),
      pick('description',   current.description ?? ''),
      pick('price',         current.price),
      pick('billing_cycle', current.billing_cycle),
      pick('disk_quota',    current.disk_quota),
      pick('bandwidth',     current.bandwidth),
      pick('email_accts',   current.email_accts),
      pick('databases',     current.databases),
      pick('subdomains',    current.subdomains),
      pick('ftp_accts',     current.ftp_accts),
      pick('ssl',           current.ssl),
      req.params.id,
    );
    res.json(db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/plans/:id', (req, res: Response) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ─── Clients ────────────────────────────────────────────── */

router.get('/clients', (_req, res: Response) => {
  res.json(db.prepare(`
    SELECT c.id, c.name, c.email, c.phone, c.company, c.address, c.city, c.country, c.notes,
           c.portal_enabled, c.created_at,
           COUNT(a.id) as account_count,
           SUM(CASE WHEN i.status IN ('unpaid','overdue') THEN i.amount ELSE 0 END) as balance_due
    FROM clients c
    LEFT JOIN accounts a ON a.client_id = c.id
    LEFT JOIN invoices i ON i.client_id = c.id
    GROUP BY c.id ORDER BY c.created_at DESC
  `).all());
});

router.get('/clients/:id', (req, res: Response) => {
  const client = db.prepare('SELECT id, name, email, phone, company, address, city, country, notes, portal_enabled, created_at FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ client, accounts: db.prepare('SELECT * FROM accounts WHERE client_id = ?').all(req.params.id), invoices: db.prepare('SELECT * FROM invoices WHERE client_id = ? ORDER BY created_at DESC').all(req.params.id) });
});

router.post('/clients', (req, res: Response) => {
  const { name, email, phone, company, address, city, country, notes } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  try {
    const r = db.prepare('INSERT INTO clients (name, email, phone, company, address, city, country, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, email, phone || '', company || '', address || '', city || '', country || '', notes || '');
    res.json(db.prepare('SELECT id, name, email, phone, company, address, city, country, notes, portal_enabled, created_at FROM clients WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/clients/:id', (req, res: Response) => {
  const { name, email, phone, company, address, city, country, notes } = req.body;
  try {
    db.prepare('UPDATE clients SET name=?, email=?, phone=?, company=?, address=?, city=?, country=?, notes=? WHERE id=?')
      .run(name, email, phone || '', company || '', address || '', city || '', country || '', notes || '', req.params.id);
    res.json(db.prepare('SELECT id, name, email, phone, company, address, city, country, notes, portal_enabled, created_at FROM clients WHERE id = ?').get(req.params.id));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/clients/:id', (req, res: Response) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ─── Invoices ───────────────────────────────────────────── */

router.get('/invoices', (_req, res: Response) => {
  res.json(db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, a.domain as account_domain
    FROM invoices i
    LEFT JOIN clients  c ON i.client_id  = c.id
    LEFT JOIN accounts a ON i.account_id = a.id
    ORDER BY i.created_at DESC
  `).all());
});

router.get('/invoices/:id', (req, res: Response) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, c.company, c.address, c.city, c.country,
           a.domain as account_domain, a.username
    FROM invoices i
    LEFT JOIN clients  c ON i.client_id  = c.id
    LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice, payments: db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id) });
});

router.post('/invoices', (req, res: Response) => {
  const { client_id, account_id, subtotal, tax_rate, discount, currency, due_date, notes, items } = req.body;
  if (!client_id || subtotal === undefined || !due_date) return res.status(400).json({ error: 'client_id, subtotal, and due_date are required' });

  const sub  = Number(subtotal) || 0;
  const rate = Number(tax_rate) || Number(getSetting('tax_rate')) || 0;
  const disc = Number(discount) || 0;
  const tax  = Math.round((sub - disc) * rate / 100 * 100) / 100;
  const total = Math.round((sub - disc + tax) * 100) / 100;
  const prefix = getSetting('invoice_prefix') || 'INV';

  try {
    const invoiceNum = `${prefix}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO invoices (invoice_number, client_id, account_id, subtotal, tax_rate, tax_amount, discount, amount, currency, due_date, notes, items)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNum, client_id, account_id || null, sub, rate, tax, disc, total, currency || getSetting('currency') || 'USD', due_date, notes || '', JSON.stringify(items || []));
    res.json(db.prepare('SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/invoices/:id/status', (req, res: Response) => {
  const { status } = req.body;
  if (!['paid', 'unpaid', 'overdue', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const paid_date = status === 'paid' ? new Date().toISOString().slice(0, 10) : null;
  db.prepare('UPDATE invoices SET status = ?, paid_date = ? WHERE id = ?').run(status, paid_date, req.params.id);
  res.json({ success: true });
});

router.delete('/invoices/:id', (req, res: Response) => {
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ─── Invoice PDF ────────────────────────────────────────── */

// Pulled out of the /invoices/:id/pdf handler so the client portal can reuse
// the same renderer for its own /api/portal/invoices/:id/pdf endpoint (after
// the portal's own client-ownership check on the row). Anything that lands a
// fully-hydrated invoice row here gets a streamed PDF back.
export function renderInvoicePdf(row: any, res: Response) {
  const company = getSetting('company_name') || 'HostPanel';
  const companyEmail = getSetting('company_email') || '';
  const companyAddr  = getSetting('company_address') || '';
  const taxName = getSetting('tax_name') || 'Tax';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${row.invoice_number}.pdf"`);

  const logoPath = getSetting('company_logo');
  const hasLogo = logoPath && fs.existsSync(logoPath);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  // Header
  if (hasLogo) {
    try { doc.image(logoPath, 50, 45, { width: 70 }); } catch {}
    doc.fontSize(18).font('Helvetica-Bold').text(company, 130, 50);
    if (companyEmail) doc.fontSize(10).font('Helvetica').text(companyEmail, 130, 72);
    if (companyAddr)  doc.text(companyAddr, 130, 85);
  } else {
    doc.fontSize(22).font('Helvetica-Bold').text(company, 50, 50);
    if (companyEmail) doc.fontSize(10).font('Helvetica').text(companyEmail, 50, 75);
    if (companyAddr)  doc.text(companyAddr, 50, 88);
  }

  doc.fontSize(28).font('Helvetica-Bold').fillColor('#4f46e5').text('INVOICE', 400, 50, { align: 'right' });
  doc.fontSize(10).font('Helvetica').fillColor('#374151');
  doc.text(`Invoice #: ${row.invoice_number}`, 400, 85, { align: 'right' });
  doc.text(`Date: ${row.created_at?.slice(0, 10) || ''}`, 400, 100, { align: 'right' });
  doc.text(`Due: ${row.due_date}`, 400, 115, { align: 'right' });

  // Bill To
  doc.moveDown(2).fontSize(11).font('Helvetica-Bold').fillColor('#111827').text('BILL TO');
  doc.fontSize(10).font('Helvetica').fillColor('#374151');
  doc.text(row.client_name || '');
  if (row.client_email) doc.text(row.client_email);
  if (row.company) doc.text(row.company);
  if (row.address) doc.text(row.address);
  if (row.city || row.country) doc.text([row.city, row.country].filter(Boolean).join(', '));

  // Line items
  const tableTop = doc.y + 24;
  doc.rect(50, tableTop, 495, 22).fill('#f3f4f6');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151');
  doc.text('Description', 58, tableTop + 6);
  doc.text('Amount', 480, tableTop + 6, { width: 60, align: 'right' });

  let y = tableTop + 30;
  doc.font('Helvetica').fillColor('#1f2937');

  const items: any[] = (() => { try { return JSON.parse(row.items || '[]'); } catch { return []; } })();
  if (items.length) {
    for (const item of items) {
      doc.text(item.description || '', 58, y);
      doc.text(`${row.currency} ${Number(item.amount || 0).toFixed(2)}`, 480, y, { width: 60, align: 'right' });
      y += 20;
    }
  } else {
    const desc = row.account_domain ? `Hosting — ${row.account_domain}` : 'Hosting service';
    doc.text(desc, 58, y);
    doc.text(`${row.currency} ${Number(row.subtotal || row.amount).toFixed(2)}`, 480, y, { width: 60, align: 'right' });
    y += 20;
  }

  // Totals
  y += 10;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 10;

  if (Number(row.discount) > 0) {
    doc.text(`Discount:`, 380, y); doc.text(`-${row.currency} ${Number(row.discount).toFixed(2)}`, 480, y, { width: 60, align: 'right' }); y += 18;
  }
  if (Number(row.tax_rate) > 0) {
    doc.text(`${taxName} (${row.tax_rate}%):`, 380, y); doc.text(`${row.currency} ${Number(row.tax_amount).toFixed(2)}`, 480, y, { width: 60, align: 'right' }); y += 18;
  }
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#4f46e5');
  doc.text(`Total:`, 380, y); doc.text(`${row.currency} ${Number(row.amount).toFixed(2)}`, 480, y, { width: 60, align: 'right' });

  // Status badge
  y += 35;
  const statusColor = row.status === 'paid' ? '#059669' : row.status === 'overdue' ? '#dc2626' : '#d97706';
  doc.roundedRect(50, y, 80, 22, 4).fill(statusColor);
  doc.fontSize(10).font('Helvetica-Bold').fillColor('white').text(row.status.toUpperCase(), 55, y + 6);

  doc.end();
}

router.get('/invoices/:id/pdf', (req, res: Response) => {
  const row: any = db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, c.company, c.address, c.city, c.country,
           a.domain as account_domain
    FROM invoices i
    LEFT JOIN clients  c ON i.client_id  = c.id
    LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  renderInvoicePdf(row, res);
});

/* ─── Email invoice ──────────────────────────────────────── */

router.post('/invoices/:id/email', async (req, res: Response) => {
  const row: any = db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email FROM invoices i
    LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  if (!row.client_email) return res.status(400).json({ error: 'Client has no email address' });

  const transporter = getSmtpTransporter();
  if (!transporter) return res.status(400).json({ error: 'SMTP not configured in Settings' });

  const company   = getSetting('company_name') || 'HostPanel';
  const smtpFrom  = getSetting('smtp_from') || getSetting('smtp_user');
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

  try {
    await transporter.sendMail({
      from: `"${company}" <${smtpFrom}>`,
      to: row.client_email,
      subject: `Invoice ${row.invoice_number} from ${company}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
          <h2 style="color:#4f46e5">${company}</h2>
          <p>Hi ${row.client_name},</p>
          <p>Please find your invoice below.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Invoice #</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${row.invoice_number}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${row.currency} ${Number(row.amount).toFixed(2)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Due Date</strong></td><td style="padding:8px;border:1px solid #e5e7eb">${row.due_date}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e5e7eb"><strong>Status</strong></td><td style="padding:8px;border:1px solid #e5e7eb;text-transform:uppercase">${row.status}</td></tr>
          </table>
          <p style="margin-top:24px">
            <a href="${clientUrl}/portal" style="background:#4f46e5;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">View & Pay Invoice</a>
          </p>
          <p style="color:#6b7280;font-size:12px">Download PDF: <a href="${clientUrl}/api/billing/invoices/${row.id}/pdf">Invoice PDF</a></p>
        </div>
      `,
    });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ─── Payments ───────────────────────────────────────────── */

router.post('/payments', (req, res: Response) => {
  const { invoice_id, amount, method, reference, notes } = req.body;
  if (!invoice_id || amount === undefined) return res.status(400).json({ error: 'invoice_id and amount required' });
  try {
    db.prepare('INSERT INTO payments (invoice_id, amount, method, reference, notes) VALUES (?, ?, ?, ?, ?)')
      .run(invoice_id, amount, method || 'manual', reference || '', notes || '');
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id) as any;
    const paid    = (db.prepare('SELECT SUM(amount) as total FROM payments WHERE invoice_id = ?').get(invoice_id) as any).total ?? 0;
    if (paid >= invoice.amount) db.prepare("UPDATE invoices SET status='paid', paid_date=date('now') WHERE id=?").run(invoice_id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ─── Client Portal password ─────────────────────────────── */

router.post('/clients/:id/portal-password', async (req, res: Response) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await require('bcryptjs').hash(password, 12);
    db.prepare('UPDATE clients SET password_hash=?, portal_enabled=1 WHERE id=?').run(hash, req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ─── Recurring billing schedules ───────────────────────── */

router.get('/recurring', (_req, res: Response) => {
  res.json(db.prepare(`
    SELECT rs.*, c.name as client_name, c.email as client_email, p.name as plan_name
    FROM recurring_schedules rs
    LEFT JOIN clients c ON rs.client_id = c.id
    LEFT JOIN plans p ON rs.plan_id = p.id
    ORDER BY rs.next_run ASC
  `).all());
});

router.post('/recurring', (req, res: Response) => {
  const { client_id, plan_id, account_id, amount, currency, cycle, next_run, notes } = req.body;
  if (!client_id || !amount || !cycle || !next_run) return res.status(400).json({ error: 'client_id, amount, cycle, next_run required' });
  try {
    const r = db.prepare(`
      INSERT INTO recurring_schedules (client_id, plan_id, account_id, amount, currency, cycle, next_run, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(client_id, plan_id || null, account_id || null, amount, currency || getSetting('currency') || 'USD', cycle, next_run, notes || '');
    res.json(db.prepare('SELECT * FROM recurring_schedules WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/recurring/:id', (req, res: Response) => {
  // Partial update: a PUT that omits a NOT NULL column (currency) used to
  // 500 with "NOT NULL constraint failed". Fetch the row and fall back to
  // its existing values — same pattern we already use for plans and
  // autoresponders.
  const current: any = db.prepare('SELECT * FROM recurring_schedules WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Recurring schedule not found' });
  const pick = <T,>(k: string, fb: T) => (req.body[k] !== undefined ? req.body[k] : fb);
  db.prepare('UPDATE recurring_schedules SET amount=?, currency=?, cycle=?, next_run=?, status=?, notes=? WHERE id=?')
    .run(
      pick('amount',   current.amount),
      pick('currency', current.currency),
      pick('cycle',    current.cycle),
      pick('next_run', current.next_run),
      pick('status',   current.status),
      pick('notes',    current.notes ?? ''),
      req.params.id,
    );
  res.json(db.prepare('SELECT * FROM recurring_schedules WHERE id = ?').get(req.params.id));
});

router.delete('/recurring/:id', (req, res: Response) => {
  db.prepare('DELETE FROM recurring_schedules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/recurring/:id/run', async (req, res: Response) => {
  const schedule = db.prepare('SELECT * FROM recurring_schedules WHERE id = ?').get(req.params.id) as any;
  if (!schedule) return res.status(404).json({ error: 'Not found' });
  try {
    const prefix = getSetting('invoice_prefix') || 'INV';
    const invoiceNum = `${prefix}-${Date.now()}`;
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const r = db.prepare(`
      INSERT INTO invoices (invoice_number, client_id, account_id, subtotal, tax_rate, tax_amount, discount, amount, currency, due_date, notes, items)
      VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, '[]')
    `).run(invoiceNum, schedule.client_id, schedule.account_id, schedule.amount, schedule.amount, schedule.currency, dueDate, `Recurring — ${schedule.cycle}`);

    // advance next_run
    const next = new Date(schedule.next_run);
    if (schedule.cycle === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (schedule.cycle === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else if (schedule.cycle === 'weekly') next.setDate(next.getDate() + 7);
    db.prepare('UPDATE recurring_schedules SET next_run=?, last_run=date("now") WHERE id=?').run(next.toISOString().slice(0, 10), schedule.id);

    res.json({ success: true, invoice_id: r.lastInsertRowid });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ─── Credit notes ───────────────────────────────────────── */

router.get('/credit-notes', (_req, res: Response) => {
  res.json(db.prepare(`
    SELECT cn.*, c.name as client_name FROM credit_notes cn
    LEFT JOIN clients c ON cn.client_id = c.id
    ORDER BY cn.created_at DESC
  `).all());
});

router.post('/credit-notes', (req, res: Response) => {
  const { client_id, amount, currency, reason, invoice_id } = req.body;
  if (!client_id || !amount) return res.status(400).json({ error: 'client_id and amount required' });
  try {
    const prefix = getSetting('invoice_prefix') || 'INV';
    const num = `CN-${prefix}-${Date.now()}`;
    const r = db.prepare(`
      INSERT INTO credit_notes (credit_number, client_id, invoice_id, amount, currency, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(num, client_id, invoice_id || null, amount, currency || getSetting('currency') || 'USD', reason || '');
    res.json(db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/credit-notes/:id/apply', (req, res: Response) => {
  const { invoice_id } = req.body;
  // The credit_notes schema's status default is 'issued' (not 'active'),
  // so the prior `status="active"` filter never matched and every /apply
  // call 404'd. An applied/used note is "used"; everything else is
  // "issued" and applicable.
  const cn = db.prepare("SELECT * FROM credit_notes WHERE id = ? AND status='issued'").get(req.params.id) as any;
  if (!cn) return res.status(404).json({ error: 'Unapplied credit note not found' });
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const newAmount = Math.max(0, Number(invoice.amount) - Number(cn.amount));
  db.prepare("UPDATE invoices SET amount=? WHERE id=?").run(newAmount, invoice_id);
  db.prepare("UPDATE credit_notes SET status='used', invoice_id=? WHERE id=?").run(invoice_id, cn.id);
  if (newAmount === 0) db.prepare("UPDATE invoices SET status='paid', paid_date=date('now') WHERE id=?").run(invoice_id);
  res.json({ success: true, new_amount: newAmount });
});

router.delete('/credit-notes/:id', (req, res: Response) => {
  db.prepare('DELETE FROM credit_notes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ─── Promo codes ────────────────────────────────────────── */

router.get('/promo-codes', (_req, res: Response) => {
  res.json(db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC').all());
});

// promo_codes columns (per db.ts schema): code, discount_type, discount_value,
// max_uses, uses, expires_at, enabled. The routes used to reference type /
// value / active / uses_count, which don't exist — every promo endpoint 500'd
// with "no such column: active" until this rewrite. Accept the old field
// names from older clients as aliases so a stale UI doesn't break.
router.post('/promo-codes', (req, res: Response) => {
  const { code } = req.body;
  const discount_type  = req.body.discount_type  ?? req.body.type;
  const discount_value = req.body.discount_value ?? req.body.value;
  const max_uses       = req.body.max_uses ?? 0;
  const expires_at     = req.body.expires_at ?? null;
  if (!code || !discount_type || discount_value === undefined) {
    return res.status(400).json({ error: 'code, discount_type, discount_value required' });
  }
  if (!['percent', 'fixed'].includes(discount_type)) {
    return res.status(400).json({ error: 'discount_type must be percent or fixed' });
  }
  try {
    const r = db.prepare('INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(code.toUpperCase(), discount_type, discount_value, max_uses, expires_at);
    res.json(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/promo-codes/validate', (req, res: Response) => {
  const { code } = req.body;
  // Accept either `amount` (legacy) or `subtotal` (what the rest of the
  // billing flow uses) as the value to discount against.
  const amount = Number(req.body.amount ?? req.body.subtotal);
  if (!code) return res.status(400).json({ error: 'code is required' });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'amount must be a non-negative number' });
  const promo = db.prepare("SELECT * FROM promo_codes WHERE code=? AND enabled=1").get(code.toUpperCase()) as any;
  if (!promo) return res.status(404).json({ error: 'Invalid or inactive promo code' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(400).json({ error: 'Promo code expired' });
  if (promo.max_uses && promo.uses >= promo.max_uses) return res.status(400).json({ error: 'Promo code usage limit reached' });
  const discount = promo.discount_type === 'percent'
    ? Math.round(amount * Number(promo.discount_value) / 100 * 100) / 100
    : Math.min(Number(promo.discount_value), amount);
  res.json({ valid: true, promo, discount, final_amount: Math.max(0, amount - discount) });
});

router.put('/promo-codes/:id', (req, res: Response) => {
  // Accept old `active` alongside the schema's `enabled` for backward compat.
  const enabled = req.body.enabled ?? req.body.active;
  const { max_uses, expires_at } = req.body;
  db.prepare('UPDATE promo_codes SET enabled=?, max_uses=?, expires_at=? WHERE id=?')
    .run(enabled ? 1 : 0, max_uses ?? 0, expires_at ?? null, req.params.id);
  res.json(db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(req.params.id));
});

router.delete('/promo-codes/:id', (req, res: Response) => {
  db.prepare('DELETE FROM promo_codes WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ─── Company logo upload ────────────────────────────────── */

router.post('/settings/logo', logoUpload.single('logo'), (req, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
  db.prepare("INSERT INTO settings (key, value) VALUES ('company_logo', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(req.file.path);
  res.json({ path: req.file.path, filename: req.file.filename });
});

router.delete('/settings/logo', (req, res: Response) => {
  const logoPath = getSetting('company_logo');
  if (logoPath) { try { fs.unlinkSync(logoPath); } catch {} }
  db.prepare("DELETE FROM settings WHERE key='company_logo'").run();
  res.json({ success: true });
});

/* ─── Summary ────────────────────────────────────────────── */

router.get('/summary', (_req, res: Response) => {
  res.json({
    totalAccounts:  (db.prepare("SELECT COUNT(*) as n FROM accounts").get() as any).n,
    activeAccounts: (db.prepare("SELECT COUNT(*) as n FROM accounts WHERE status='active'").get() as any).n,
    totalClients:   (db.prepare("SELECT COUNT(*) as n FROM clients").get() as any).n,
    totalRevenue:   (db.prepare("SELECT COALESCE(SUM(amount),0) as n FROM payments").get() as any).n,
    outstanding:    (db.prepare("SELECT COALESCE(SUM(amount),0) as n FROM invoices WHERE status IN ('unpaid','overdue')").get() as any).n,
    overdueCount:   (db.prepare("SELECT COUNT(*) as n FROM invoices WHERE status='overdue'").get() as any).n,
    recentInvoices: db.prepare('SELECT i.*, c.name as client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id ORDER BY i.created_at DESC LIMIT 5').all(),
  });
});

export default router;
