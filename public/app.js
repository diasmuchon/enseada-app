'use strict';
/* Condomínio Enseada – aplicativo web (PWA) */

// ====================== Utilidades ======================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseDate(s) {
  if (!s) return null;
  // SQLite grava "AAAA-MM-DD HH:MM:SS" em UTC.
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}
function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoje, ${time}`;
  if (d.toDateString() === yest.toDateString()) return `ontem, ${time}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${time}`;
}
function ago(s) {
  const d = parseDate(s);
  if (!d) return '';
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return fmtDate(s);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'enseada' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (res.status === 401 && state.user) { state.user = null; render(); }
  if (!res.ok) throw new Error(data.error || 'Algo deu errado. Tente novamente.');
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

let modalSeq = 0;
/** Simple modal. Returns a promise resolved with form data (object) or null if cancelled. */
function modal({ title, html = '', confirm = 'Confirmar', cancel = 'Cancelar', danger = false }) {
  const dlg = $('#dialog');
  dlg.innerHTML = `
    <form method="dialog">
      <div class="dlg-body"><h2>${esc(title)}</h2>${html}</div>
      <div class="dlg-actions">
        ${cancel ? `<button class="btn ghost" value="cancel" formnovalidate>${esc(cancel)}</button>` : ''}
        <button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(confirm)}</button>
      </div>
    </form>`;
  const my = ++modalSeq;
  return new Promise((resolve) => {
    const form = $('form', dlg);
    let result = null;
    form.addEventListener('submit', (e) => {
      const ok = e.submitter?.value === 'ok';
      if (ok && !form.checkValidity()) { e.preventDefault(); form.reportValidity(); return; }
      result = ok ? Object.fromEntries(new FormData(form)) : null;
    });
    const onClose = () => {
      // Ignora eventos "close" atrasados de um diálogo anterior.
      if (my === modalSeq && dlg.open) return;
      dlg.removeEventListener('close', onClose);
      resolve(my === modalSeq ? result : null);
    };
    dlg.addEventListener('close', onClose);
    dlg.showModal();
    $('input, select, textarea', dlg)?.focus();
  });
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-5H7l-2 5z"/><path d="M3 12h18"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
};

// ====================== Estado ======================
const state = {
  user: null,
  config: null,
  status: null,
  unread: 0,
  apartments: [],
  pkgFilter: 'aguardando',
  vehFilter: 'estacionado',
  pkgKind: 'pacote',
};

const PERMS = {
  flood: ['admin', 'operador', 'porteiro', 'manobrista'],
  packagesManage: ['admin', 'operador', 'porteiro'],
  garageManage: ['admin', 'operador', 'manobrista'],
  garageViewAll: ['admin', 'operador', 'porteiro', 'manobrista'],
  usersManage: ['admin'],
};
const can = (perm) => !!state.user && PERMS[perm].includes(state.user.role);

// ====================== Push / Service worker ======================
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let swReg = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url;
  });
}

function urlB64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushState() {
  if (!pushSupported) return isIOS && !isStandalone ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permissão de notificação negada.', 'error'); return false; }
    const reg = swReg || await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(state.config.vapidPublicKey),
      });
    }
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    await api('/push/test', { method: 'POST' });
    toast('Notificações ativadas neste aparelho!', 'success');
    return true;
  } catch (e) {
    console.error(e);
    toast('Não foi possível ativar as notificações: ' + e.message, 'error');
    return false;
  }
}

async function disablePush() {
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  toast('Notificações desativadas neste aparelho.');
}

// Re-envia a inscrição ao servidor (caso o banco tenha sido recriado ou o usuário trocado).
async function syncPushSubscription() {
  if (!pushSupported || Notification.permission !== 'granted') return;
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } }).catch(() => {});
}

// ====================== Tempo real ======================
let events = null;
function connectEvents() {
  if (events) events.close();
  events = new EventSource('/api/events');
  const refresh = (what) => () => refreshFor(what);
  for (const ev of ['flood', 'garage', 'packages', 'vehicles', 'notifications']) events.addEventListener(ev, refresh(ev));
}

let refreshTimer = null;
const pending = new Set();
function refreshFor(what) {
  pending.add(what);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const kinds = new Set(pending); pending.clear();
    await loadStatus();
    if (kinds.has('notifications')) await loadUnread();
    renderChrome();
    const view = currentRoute();
    const relevant = {
      home: true,
      encomendas: kinds.has('packages'),
      garagem: kinds.has('garage') || kinds.has('vehicles'),
      notificacoes: kinds.has('notifications'),
    };
    if (relevant[view] && !document.querySelector('main input:focus, main textarea:focus, main select:focus') && !$('#dialog').open) renderView();
  }, 250);
}

async function loadStatus() { try { state.status = await api('/status'); } catch { /* ignore */ } }
async function loadUnread() { try { state.unread = (await api('/notifications')).unread; } catch { /* ignore */ } }

// ====================== Rotas ======================
const ROUTES = [
  { id: 'home', label: 'Início', icon: 'home', show: () => true },
  { id: 'encomendas', label: 'Encomendas', icon: 'box', show: () => true },
  { id: 'garagem', label: 'Garagem', icon: 'car', show: () => true },
  { id: 'admin', label: 'Admin', icon: 'shield', show: () => can('usersManage') },
  { id: 'perfil', label: 'Perfil', icon: 'user', show: () => true },
];
function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (r === 'notificacoes') return r;
  return ROUTES.find((x) => x.id === r && x.show()) ? r : 'home';
}
window.addEventListener('hashchange', () => { renderChrome(); renderView(); window.scrollTo(0, 0); });

// ====================== Render principal ======================
async function render() {
  const root = $('#root');
  if (!state.user) {
    if (events) { events.close(); events = null; }
    root.innerHTML = authView();
    bindAuth();
    return;
  }
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/">
        <img src="/icons/icon-192.png" alt="">
        <span>Enseada<small>${esc(state.user.roleLabel)}${state.user.apartment ? ' · Apto ' + esc(state.user.apartment) : ''}</small></span>
      </a>
      <nav class="desktop-nav" id="desktop-nav"></nav>
      <span class="spacer"></span>
      <a class="icon-btn" href="#/notificacoes" aria-label="Notificações" id="bell">${ICONS.bell}</a>
    </header>
    <main id="main"></main>
    <nav class="bottom-nav" id="bottom-nav"></nav>`;
  renderChrome();
  await renderView();
}

