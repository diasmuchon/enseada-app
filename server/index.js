'use strict';
const path = require('node:path');
const express = require('express');
const { db, getSetting, setSetting, tx } = require('./db');
const auth = require('./auth');
const { vapidPublicKey, notify, broadcast, sseHandler } = require('./notify');

const { can, requireAuth, requirePerm, publicUser } = auth;

// ---------- Primeiro administrador ----------
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const email = process.env.ADMIN_EMAIL || 'admin@enseada.local';
  const password = process.env.ADMIN_PASSWORD || 'enseada123';
  db.prepare(`INSERT INTO users (name, email, role, status, password_hash) VALUES (?, ?, 'admin', 'ativo', ?)`)
    .run('Administrador', email, auth.hashPassword(password));
  console.log(`[setup] Administrador criado: ${email} / ${process.env.ADMIN_PASSWORD ? '(senha do ADMIN_PASSWORD)' : password}`);
  if (!process.env.ADMIN_PASSWORD) console.log('[setup] TROQUE ESSA SENHA no primeiro acesso (Perfil > Alterar senha).');
}

// ---------- Helpers ----------
const normApt = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const normPlate = (s) => String(s ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const str = (s, max = 200) => (s == null ? null : String(s).trim().slice(0, max) || null);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));

function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }

function residentsOf(apartment) {
  return db.prepare(`SELECT * FROM users WHERE apartment = ? AND status = 'ativo'`).all(apartment);
}
function allActiveUsers() {
  return db.prepare(`SELECT * FROM users WHERE status = 'ativo'`).all();
}
function usersWithRoles(roles) {
  return db.prepare(`SELECT * FROM users WHERE status = 'ativo' AND role IN (${roles.map(() => '?').join(',')})`).all(...roles);
}
const staffRoles = auth.PERMS.garageViewAll;

function garageStatus() {
  return getSetting('garage', { maneuvering: false, full: false, updatedAt: null, updatedBy: null, maneuveringSince: null });
}

function activeFlood() {
  return db.prepare(`
    SELECT f.id, f.message, f.activated_at, u.name AS activated_by_name
    FROM flood_alerts f LEFT JOIN users u ON u.id = f.activated_by
    WHERE f.deactivated_at IS NULL ORDER BY f.id DESC LIMIT 1`).get() || null;
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(auth.loadUser);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Proteção CSRF: toda requisição que altera dados precisa de um cabeçalho customizado,
// que navegadores só enviam a partir do próprio site.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'enseada') return bad(res, 'Requisição inválida.', 403);
  next();
});

app.get('/api/config', (_req, res) => {
  res.json({ appName: 'Condomínio Enseada', vapidPublicKey: vapidPublicKey(), roles: auth.ROLE_LABELS });
});

// ---------- Autenticação ----------
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${email}`;
  if (auth.loginThrottle(key)) return bad(res, 'Muitas tentativas. Aguarde alguns minutos.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !auth.verifyPassword(password, user.password_hash)) return bad(res, 'E-mail ou senha incorretos.', 401);
  if (user.status === 'pendente') return bad(res, 'Seu cadastro ainda está aguardando aprovação da administração.', 403);
  if (user.status !== 'ativo') return bad(res, 'Seu acesso está desativado. Procure a administração.', 403);
  auth.loginReset(key);
  const s = auth.createSession(user.id);
  auth.setSessionCookie(req, res, s.token, s.expires);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionToken) auth.destroySession(req.sessionToken);
  res.clearCookie(auth.COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Auto-cadastro de moradores (fica pendente até um administrador aprovar).
app.post('/api/auth/register', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100);
  const email = String(b.email || '').trim().toLowerCase();
  const apartment = normApt(b.apartment);
  const password = String(b.password || '');
  if (!name) return bad(res, 'Informe seu nome.');
  if (!isEmail(email)) return bad(res, 'Informe um e-mail válido.');
  if (!apartment) return bad(res, 'Informe o número do apartamento.');
  if (password.length < 6) return bad(res, 'A senha deve ter pelo menos 6 caracteres.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'Este e-mail já está cadastrado.');
  db.prepare(`INSERT INTO users (name, email, phone, apartment, role, status, password_hash)
              VALUES (?, ?, ?, ?, 'morador', 'pendente', ?)`)
    .run(name, email, str(b.phone, 30), apartment, auth.hashPassword(password));
  res.json({ ok: true });
  notify(usersWithRoles(['admin']), {
    type: 'cadastro', title: 'Novo cadastro aguardando aprovação',
    body: `${name} (apto ${apartment}) solicitou acesso ao sistema.`, url: '/#/admin',
  }).catch(console.error);
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const u = req.user;
  if (b.newPassword != null) {
    if (!auth.verifyPassword(String(b.currentPassword || ''), u.password_hash)) return bad(res, 'Senha atual incorreta.');
    if (String(b.newPassword).length < 6) return bad(res, 'A nova senha deve ter pelo menos 6 caracteres.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(String(b.newPassword)), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(u.id, req.sessionToken);
  }
  db.prepare('UPDATE users SET name = ?, phone = ?, email_notify = ? WHERE id = ?').run(
    str(b.name, 100) || u.name,
    b.phone !== undefined ? str(b.phone, 30) : u.phone,
    b.emailNotify !== undefined ? (b.emailNotify ? 1 : 0) : u.email_notify,
    u.id,
  );
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

// ---------- Push ----------
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return bad(res, 'Inscrição inválida.');
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys_json = excluded.keys_json`)
    .run(req.user.id, String(sub.endpoint), JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth }));
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(req.body?.endpoint || ''), req.user.id);
  res.json({ ok: true });
});

