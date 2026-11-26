'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_DAYS = 60;
const COOKIE = 'enseada_sessao';

const ROLES = ['admin', 'operador', 'porteiro', 'manobrista', 'morador'];
const ROLE_LABELS = {
  admin: 'Administrador',
  operador: 'Operador',
  porteiro: 'Porteiro',
  manobrista: 'Manobrista',
  morador: 'Morador',
};

// Permission matrix. "Staff" = anyone with privileges (everyone except morador).
const PERMS = {
  flood: ['admin', 'operador', 'porteiro', 'manobrista'],
  packagesManage: ['admin', 'operador', 'porteiro'],
  garageManage: ['admin', 'operador', 'manobrista'],
  garageViewAll: ['admin', 'operador', 'porteiro', 'manobrista'],
  usersManage: ['admin'],
};

function can(user, perm) {
  return !!user && PERMS[perm].includes(user.role);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(req, res, token, expires) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires: new Date(expires),
    path: '/',
  });
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    apartment: u.apartment,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    status: u.status,
    emailNotify: !!u.email_notify,
    createdAt: u.created_at,
  };
}

/** Express middleware: attaches req.user when a valid session cookie is present. */
function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.sessionToken = token;
  if (token) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'ativo'`).get(token, new Date().toISOString());
    if (row) req.user = row;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (!can(req.user, perm)) return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    next();
  };
}

// Very small in-memory login throttle (per IP + email).
const attempts = new Map();
function loginThrottle(key) {
  const now = Date.now();
  const a = attempts.get(key) || { count: 0, first: now };
  if (now - a.first > 15 * 60e3) { a.count = 0; a.first = now; }
  a.count++;
  attempts.set(key, a);
  return a.count > 10;
}
function loginReset(key) { attempts.delete(key); }

module.exports = {
  COOKIE, ROLES, ROLE_LABELS, PERMS, can,
  hashPassword, verifyPassword, createSession, destroySession, setSessionCookie,
  publicUser, loadUser, requireAuth, requirePerm, loginThrottle, loginReset,
};