function renderChrome() {
  if (!state.user) return;
  const r = currentRoute();
  const links = ROUTES.filter((x) => x.show()).map((x) => {
    const badge = x.id === 'admin' && state.status?.pendingUsers ? ` (${state.status.pendingUsers})` : '';
    return { ...x, badge };
  });
  $('#desktop-nav').innerHTML = links.map((x) => `<a href="#/${x.id}" class="${r === x.id ? 'active' : ''}">${x.label}${x.badge}</a>`).join('');
  $('#bottom-nav').innerHTML = links.map((x) => `<a href="#/${x.id}" class="${r === x.id ? 'active' : ''}">${ICONS[x.icon]}<span>${x.label}</span></a>`).join('');
  $('#bell').innerHTML = ICONS.bell + (state.unread ? `<span class="badge">${state.unread > 99 ? '99+' : state.unread}</span>` : '');
}

async function renderView() {
  const main = $('#main');
  if (!main) return;
  const r = currentRoute();
  const views = { home: homeView, encomendas: packagesView, garagem: garageView, perfil: profileView, admin: adminView, notificacoes: notificationsView };
  try {
    await views[r](main);
  } catch (e) {
    main.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`;
  }
}

function floodBanner() {
  const f = state.status?.flood;
  if (!f) return '';
  return `
    <div class="flood-banner" role="alert">
      <span class="big">🌊</span>
      <div><strong>ALERTA DE ALAGAMENTO ATIVO</strong>
      ${esc(f.message || 'Risco de alagamento no condomínio. Se possível, retire seu veículo da garagem e siga as orientações da portaria.')}
      <div class="small" style="opacity:.85;margin-top:4px">Acionado ${esc(ago(f.activated_at))}${f.activated_by_name ? ' por ' + esc(f.activated_by_name) : ''}</div></div>
    </div>`;
}

function garageStatusHtml(g) {
  if (!g) return '';
  const man = g.maneuvering
    ? `<div class="status-pill warn"><span class="dot"></span><div>Manobrista manobrando um veículo<small>Aguarde um momento antes de entrar/sair${g.maneuveringSince ? ' · desde ' + esc(fmtDate(g.maneuveringSince)) : ''}</small></div></div>`
    : `<div class="status-pill ok"><span class="dot"></span><div>Entrada livre<small>Nenhuma manobra em andamento</small></div></div>`;
  const cap = g.full
    ? `<div class="status-pill danger"><span class="dot"></span><div>Garagem lotada<small>Sem vagas disponíveis no momento</small></div></div>`
    : `<div class="status-pill ok"><span class="dot"></span><div>Vagas disponíveis</div></div>`;
  return `<div class="garage-status">${man}${cap}</div>
    ${g.updatedAt ? `<p class="small muted" style="margin:8px 0 0">Atualizado ${esc(ago(g.updatedAt))}</p>` : ''}`;
}

// ====================== Login / cadastro ======================
function authView() {
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">
        <img src="/icons/icon-192.png" alt="">
        <h1>Condomínio Enseada</h1>
        <p class="muted" style="margin:0">Avisos, encomendas e garagem</p>
      </div>
      <div class="card">
        <div class="segmented" role="tablist">
          <button type="button" class="active" data-tab="login">Entrar</button>
          <button type="button" data-tab="register">Criar cadastro</button>
        </div>
        <form id="login-form">
          <label class="field"><span>E-mail</span><input type="email" name="email" autocomplete="email" required></label>
          <label class="field"><span>Senha</span><input type="password" name="password" autocomplete="current-password" required></label>
          <button class="btn primary block">Entrar</button>
        </form>
        <form id="register-form" class="hidden">
          <label class="field"><span>Nome completo</span><input type="text" name="name" autocomplete="name" required></label>
          <div class="form-row">
            <label class="field"><span>Apartamento</span><input type="text" name="apartment" placeholder="Ex.: 101" required></label>
            <label class="field"><span>Celular</span><input type="tel" name="phone" autocomplete="tel" placeholder="(00) 00000-0000"></label>
          </div>
          <label class="field"><span>E-mail</span><input type="email" name="email" autocomplete="email" required></label>
          <label class="field"><span>Senha (mín. 6 caracteres)</span><input type="password" name="password" autocomplete="new-password" minlength="6" required></label>
          <button class="btn primary block">Enviar cadastro</button>
          <p class="small muted">Seu cadastro será analisado pela administração antes de ser liberado.</p>
        </form>
      </div>
    </div>
  </div>`;
}

function bindAuth() {
  $$('.segmented [data-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('.segmented [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#login-form').classList.toggle('hidden', b.dataset.tab !== 'login');
    $('#register-form').classList.toggle('hidden', b.dataset.tab !== 'register');
  }));
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      state.user = user;
      await afterLogin();
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target); btn.disabled = true;
    try {
      await api('/auth/register', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      await modal({ title: 'Cadastro enviado!', html: '<p>Assim que a administração aprovar seu acesso, você receberá um e-mail e poderá entrar.</p>', confirm: 'Ok', cancel: '' });
      $('[data-tab=login]').click();
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
  });
}