app.post('/api/push/test', requireAuth, async (req, res) => {
  await notify([req.user], { type: 'teste', title: 'Notificações ativadas ✅', body: 'Você receberá os avisos do Condomínio Enseada neste aparelho.' });
  res.json({ ok: true });
});

// ---------- Notificações no app ----------
app.get('/api/notifications', requireAuth, (req, res) => {
  const items = db.prepare(`SELECT id, type, title, body, url, read_at, created_at FROM notifications
                            WHERE user_id = ? ORDER BY id DESC LIMIT 50`).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
  res.json({ items, unread });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(req.user.id);
  res.json({ ok: true });
});

app.get('/api/events', requireAuth, sseHandler);

// ---------- Painel ----------
app.get('/api/status', requireAuth, (req, res) => {
  const u = req.user;
  const out = { flood: activeFlood(), garage: garageStatus() };
  if (can(u, 'packagesManage')) {
    out.pendingPackages = db.prepare(`SELECT COUNT(*) AS n FROM packages WHERE status = 'aguardando'`).get().n;
  } else if (u.apartment) {
    out.pendingPackages = db.prepare(`SELECT COUNT(*) AS n FROM packages WHERE status = 'aguardando' AND apartment = ?`).get(u.apartment).n;
  }
  if (can(u, 'garageViewAll')) {
    out.parkedVehicles = db.prepare(`SELECT COUNT(*) AS n FROM vehicles WHERE status = 'estacionado'`).get().n;
  } else if (u.apartment) {
    out.myVehicles = db.prepare(`SELECT id, plate, model, color, spot, entered_at FROM vehicles
                                 WHERE status = 'estacionado' AND apartment = ? ORDER BY entered_at DESC`).all(u.apartment);
  }
  if (can(u, 'usersManage')) {
    out.pendingUsers = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pendente'`).get().n;
  }
  res.json(out);
});

// ---------- 1. Alerta de alagamento ----------
app.post('/api/flood/activate', requirePerm('flood'), async (req, res) => {
  if (activeFlood()) return bad(res, 'Já existe um alerta de alagamento ativo.');
  const message = str(req.body?.message, 300);
  db.prepare('INSERT INTO flood_alerts (message, activated_by) VALUES (?, ?)').run(message, req.user.id);
  broadcast('flood');
  res.json({ flood: activeFlood() });
  notify(allActiveUsers(), {
    type: 'alagamento', urgent: true, email: true, url: '/',
    title: '🚨 ALERTA DE ALAGAMENTO',
    body: message || 'Risco de alagamento no condomínio. Se possível, retire seu veículo da garagem e siga as orientações da portaria.',
  }).catch(console.error);
});

