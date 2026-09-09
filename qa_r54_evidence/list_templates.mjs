import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot } from './liblogin.mjs';

const browser = await chromium.launch({ headless: true });
const { ctx, page } = await loginAsRectoria(browser);
await openPlantillas(page);
await shot(page, 'plantillas');

// leer tarjetas de plantilla
const cards = await page.locator('h4.text-xs.font-black').all().catch(()=>[]);
const names = [];
for (const c of cards) { const t = await c.innerText().catch(()=>''); if (t.trim()) names.push(t.trim()); }
console.log('=== Nombres de plantillas (h4) ===\n', JSON.stringify(names, null, 0));

// leer toda la sección de plantillas
const bodyText = await page.locator('body').innerText();
console.log('=== Contiene "Jornada de Pruebas":', bodyText.includes('Jornada de Pruebas'));
console.log('=== Contiene "tmpl-pruebas":', bodyText.includes('tmpl-pruebas'));
console.log('=== Contiene "Plantillas de Jornada":', bodyText.includes('Plantillas de Jornada'));
// extraer líneas relevantes
const lines = bodyText.split('\n').filter(l => /Jornada|Plantilla|bloque|Fin|Inicio|Aplica|CUSTOM|OFICIAL|Pruebas|00:05|23:05/.test(l));
console.log('=== Líneas relevantes ===');
console.log(lines.slice(0, 60).join('\n'));
await browser.close();