async function afterLogin() {
  await Promise.all([loadStatus(), loadUnread()]);
  if (can('packagesManage') || can('garageViewAll')) {
    api('/apartments').then((r) => { state.apartments = r.items; }).catch(() => {});
  }
  connectEvents();
  syncPushSubscription();
  await render();
}

// ====================== Início ======================
async function homeView(main) {
  await loadStatus();
  const s = state.status;
  const ps = await pushState().catch(() => 'unsupported');
  const pushCallout = ps === 'off'
    ? `<div class="callout"><span style="font-size:1.5rem">🔔</span><div class="grow"><strong>Ative as notificações</strong><div class="small">Receba alertas de alagamento e avisos de encomendas neste aparelho.</div></div><button class="btn primary sm" id="enable-push">Ativar</button></div>`
    : ps === 'ios-install'
      ? `<div class="callout warn"><span style="font-size:1.5rem">📲</span><div class="grow"><strong>Instale o app para receber notificações</strong><div class="small">No iPhone, toque em <b>Compartilhar</b> ⬆️ e depois em <b>Adicionar à Tela de Início</b>. Abra o app pelo ícone e ative as notificações.</div></div></div>`
      : '';

  const stats = [];
  stats.push(`<a class="stat" href="#/encomendas"><div class="label">${can('packagesManage') ? 'Encomendas aguardando' : 'Suas encomendas'}</div><div class="value">${s.pendingPackages ?? 0}</div></a>`);
  if (can('garageViewAll')) {
    stats.push(`<a class="stat" href="#/garagem"><div class="label">Veículos na garagem</div><div class="value">${s.parkedVehicles ?? 0}</div></a>`);
  } else {
    const n = s.myVehicles?.length || 0;
    stats.push(`<a class="stat" href="#/garagem"><div class="label">Seu veículo</div><div class="value sm">${n ? '🚗 Na garagem' : 'Fora da garagem'}</div></a>`);
  }
  if (can('usersManage')) {
    stats.push(`<a class="stat" href="#/admin"><div class="label">Cadastros pendentes</div><div class="value">${s.pendingUsers ?? 0}</div></a>`);
  }

  const floodCtl = can('flood') ? `
    <div class="card">
      <h2>Alerta de alagamento</h2>
      <p class="small muted">Ao acionar, todos os moradores e funcionários cadastrados recebem uma notificação no celular e por e-mail.</p>
      ${s.flood
        ? `<button class="flood-btn off" id="flood-off">✅ ENCERRAR ALERTA</button>`
        : `<button class="flood-btn" id="flood-on">🌊 ACIONAR ALERTA DE ALAGAMENTO</button>`}
    </div>` : '';

  main.innerHTML = `
    ${floodBanner()}
    <h1>Olá, ${esc(state.user.name.split(' ')[0])}!</h1>
    ${pushCallout}
    <div class="stats">${stats.join('')}</div>
    <div class="grid grid-2">
      ${floodCtl}
      <div class="card"><div class="section-title"><h2>Garagem agora</h2><a class="small" href="#/garagem">Ver garagem →</a></div>${garageStatusHtml(s.garage)}</div>
    </div>`;

  $('#enable-push')?.addEventListener('click', async () => { if (await enablePush()) renderView(); });
  $('#flood-on')?.addEventListener('click', async () => {
    const r = await modal({
      title: 'Acionar alerta de alagamento?', danger: true, confirm: 'Acionar alerta',
      html: `<p>Todos os moradores serão notificados imediatamente.</p>
        <label class="field"><span>Mensagem (opcional)</span><textarea name="message" maxlength="300" placeholder="Ex.: Água subindo na rua. Retirem os carros da garagem do subsolo."></textarea></label>`,
    });
    if (!r) return;
    try { await api('/flood/activate', { method: 'POST', body: { message: r.message } }); toast('Alerta acionado. Notificando todos…', 'success'); renderView(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#flood-off')?.addEventListener('click', async () => {
    const r = await modal({ title: 'Encerrar alerta de alagamento?', html: '<p>Todos serão avisados que a situação foi normalizada.</p>', confirm: 'Encerrar alerta' });
    if (!r) return;
    try { await api('/flood/deactivate', { method: 'POST' }); toast('Alerta encerrado.', 'success'); renderView(); } catch (e) { toast(e.message, 'error'); }
  });
}

// ====================== Encomendas ======================
function aptDatalist() {
  return `<datalist id="apts">${state.apartments.map((a) => `<option value="${esc(a.apartment)}">${esc(a.residents)}</option>`).join('')}</datalist>`;
}

async function packagesView(main) {
  const manage = can('packagesManage');
  const q = new URLSearchParams();
  if (state.pkgFilter !== 'todos') q.set('status', state.pkgFilter);
  const { items } = await api('/packages?' + q);

  const form = manage ? `
    <div class="card">
      <h2>Registrar chegada</h2>
      <form id="pkg-form">
        <div class="segmented" id="pkg-kind">
          <button type="button" data-kind="pacote" class="${state.pkgKind === 'pacote' ? 'active' : ''}">📦 Encomenda</button>
          <button type="button" data-kind="correspondencia" class="${state.pkgKind === 'correspondencia' ? 'active' : ''}">✉️ Correspondência</button>
        </div>
        <div class="form-row">
          <label class="field"><span>Apartamento *</span><input type="text" name="apartment" list="apts" required autocomplete="off" inputmode="text"></label>
          <label class="field"><span>Quantidade</span><input type="number" name="quantity" min="1" max="20" value="1"></label>
        </div>
        <div id="apt-hint" class="small muted" style="margin:-6px 0 10px"></div>
        <label class="field"><span>Remetente / transportadora</span><input type="text" name="sender" placeholder="Ex.: Correios, Mercado Livre, Amazon"></label>
        <div class="form-row">
          <label class="field"><span>Destinatário</span><input type="text" name="recipientName" placeholder="Nome na etiqueta"></label>
          <label class="field"><span>Descrição</span><input type="text" name="description" placeholder="Ex.: caixa média"></label>
        </div>
        <button class="btn primary block">Registrar e notificar morador</button>
      </form>
      ${aptDatalist()}
    </div>` : '';

  const list = items.length ? `<ul class="list">${items.map((p) => `
    <li data-apt="${esc(p.apartment)}">
      <div class="icon">${p.kind === 'correspondencia' ? '✉️' : '📦'}</div>
      <div class="grow">
        <div class="title">${manage ? `Apto ${esc(p.apartment)} · ` : ''}${p.kind === 'correspondencia' ? 'Correspondência' : 'Encomenda'}
          ${p.status === 'aguardando' ? '<span class="chip warn">Aguardando retirada</span>' : '<span class="chip ok">Retirada</span>'}</div>
        <div class="meta">${[p.sender, p.description, p.recipient_name && 'Para: ' + p.recipient_name].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="meta">Chegou ${esc(fmtDate(p.received_at))}${manage && p.received_by_name ? ' · recebida por ' + esc(p.received_by_name) : ''}</div>
        ${p.status === 'retirado' ? `<div class="meta">Retirada ${esc(fmtDate(p.picked_up_at))} por ${esc(p.picked_up_by)}</div>` : ''}
      </div>
      ${manage && p.status === 'aguardando' ? `<div class="actions"><button class="btn ok sm" data-deliver="${p.id}">Entregar</button></div>` : ''}
    </li>`).join('')}</ul>` : `<div class="empty">${state.pkgFilter === 'aguardando' ? 'Nenhuma encomenda aguardando retirada. 🎉' : 'Nenhum registro.'}</div>`;

  main.innerHTML = `
    ${floodBanner()}
    <h1>Correspondências e encomendas</h1>
    ${!manage && !state.user.apartment ? '<div class="callout warn">Seu cadastro não tem apartamento vinculado. Procure a administração.</div>' : ''}
    ${form}
    <div class="card">
      <div class="segmented" id="pkg-filter">
        <button data-f="aguardando" class="${state.pkgFilter === 'aguardando' ? 'active' : ''}">Aguardando</button>
        <button data-f="retirado" class="${state.pkgFilter === 'retirado' ? 'active' : ''}">Retiradas</button>
        <button data-f="todos" class="${state.pkgFilter === 'todos' ? 'active' : ''}">Todas</button>
      </div>
      ${manage ? '<div class="toolbar"><input type="search" id="pkg-search" placeholder="Filtrar por apartamento…"></div>' : ''}
      ${list}
    </div>`;

  $$('#pkg-filter button').forEach((b) => b.addEventListener('click', () => { state.pkgFilter = b.dataset.f; renderView(); }));
  $('#pkg-search')?.addEventListener('input', (e) => {
    const v = e.target.value.trim().toUpperCase();
    $$('.list > li[data-apt]').forEach((li) => { li.style.display = !v || li.dataset.apt.includes(v) ? '' : 'none'; });
  });
  $$('[data-deliver]').forEach((b) => b.addEventListener('click', async () => {
    const r = await modal({
      title: 'Registrar retirada', confirm: 'Confirmar entrega',
      html: '<label class="field"><span>Quem retirou?</span><input type="text" name="pickedUpBy" required placeholder="Nome de quem retirou"></label>',
    });
    if (!r) return;
    try { await api(`/packages/${b.dataset.deliver}/deliver`, { method: 'POST', body: r }); toast('Retirada registrada.', 'success'); renderView(); } catch (e) { toast(e.message, 'error'); }
  }));

  if (manage) {
    $$('#pkg-kind button').forEach((b) => b.addEventListener('click', () => {
      state.pkgKind = b.dataset.kind;
      $$('#pkg-kind button').forEach((x) => x.classList.toggle('active', x === b));
    }));
    const aptInput = $('#pkg-form [name=apartment]');
    aptInput.addEventListener('input', () => {
      const v = aptInput.value.trim().toUpperCase();
      const a = state.apartments.find((x) => x.apartment === v);
      $('#apt-hint').textContent = !v ? '' : a ? `Moradores: ${a.residents}` : '⚠️ Nenhum morador cadastrado neste apartamento — ninguém será notificado.';
    });
    $('#pkg-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.primary', e.target); btn.disabled = true;
      try {
        const body = { ...Object.fromEntries(new FormData(e.target)), kind: state.pkgKind };
        const r = await api('/packages', { method: 'POST', body });
        toast(r.notified ? `Registrado! ${r.notified} morador(es) notificado(s).` : 'Registrado. Nenhum morador cadastrado para notificar.', r.notified ? 'success' : '');
        e.target.reset();
        $('#apt-hint').textContent = '';
        renderView();
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }
}

// ====================== Garagem ======================
async function garageView(main) {
  await loadStatus();
  const g = state.status.garage;
  const manage = can('garageManage');
  const viewAll = can('garageViewAll');

  if (!viewAll) {
    // Visão do morador: só o próprio veículo.
    const { items } = await api('/vehicles');
    const parked = items.filter((v) => v.status === 'estacionado');
    const history = items.filter((v) => v.status === 'saiu').slice(0, 10);
    main.innerHTML = `
      ${floodBanner()}
      <h1>Garagem</h1>
      ${parked.length ? parked.map((v) => `
        <div class="my-car in"><span class="big">🚗</span><div><strong>Seu veículo está na garagem</strong>
          <span class="plate">${esc(v.plate)}</span> ${esc([v.model, v.color].filter(Boolean).join(' · '))}
          <div class="small">Estacionado ${esc(fmtDate(v.entered_at))}${v.spot ? ' · Vaga ' + esc(v.spot) : ''}</div></div></div>`).join('')
        : `<div class="my-car out"><span class="big">🅿️</span><div><strong>Nenhum veículo seu na garagem</strong><div class="small">Quando o manobrista estacionar seu carro, ele aparecerá aqui.</div></div></div>`}
      <div class="card"><h2>Situação da garagem</h2>${garageStatusHtml(g)}</div>
      ${history.length ? `<div class="card"><h2>Últimas saídas</h2><ul class="list">${history.map((v) => `
        <li><div class="grow"><span class="plate">${esc(v.plate)}</span> <span class="meta">${esc(v.model || '')}</span>
        <div class="meta">Entrou ${esc(fmtDate(v.entered_at))} · Saiu ${esc(fmtDate(v.exited_at))}</div></div></li>`).join('')}</ul></div>` : ''}`;
    return;
  }

  const q = new URLSearchParams();
  if (state.vehFilter !== 'todos') q.set('status', state.vehFilter);
  const { items } = await api('/vehicles?' + q);

  const controls = manage ? `
    <div class="card">
      <h2>Controles do manobrista</h2>
      <button class="toggle-big warn ${g.maneuvering ? 'on' : ''}" id="tg-man">
        <div><strong>${g.maneuvering ? '🔄 Manobrando agora' : 'Manobrando'}</strong><span class="small muted">${g.maneuvering ? 'Toque para encerrar a manobra' : 'Toque ao iniciar uma manobra — moradores verão que devem aguardar'}</span></div>
        <span class="switch"></span>
      </button>
      <button class="toggle-big danger ${g.full ? 'on' : 'ok-off'}" id="tg-full">
        <div><strong>${g.full ? '⛔ Garagem lotada' : '✅ Vagas disponíveis'}</strong><span class="small muted">Toque para marcar como ${g.full ? '"Vagas disponíveis"' : '"Garagem lotada"'}</span></div>
        <span class="switch"></span>
      </button>
    </div>
    <div class="card">
      <h2>Registrar entrada de veículo</h2>
      <form id="veh-form">
        <div class="form-row">
          <label class="field"><span>Apartamento *</span><input type="text" name="apartment" list="apts" required autocomplete="off"></label>
          <label class="field"><span>Placa *</span><input type="text" name="plate" required autocomplete="off" placeholder="ABC1D23" style="text-transform:uppercase"></label>
        </div>
        <div class="chips" id="known-plates"></div>
        <div class="form-row three">
          <label class="field"><span>Modelo</span><input type="text" name="model" placeholder="Ex.: Onix"></label>
          <label class="field"><span>Cor</span><input type="text" name="color" placeholder="Ex.: Prata"></label>
          <label class="field"><span>Vaga</span><input type="text" name="spot" placeholder="Ex.: 12"></label>
        </div>
        <button class="btn primary block">Registrar entrada</button>
      </form>
      ${aptDatalist()}
    </div>` : `<div class="card"><h2>Situação da garagem</h2>${garageStatusHtml(g)}</div>`;

  const list = items.length ? `<ul class="list">${items.map((v) => `
    <li data-search="${esc((v.apartment + ' ' + v.plate + ' ' + (v.model || '')).toUpperCase())}">
      <div class="icon">🚗</div>
      <div class="grow">
        <div class="title"><span class="plate">${esc(v.plate)}</span> · Apto ${esc(v.apartment)}
          ${v.status === 'estacionado' ? '<span class="chip ok">Estacionado</span>' : '<span class="chip">Saiu</span>'}</div>
        <div class="meta">${esc([v.model, v.color, v.spot && 'Vaga ' + v.spot].filter(Boolean).join(' · '))}</div>
        <div class="meta">Entrada ${esc(fmtDate(v.entered_at))}${v.entered_by_name ? ' por ' + esc(v.entered_by_name) : ''}
          ${v.exited_at ? ` · Saída ${esc(fmtDate(v.exited_at))}${v.exited_by_name ? ' por ' + esc(v.exited_by_name) : ''}` : ''}</div>
      </div>
      ${manage && v.status === 'estacionado' ? `<div class="actions"><button class="btn sm" data-exit="${v.id}">Saída</button></div>` : ''}
    </li>`).join('')}</ul>` : '<div class="empty">Nenhum veículo.</div>';

  main.innerHTML = `
    ${floodBanner()}
    <h1>Garagem</h1>
    ${manage ? `<div class="card"><h2>Situação atual</h2>${garageStatusHtml(g)}</div>` : ''}
    <div class="${manage ? '' : ''}">${controls}</div>
    <div class="card">
      <div class="section-title"><h2>Veículos</h2><span class="chip info">${state.status.parkedVehicles ?? 0} na garagem</span></div>
      <div class="segmented" id="veh-filter">
        <button data-f="estacionado" class="${state.vehFilter === 'estacionado' ? 'active' : ''}">Na garagem</button>
        <button data-f="saiu" class="${state.vehFilter === 'saiu' ? 'active' : ''}">Saíram</button>
        <button data-f="todos" class="${state.vehFilter === 'todos' ? 'active' : ''}">Todos</button>
      </div>
      <div class="toolbar"><input type="search" id="veh-search" placeholder="Buscar por apto, placa ou modelo…"></div>
      ${list}
    </div>`;

  $$('#veh-filter button').forEach((b) => b.addEventListener('click', () => { state.vehFilter = b.dataset.f; renderView(); }));
  $('#veh-search').addEventListener('input', (e) => {
    const v = e.target.value.trim().toUpperCase();
    $$('.list > li[data-search]').forEach((li) => { li.style.display = !v || li.dataset.search.includes(v) ? '' : 'none'; });
  });
  $$('[data-exit]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api(`/vehicles/${b.dataset.exit}/exit`, { method: 'POST' }); toast('Saída registrada.', 'success'); renderView(); } catch (e) { toast(e.message, 'error'); b.disabled = false; }
  }));

  if (manage) {
    const setStatus = async (body) => {
      try { await api('/garage/status', { method: 'PUT', body }); await renderView(); } catch (e) { toast(e.message, 'error'); }
    };
    $('#tg-man').addEventListener('click', () => setStatus({ maneuvering: !g.maneuvering }));
    $('#tg-full').addEventListener('click', () => setStatus({ full: !g.full }));

    const form = $('#veh-form');
    let t = null;
    form.apartment.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const apt = form.apartment.value.trim();
        const box = $('#known-plates');
        if (!apt) { box.innerHTML = ''; return; }
        const { items: known } = await api('/vehicles/known?apartment=' + encodeURIComponent(apt)).catch(() => ({ items: [] }));
        box.innerHTML = known.map((k, i) => `<button type="button" class="chip" data-k="${i}">${esc(k.plate)}${k.model ? ' · ' + esc(k.model) : ''}</button>`).join('');
        $$('[data-k]', box).forEach((c) => c.addEventListener('click', () => {
          const k = known[c.dataset.k];
          form.plate.value = k.plate; form.model.value = k.model || ''; form.color.value = k.color || '';
          form.spot.focus();
        }));
      }, 300);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button.primary', form); btn.disabled = true;
      try {
        await api('/vehicles', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        toast('Entrada registrada.', 'success');
        form.reset();
        renderView();
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    });
  }
}