app.post('/api/flood/deactivate', requirePerm('flood'), async (req, res) => {
  const f = activeFlood();
  if (!f) return bad(res, 'Não há alerta ativo.');
  db.prepare(`UPDATE flood_alerts SET deactivated_by = ?, deactivated_at = datetime('now') WHERE id = ?`).run(req.user.id, f.id);
  broadcast('flood');
  res.json({ flood: null });
  notify(allActiveUsers(), {
    type: 'alagamento-fim', url: '/',
    title: '✅ Alerta de alagamento encerrado',
    body: 'A situação foi normalizada. Obrigado pela atenção.',
  }).catch(console.error);
});

app.get('/api/flood/history', requirePerm('flood'), (_req, res) => {
  res.json({
    items: db.prepare(`
      SELECT f.*, a.name AS activated_by_name, d.name AS deactivated_by_name
      FROM flood_alerts f
      LEFT JOIN users a ON a.id = f.activated_by
      LEFT JOIN users d ON d.id = f.deactivated_by
      ORDER BY f.id DESC LIMIT 30`).all(),
  });
});

// ---------- 2. Correspondências e encomendas ----------
app.get('/api/packages', requireAuth, (req, res) => {
  const status = ['aguardando', 'retirado'].includes(req.query.status) ? req.query.status : null;
  const where = [];
  const params = [];
  if (can(req.user, 'packagesManage')) {
    if (req.query.apartment) { where.push('p.apartment = ?'); params.push(normApt(req.query.apartment)); }
  } else {
    if (!req.user.apartment) return res.json({ items: [] });
    where.push('p.apartment = ?'); params.push(req.user.apartment);
  }
  if (status) { where.push('p.status = ?'); params.push(status); }
  const sql = `
    SELECT p.*, r.name AS received_by_name, d.name AS delivered_by_name
    FROM packages p
    LEFT JOIN users r ON r.id = p.received_by
    LEFT JOIN users d ON d.id = p.delivered_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (p.status = 'aguardando') DESC, p.received_at DESC LIMIT 200`;
  res.json({ items: db.prepare(sql).all(...params) });
});

app.post('/api/packages', requirePerm('packagesManage'), async (req, res) => {
  const b = req.body || {};
  const apartment = normApt(b.apartment);
  const kind = b.kind === 'correspondencia' ? 'correspondencia' : 'pacote';
  if (!apartment) return bad(res, 'Informe o número do apartamento.');
  const quantity = Math.min(Math.max(parseInt(b.quantity, 10) || 1, 1), 20);
  const ids = tx(() => {
    const ins = db.prepare(`INSERT INTO packages (apartment, kind, description, sender, recipient_name, received_by)
                            VALUES (?, ?, ?, ?, ?, ?)`);
    const out = [];
    for (let i = 0; i < quantity; i++) {
      out.push(Number(ins.run(apartment, kind, str(b.description, 200), str(b.sender, 100), str(b.recipientName, 100), req.user.id).lastInsertRowid));
    }
    return out;
  });
  broadcast('packages');
  const residents = residentsOf(apartment);
  res.json({ ids, notified: residents.length });

  const what = kind === 'correspondencia'
    ? (quantity > 1 ? `${quantity} correspondências` : 'uma correspondência')
    : (quantity > 1 ? `${quantity} encomendas` : 'uma encomenda');
  const details = [b.sender && `Remetente: ${str(b.sender, 100)}`, b.description && `Descrição: ${str(b.description, 200)}`,
    b.recipientName && `Destinatário: ${str(b.recipientName, 100)}`].filter(Boolean).join('\n');
  notify(residents, {
    type: 'encomenda', email: true, url: '/#/encomendas',
    title: kind === 'correspondencia' ? '✉️ Nova correspondência' : '📦 Nova encomenda',
    body: `Chegou ${what} para o apto ${apartment}. Retire na portaria.${details ? '\n' + details : ''}`,
  }).catch(console.error);
});

app.post('/api/packages/:id/deliver', requirePerm('packagesManage'), (req, res) => {
  const p = db.prepare('SELECT * FROM packages WHERE id = ?').get(req.params.id);
  if (!p) return bad(res, 'Encomenda não encontrada.', 404);
  if (p.status === 'retirado') return bad(res, 'Esta encomenda já foi retirada.');
  const pickedUpBy = str(req.body?.pickedUpBy, 100);
  if (!pickedUpBy) return bad(res, 'Informe quem retirou.');
  db.prepare(`UPDATE packages SET status = 'retirado', picked_up_by = ?, delivered_by = ?, picked_up_at = datetime('now') WHERE id = ?`)
    .run(pickedUpBy, req.user.id, p.id);
  broadcast('packages');
  res.json({ ok: true });
});

