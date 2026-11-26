'use strict';
// Testes de ponta a ponta da API (banco em memória).
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@teste.com';
process.env.ADMIN_PASSWORD = 'senha123';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/index.js');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); }); }));
after(() => { server.closeAllConnections(); server.close(); });

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, csrf = true } = {}) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Requested-With': 'enseada' } : {}), cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const admin = client();
const porteiro = client();
const manobrista = client();
const morador = client();
const vizinho = client();

test('login do admin e criação de usuários', async () => {
  assert.equal((await admin('/auth/login', { method: 'POST', body: { email: 'admin@teste.com', password: 'errada' } })).status, 401);
  const r = await admin('/auth/login', { method: 'POST', body: { email: 'admin@teste.com', password: 'senha123' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  for (const [name, email, role, apartment] of [
    ['Porteiro', 'p@t.com', 'porteiro', null],
    ['Manobrista', 'm@t.com', 'manobrista', null],
    ['Vizinho', 'v@t.com', 'morador', '202'],
  ]) {
    const c = await admin('/users', { method: 'POST', body: { name, email, role, apartment, password: '123456' } });
    assert.equal(c.status, 200, JSON.stringify(c.data));
  }
  await porteiro('/auth/login', { method: 'POST', body: { email: 'p@t.com', password: '123456' } });
  await manobrista('/auth/login', { method: 'POST', body: { email: 'm@t.com', password: '123456' } });
  await vizinho('/auth/login', { method: 'POST', body: { email: 'v@t.com', password: '123456' } });
});

test('proteção CSRF exige cabeçalho', async () => {
  const r = await admin('/flood/activate', { method: 'POST', csrf: false });
  assert.equal(r.status, 403);
});

test('auto-cadastro fica pendente até aprovação', async () => {
  const r = await morador('/auth/register', { method: 'POST', body: { name: 'Maria', email: 'maria@t.com', apartment: ' 101 ', password: '123456' } });
  assert.equal(r.status, 200);
  const l = await morador('/auth/login', { method: 'POST', body: { email: 'maria@t.com', password: '123456' } });
  assert.equal(l.status, 403);
  const users = (await admin('/users')).data.items;
  const maria = users.find((u) => u.email === 'maria@t.com');
  assert.equal(maria.status, 'pendente');
  assert.equal(maria.apartment, '101');
  assert.equal((await admin(`/users/${maria.id}`, { method: 'PATCH', body: { status: 'ativo' } })).status, 200);
  assert.equal((await morador('/auth/login', { method: 'POST', body: { email: 'maria@t.com', password: '123456' } })).status, 200);
});

test('alerta de alagamento: só funcionários acionam e todos são notificados', async () => {
  assert.equal((await morador('/flood/activate', { method: 'POST' })).status, 403);
  const r = await manobrista('/flood/activate', { method: 'POST', body: { message: 'Água subindo' } });
  assert.equal(r.status, 200);
  assert.equal((await manobrista('/flood/activate', { method: 'POST' })).status, 400);
  await new Promise((res) => setTimeout(res, 50));
  const st = (await morador('/status')).data;
  assert.equal(st.flood.message, 'Água subindo');
  const n = (await morador('/notifications')).data;
  assert.ok(n.items.some((x) => x.type === 'alagamento'));
  assert.equal((await porteiro('/flood/deactivate', { method: 'POST' })).status, 200);
  assert.equal((await morador('/status')).data.flood, null);
});

test('encomendas: porteiro registra, morador do apto é notificado e só vê as suas', async () => {
  assert.equal((await morador('/packages', { method: 'POST', body: { apartment: '101' } })).status, 403);
  const r = await porteiro('/packages', { method: 'POST', body: { apartment: '101', kind: 'pacote', sender: 'Correios' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.notified, 1);
  await porteiro('/packages', { method: 'POST', body: { apartment: '202', kind: 'correspondencia', quantity: 2 } });
  await new Promise((res) => setTimeout(res, 50));
  const mine = (await morador('/packages')).data.items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].apartment, '101');
  assert.ok((await morador('/notifications')).data.items.some((x) => x.type === 'encomenda'));
  assert.ok(!(await vizinho('/notifications')).data.items.some((x) => x.body.includes('101')));
  assert.equal((await porteiro('/packages')).data.items.length, 3);
  assert.equal((await porteiro(`/packages/${mine[0].id}/deliver`, { method: 'POST', body: { pickedUpBy: 'Maria' } })).status, 200);
  assert.equal((await morador('/packages?status=aguardando')).data.items.length, 0);
});

test('garagem: manobrista registra, morador só vê o próprio veículo', async () => {
  assert.equal((await porteiro('/vehicles', { method: 'POST', body: { apartment: '101', plate: 'ABC1D23' } })).status, 403);
  const a = await manobrista('/vehicles', { method: 'POST', body: { apartment: '101', plate: 'abc-1d23', model: 'Onix' } });
  assert.equal(a.status, 200);
  assert.equal((await manobrista('/vehicles', { method: 'POST', body: { apartment: '101', plate: 'ABC1D23' } })).status, 400);
  await manobrista('/vehicles', { method: 'POST', body: { apartment: '202', plate: 'XYZ9876' } });

  const mine = (await morador('/vehicles')).data.items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].plate, 'ABC1D23');
  assert.equal(mine[0].entered_by_name, undefined);
  assert.equal((await morador('/status')).data.myVehicles.length, 1);
  assert.equal((await porteiro('/vehicles?status=estacionado')).data.items.length, 2);
  assert.equal((await admin('/status')).data.parkedVehicles, 2);

  assert.equal((await manobrista(`/vehicles/${a.data.id}/exit`, { method: 'POST' })).status, 200);
  assert.equal((await morador('/status')).data.myVehicles.length, 0);
});

test('garagem: status de manobra e lotação', async () => {
  assert.equal((await morador('/garage/status', { method: 'PUT', body: { full: true } })).status, 403);
  await manobrista('/garage/status', { method: 'PUT', body: { maneuvering: true } });
  await manobrista('/garage/status', { method: 'PUT', body: { full: true } });
  const g = (await morador('/garage/status')).data;
  assert.equal(g.maneuvering, true);
  assert.equal(g.full, true);
  assert.ok(g.maneuveringSince);
  await manobrista('/garage/status', { method: 'PUT', body: { maneuvering: false } });
  assert.equal((await morador('/garage/status')).data.maneuvering, false);
});

test('morador não acessa administração', async () => {
  assert.equal((await morador('/users')).status, 403);
  assert.equal((await morador('/apartments')).status, 403);
});