// ====================== Notificações ======================
async function notificationsView(main) {
  const { items } = await api('/notifications');
  main.innerHTML = `
    ${floodBanner()}
    <h1>Notificações</h1>
    <div class="card">
      ${items.length ? `<ul class="list">${items.map((n) => `
        <li class="notif-item ${n.read_at ? '' : 'unread'}">
          <div class="grow">
            <div class="title">${esc(n.title)}</div>
            <div style="white-space:pre-line">${esc(n.body)}</div>
            <div class="meta">${esc(fmtDate(n.created_at))}</div>
          </div>
          ${n.url && n.url !== '/' ? `<div class="actions"><a class="btn sm" href="${esc(n.url)}">Abrir</a></div>` : ''}
        </li>`).join('')}</ul>` : '<div class="empty">Nenhuma notificação ainda.</div>'}
    </div>`;
  if (items.some((n) => !n.read_at)) {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    state.unread = 0;
    renderChrome();
  }
}

// ====================== Perfil ======================
async function profileView(main) {
  const u = state.user;
  const ps = await pushState().catch(() => 'unsupported');
  const pushHtml = {
    on: `<div class="callout"><span>🔔</span><div class="grow"><strong>Ativas neste aparelho</strong></div><button class="btn sm" id="push-off">Desativar</button></div>`,
    off: `<div class="callout warn"><span>🔕</span><div class="grow"><strong>Desativadas neste aparelho</strong></div><button class="btn primary sm" id="push-on">Ativar</button></div>`,
    denied: `<div class="callout warn"><span>🔕</span><div class="grow"><strong>Bloqueadas pelo navegador</strong><div class="small">Libere as notificações deste site nas configurações do navegador/celular e recarregue a página.</div></div></div>`,
    'ios-install': `<div class="callout warn"><span>📲</span><div class="grow"><strong>Instale o app primeiro</strong><div class="small">No iPhone/iPad (iOS 16.4 ou superior), abra este site no Safari, toque em <b>Compartilhar</b> ⬆️ → <b>Adicionar à Tela de Início</b>. Depois abra o app pelo ícone e ative aqui.</div></div></div>`,
    unsupported: `<div class="callout warn"><span>⚠️</span><div class="grow">Este navegador não suporta notificações push. Use o Chrome (Android) ou instale o app na tela de início (iPhone).</div></div>`,
  }[ps];

  main.innerHTML = `
    ${floodBanner()}
    <h1>Meu perfil</h1>
    <div class="grid grid-2">
      <div class="card">
        <h2>Dados</h2>
        <form id="profile-form">
          <label class="field"><span>Nome</span><input type="text" name="name" value="${esc(u.name)}" required></label>
          <label class="field"><span>Celular</span><input type="tel" name="phone" value="${esc(u.phone || '')}"></label>
          <label class="field"><span>E-mail</span><input type="email" value="${esc(u.email)}" disabled></label>
          <label class="field"><span>Apartamento</span><input type="text" value="${esc(u.apartment || '—')}" disabled></label>
          <button class="btn primary">Salvar</button>
        </form>
      </div>
      <div>
        <div class="card">
          <h2>Notificações</h2>
          <h3>No celular (push)</h3>
          ${pushHtml}
          <h3>Por e-mail</h3>
          <button class="toggle-big ${u.emailNotify ? 'on warn' : ''}" id="email-toggle" style="${u.emailNotify ? 'border-color:var(--ok);background:var(--ok-soft)' : ''}">
            <div><strong>${u.emailNotify ? 'Receber e-mails' : 'E-mails desativados'}</strong><span class="small muted">Encomendas e alertas de alagamento em ${esc(u.email)}</span></div>
            <span class="switch" style="${u.emailNotify ? 'background:var(--ok)' : ''}"></span>
          </button>
        </div>
        <div class="card">
          <h2>Alterar senha</h2>
          <form id="pw-form">
            <label class="field"><span>Senha atual</span><input type="password" name="currentPassword" autocomplete="current-password" required></label>
            <label class="field"><span>Nova senha</span><input type="password" name="newPassword" autocomplete="new-password" minlength="6" required></label>
            <button class="btn">Alterar senha</button>
          </form>
        </div>
        <button class="btn danger block" id="logout">Sair</button>
      </div>
    </div>`;

  $('#push-on')?.addEventListener('click', async () => { await enablePush(); renderView(); });
  $('#push-off')?.addEventListener('click', async () => { await disablePush(); renderView(); });
  $('#email-toggle').addEventListener('click', async () => {
    try { state.user = (await api('/me', { method: 'PATCH', body: { emailNotify: !u.emailNotify } })).user; renderView(); } catch (e) { toast(e.message, 'error'); }
  });
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { state.user = (await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) })).user; toast('Dados salvos.', 'success'); render(); } catch (err) { toast(err.message, 'error'); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); toast('Senha alterada.', 'success'); e.target.reset(); } catch (err) { toast(err.message, 'error'); }
  });
  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    location.hash = '';
    render();
  });
}