app.delete('/api/packages/:id', requirePerm('packagesManage'), (req, res) => {
  db.prepare('DELETE FROM packages WHERE id = ?').run(req.params.id);
  broadcast('packages');
  res.json({ ok: true });
});

// ---------- 3. Garagem ----------
app.get('/api/garage/status', requireAuth, (_req, res) => res.json(garageStatus()));

app.put('/api/garage/status', requirePerm('garageManage'), (req, res) => {
  const cur = garageStatus();
  const next = { ...cur };
  if (typeof req.body?.maneuvering === 'boolean') {
    next.maneuvering = req.body.maneuvering;
    next.maneuveringSince = req.body.maneuvering ? (cur.maneuvering ? cur.maneuveringSince : new Date().toISOString()) : null;
  }
  if (typeof req.body?.full === 'boolean') next.full = req.body.full;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = req.user.name;
  setSetting('garage', next);
  broadcast('garage');
  res.json(next);
});

app.get('/api/vehicles', requireAuth, (req, res) => {
  const status = ['estacionado', 'saiu'].includes(req.query.status) ? req.query.status : null;
  const where = [];
  const params = [];
  if (!can(req.user, 'garageViewAll')) {
    if (!req.user.apartment) return res.json({ items: [] });
    where.push('v.apartment = ?'); params.push(req.user.apartment);
  } else if (req.query.apartment) {
    where.push('v.apartment = ?'); params.push(normApt(req.query.apartment));
  }
  if (status) { where.push('v.status = ?'); params.push(status); }
  const staff = can(req.user, 'garageViewAll');
  const sql = `
    SELECT v.id, v.apartment, v.plate, v.model, v.color, v.spot, v.status, v.entered_at, v.exited_at
      ${staff ? ', e.name AS entered_by_name, x.name AS exited_by_name' : ''}
    FROM vehicles v
    LEFT JOIN users e ON e.id = v.entered_by
    LEFT JOIN users x ON x.id = v.exited_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (v.status = 'estacionado') DESC, COALESCE(v.exited_at, v.entered_at) DESC LIMIT 200`;
  res.json({ items: db.prepare(sql).all(...params) });
});

// Sugestões de veículos já registrados para um apartamento (agiliza o cadastro do manobrista).
app.get('/api/vehicles/known', requirePerm('garageManage'), (req, res) => {
  const apartment = normApt(req.query.apartment);
  if (!apartment) return res.json({ items: [] });
  res.json({
    items: db.prepare(`SELECT plate, model, color, MAX(entered_at) AS last FROM vehicles
                       WHERE apartment = ? GROUP BY plate ORDER BY last DESC LIMIT 10`).all(apartment),
  });
});

app.post('/api/vehicles', requirePerm('garageManage'), (req, res) => {
  const b = req.body || {};
  const apartment = normApt(b.apartment);
  const plate = normPlate(b.plate);
  if (!apartment) return bad(res, 'Informe o número do apartamento.');
  if (plate.length < 5) return bad(res, 'Informe a placa do veículo.');
  if (db.prepare(`SELECT 1 FROM vehicles WHERE plate = ? AND status = 'estacionado'`).get(plate)) {
    return bad(res, `O veículo ${plate} já consta como estacionado.`);
  }
  const r = db.prepare(`INSERT INTO vehicles (apartment, plate, model, color, spot, entered_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(apartment, plate, str(b.model, 60), str(b.color, 30), str(b.spot, 20), req.user.id);
  broadcast('vehicles');
  res.json({ id: Number(r.lastInsertRowid) });
});

app.post('/api/vehicles/:id/exit', requirePerm('garageManage'), (req, res) => {
  const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!v) return bad(res, 'Veículo não encontrado.', 404);
  if (v.status === 'saiu') return bad(res, 'Este veículo já saiu.');
  db.prepare(`UPDATE vehicles SET status = 'saiu', exited_by = ?, exited_at = datetime('now') WHERE id = ?`).run(req.user.id, v.id);
  broadcast('vehicles');
  res.json({ ok: true });
});

// ---------- Apartamentos (autocompletar para funcionários) ----------
app.get('/api/apartments', requireAuth, (req, res) => {
  if (!can(req.user, 'garageViewAll') && !can(req.user, 'packagesManage')) return bad(res, 'Sem permissão.', 403);
  const rows = db.prepare(`
    SELECT apartment, GROUP_CONCAT(name, ', ') AS residents FROM users
    WHERE apartment IS NOT NULL AND status = 'ativo' GROUP BY apartment ORDER BY apartment`).all();
  res.json({ items: rows });
});

// ---------- Administração de usuários ----------
app.get('/api/users', requirePerm('usersManage'), (_req, res) => {
  const items = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM push_subscriptions p WHERE p.user_id = u.id) AS devices
                            FROM users u ORDER BY (u.status = 'pendente') DESC, u.apartment, u.name`).all()
    .map((u) => ({ ...publicUser(u), devices: u.devices }));
  res.json({ items });
});

