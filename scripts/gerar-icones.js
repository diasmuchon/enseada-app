// Gera os ícones PNG a partir dos SVGs (requer Playwright instalado). Uso: node scripts/gerar-icones.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const dir = path.join(__dirname, '..', 'public', 'icons');
const icon = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
const badge = fs.readFileSync(path.join(dir, 'badge.svg'), 'utf8');
const jobs = [
  ['icon-192.png', 192, icon, 'transparent', 1],
  ['icon-512.png', 512, icon, 'transparent', 1],
  ['apple-touch-icon.png', 180, icon.replace('rx="112"', 'rx="0"'), '#0b6e99', 1],
  ['icon-maskable-512.png', 512, icon.replace('rx="112"', 'rx="0"'), '#0b6e99', 0.8],
  ['badge-96.png', 96, badge, 'transparent', 1],
];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, svg, bg, scale] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * scale);
    await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
    await page.screenshot({ path: path.join(dir, name), omitBackground: bg === 'transparent' });
    console.log('ok', name);
  }
  await browser.close();
})();