// ====================== Administração ======================
function userFormHtml(u = {}) {
  const roles = state.config.roles;
  return `
    <label class="field"><span>Nome *</span><input type="text" name="name" value="${esc(u.name || '')}" required></label>
    <label class="field"><span>E-mail *</span><input type="email" name="email" value="${esc(u.email || '')}" required></label>
    <div class="form-row">
      <label class="field"><span>Perfil *</span><select name="role">${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${(u.role || 'morador') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label class="field"><span>Apartamento</span><input type="text" name="apartment" value="${esc(u.apartment || '')}"></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Celular</span><input type="tel" name="phone" value="${esc(u.phone || '')}"></label>
      <label class="field"><span>Situação</span><select name="status">
        ${['ativo', 'pendente', 'inativo'].map((s) => `<option value="${s}" ${(u.status || 'ativo') === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}
      </select></label>
    </div>
    <label class="field"><span>${u.id ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial *'}</span>
      <input type="text" name="password" minlength="6" ${u.id ? '' : 'required'} autocomplete="off"></label>`;
}

async function adminView(main) {
  const [{ items: users }, { items: floods }] = await Promise.all([api('/users'), api('/flood/history')]);
  const pending = users.filter((u) => u.status === 'pendente');
  const others = users.filter((u) => u.status !== 'pendente');
  const roleChip = (u) => `<span class="chip ${u.role === 'morador' ? '' : 'info'}">${esc(u.roleLabel)}</span>`;

  main.innerHTML = `
    ${floodBanner()}
    <h1>Administração</h1>
    ${pending.length ? `
      <div class="card">
        <h2>Cadastros aguardando aprovação (${pending.length})</h2>
        <ul class="list">${pending.map((u) => `
          <li><div class="grow"><div class="title">${esc(u.name)} · Apto ${esc(u.apartment || '—')}</div>
            <div class="meta">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''} · ${esc(fmtDate(u.createdAt))}</div></div>
            <div class="actions"><button class="btn ok sm" data-approve="${u.id}">Aprovar</button><button class="btn sm" data-reject="${u.id}">Recusar</button></div></li>`).join('')}
        </ul>
      </div>` : ''}
    <div class="card">
      <div class="section-title"><h2>Usuários (${others.length})</h2><button class="btn primary sm" id="new-user">+ Novo usuário</button></div>
      <div class="toolbar"><input type="search" id="user-search" placeholder="Buscar por nome, e-mail ou apartamento…"></div>
      <ul class="list">${others.map((u) => `
        <li data-search="${esc((u.name + ' ' + u.email + ' ' + (u.apartment || '')).toUpperCase())}">
          <div class="grow">
            <div class="title">${esc(u.name)} ${roleChip(u)} ${u.status === 'inativo' ? '<span class="chip danger">Inativo</span>' : ''}</div>
            <div class="meta">${u.apartment ? 'Apto ' + esc(u.apartment) + ' · ' : ''}${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div>
            <div class="meta">${u.devices ? `🔔 ${u.devices} aparelho(s) com notificação` : '🔕 Sem notificação no celular'}</div>
          </div>
          <div class="actions"><button class="btn sm" data-edit="${u.id}">Editar</button></div>
        </li>`).join('')}</ul>
    </div>
    <div class="card">
      <h2>Histórico de alertas de alagamento</h2>
      ${floods.length ? `<ul class="list">${floods.map((f) => `
        <li><div class="grow"><div class="title">${f.deactivated_at ? '' : '<span class="chip danger">Ativo</span> '}${esc(fmtDate(f.activated_at))} – ${esc(f.activated_by_name || '—')}</div>
          ${f.message ? `<div class="meta">${esc(f.message)}</div>` : ''}
          ${f.deactivated_at ? `<div class="meta">Encerrado ${esc(fmtDate(f.deactivated_at))} por ${esc(f.deactivated_by_name || '—')}</div>` : ''}</div></li>`).join('')}</ul>`
        : '<div class="empty">Nenhum alerta registrado.</div>'}
    </div>`;

  $('#user-search').addEventListener('input', (e) => {
    const v = e.target.value.trim().toUpperCase();
    $$('.list > li[data-search]').forEach((li) => { li.style.display = !v || li.dataset.search.includes(v) ? '' : 'none'; });
  });
  $$('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/users/${b.dataset.approve}`, { method: 'PATCH', body: { status: 'ativo' } }); toast('Cadastro aprovado. O morador foi avisado por e-mail.', 'success'); refreshApts(); renderView(); } catch (e) { toast(e.message, 'error'); }
  }));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', async () => {
    if (!await modal({ title: 'Recusar cadastro?', html: '<p>O cadastro será excluído.</p>', confirm: 'Recusar', danger: true })) return;
    try { await api(`/users/${b.dataset.reject}`, { method: 'DELETE' }); renderView(); } catch (e) { toast(e.message, 'error'); }
  }));
  $('#new-user').addEventListener('click', async () => {
    const r = await modal({ title: 'Novo usuário', html: userFormHtml(), confirm: 'Criar' });
    if (!r) return;
    try { await api('/users', { method: 'POST', body: r }); toast('Usuário criado.', 'success'); refreshApts(); renderView(); } catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const u = users.find((x) => String(x.id) === b.dataset.edit);
    const dlg = $('#dialog');
    const p = modal({ title: 'Editar usuário', html: userFormHtml(u) + (u.id !== state.user.id ? '<button type="button" class="btn danger sm" id="del-user">Excluir usuário</button>' : ''), confirm: 'Salvar' });
    $('#del-user', dlg)?.addEventListener('click', async () => {
      dlg.close();
      if (!await modal({ title: `Excluir ${u.name}?`, html: '<p>Essa ação não pode ser desfeita.</p>', confirm: 'Excluir', danger: true })) return;
      try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('Usuário excluído.'); refreshApts(); renderView(); } catch (e) { toast(e.message, 'error'); }
    });
    const r = await p;
    if (!r) return;
    if (!r.password) delete r.password;
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: r }); toast('Usuário atualizado.', 'success'); refreshApts(); renderView(); } catch (e) { toast(e.message, 'error'); }
  }));
}

function refreshApts() { api('/apartments').then((r) => { state.apartments = r.items; }).catch(() => {}); }

// ====================== Inicialização ======================
(async function init() {
  try {
    const [config, me] = await Promise.all([api('/config'), api('/me')]);
    state.config = config;
    state.user = me.user;
    if (state.user) await afterLogin(); else render();
  } catch (e) {
    $('#root').innerHTML = `<div class="loading">Não foi possível conectar ao servidor.<br><button class="btn" onclick="location.reload()">Tentar novamente</button></div>`;
  }
})();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.user) refreshFor('notifications');
});