function validateUserInput(b, { creating }) {
  const out = {};
  if (creating || b.name !== undefined) { out.name = str(b.name, 100); if (!out.name) return 'Informe o nome.'; }
  if (creating || b.email !== undefined) {
    out.email = String(b.email || '').trim().toLowerCase();
    if (!isEmail(out.email)) return 'Informe um e-mail válido.';
  }
  if (creating || b.role !== undefined) { out.role = b.role; if (!auth.ROLES.includes(out.role)) return 'Perfil inválido.'; }
  if (b.apartment !== undefined) out.apartment = normApt(b.apartment) || null;
  if (b.phone !== undefined) out.phone = str(b.phone, 30);
  if (b.status !== undefined) { out.status = b.status; if (!['ativo', 'pendente', 'inativo'].includes(out.status)) return 'Status inválido.'; }
  if (b.password) { if (String(b.password).length < 6) return 'A senha deve ter pelo menos 6 caracteres.'; out.password_hash = auth.hashPassword(String(b.password)); }
  if (creating && !out.password_hash) return 'Defina uma senha inicial.';
  if ((out.role === 'morador') && !out.apartment && creating) return 'Moradores precisam de um apartamento.';
  return out;
}

app.post('/api/users', requirePerm('usersManage'), (req, res) => {
  const v = validateUserInput(req.body || {}, { creating: true });
  if (typeof v === 'string') return bad(res, v);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(v.email)) return bad(res, 'Este e-mail já está cadastrado.');
  const r = db.prepare(`INSERT INTO users (name, email, phone, apartment, role, status, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(v.name, v.email, v.phone ?? null, v.apartment ?? null, v.role, v.status || 'ativo', v.password_hash);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.patch('/api/users/:id', requirePerm('usersManage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return bad(res, 'Usuário não encontrado.', 404);
  const v = validateUserInput(req.body || {}, { creating: false });
  if (typeof v === 'string') return bad(res, v);
  if (target.id === req.user.id && ((v.role && v.role !== 'admin') || (v.status && v.status !== 'ativo'))) {
    return bad(res, 'Você não pode remover seu próprio acesso de administrador.');
  }
  if (v.email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(v.email, target.id)) {
    return bad(res, 'Este e-mail já está cadastrado.');
  }
  const fields = Object.keys(v);
  if (fields.length) {
    db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((f) => v[f]), target.id);
  }
  if (v.status && v.status !== 'ativo') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  if (target.status === 'pendente' && v.status === 'ativo') {
    notify([db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)], {
      type: 'cadastro', email: true, title: 'Cadastro aprovado',
      body: 'Seu acesso ao sistema do Condomínio Enseada foi aprovado. Você já pode entrar com seu e-mail e senha.',
    }).catch(console.error);
  }
  res.json({ ok: true });
});

app.delete('/api/users/:id', requirePerm('usersManage'), (req, res) => {
  if (Number(req.params.id) === req.user.id) return bad(res, 'Você não pode excluir a si mesmo.');
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.use('/api', (_req, res) => bad(res, 'Rota não encontrada.', 404));

// ---------- Front-end ----------
const PUBLIC = path.join(__dirname, '..', 'public');
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(PUBLIC, 'sw.js'));
});
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: '1h' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return bad(res, 'JSON inválido.');
  bad(res, 'Erro interno. Tente novamente.', 500);
});

// Limpeza periódica de sessões expiradas.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()), 6 * 3600e3).unref();

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`Condomínio Enseada rodando em http://localhost:${PORT}`));
}

module.exports = app;
