'use strict';
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { db, getSetting, setSetting } = require('./db');

const APP_NAME = 'Condomínio Enseada';

// ---------- Web Push (VAPID) ----------
let vapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
};
if (!vapid.publicKey || !vapid.privateKey) {
  vapid = getSetting('vapid');
  if (!vapid) {
    vapid = webpush.generateVAPIDKeys();
    setSetting('vapid', vapid);
    console.log('[push] Novas chaves VAPID geradas e salvas no banco de dados.');
  }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:sindico@enseada.local', vapid.publicKey, vapid.privateKey);

function vapidPublicKey() { return vapid.publicKey; }

async function pushToUsers(userIds, payload) {
  if (!userIds.length) return;
  const placeholders = userIds.map(() => '?').join(',');
  const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`).all(...userIds);
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: JSON.parse(s.keys_json) },
        body,
        { TTL: 60 * 60 * 24, urgency: payload.urgent ? 'high' : 'normal' },
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      } else {
        console.warn('[push] falha ao enviar:', err.statusCode || err.message);
      }
    }
  }));
}

// ---------- E-mail ----------
let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
const EMAIL_FROM = process.env.EMAIL_FROM || `${APP_NAME} <nao-responda@enseada.local>`;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function emailUsers(users, subject, text) {
  const recipients = users.filter((u) => u.email && u.email_notify);
  if (!recipients.length) return;
  const link = APP_URL ? `\n\nAcesse: ${APP_URL}` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f2a3d">
      <h2 style="color:#0b6e99;margin-bottom:4px">${APP_NAME}</h2>
      <p style="font-size:16px;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>')}</p>
      ${APP_URL ? `<p><a href="${escapeHtml(APP_URL)}" style="background:#0b6e99;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Abrir o aplicativo</a></p>` : ''}
      <p style="font-size:12px;color:#667">Você recebeu este e-mail porque está cadastrado no sistema do condomínio. Para deixar de receber, desative os e-mails no seu perfil.</p>
    </div>`;
  for (const u of recipients) {
    const msg = { from: EMAIL_FROM, to: u.email, subject: `${APP_NAME} – ${subject}`, text: text + link, html };
    if (!transporter) {
      console.log(`[email] (SMTP não configurado) Para: ${u.email} | ${msg.subject}`);
      continue;
    }
    try { await transporter.sendMail(msg); } catch (e) { console.warn('[email] falha ao enviar para', u.email, e.message); }
  }
}

// ---------- Server-Sent Events (atualização em tempo real) ----------
const clients = new Set();
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const client = { res, userId: req.user.id };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
}

/** Tell connected browsers that something changed. userIds = null means everyone. */
function broadcast(event, userIds = null) {
  const set = userIds ? new Set(userIds) : null;
  for (const c of clients) {
    if (!set || set.has(c.userId)) c.res.write(`event: ${event}\ndata: {}\n\n`);
  }
}

// ---------- High-level notify ----------
/**
 * Creates in-app notifications, sends push and (optionally) e-mail.
 * @param {object[]} users rows from the users table
 */
async function notify(users, { type, title, body, url = '/', email = false, urgent = false }) {
  if (!users.length) return;
  const ins = db.prepare('INSERT INTO notifications (user_id, type, title, body, url) VALUES (?, ?, ?, ?, ?)');
  for (const u of users) ins.run(u.id, type, title, body, url);
  const ids = users.map((u) => u.id);
  broadcast('notifications', ids);
  await Promise.allSettled([
    pushToUsers(ids, { title, body, url, tag: type, urgent }),
    email ? emailUsers(users, title, body) : Promise.resolve(),
  ]);
}

module.exports = { vapidPublicKey, notify, broadcast, sseHandler, emailUsers, pushToUsers };
