import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, ensureNoOverlay, shot } from './liblogin.mjs';

const browser = await chromium.launch({ headless: true });
const { ctx, page } = await loginAsRectoria(browser);

// Paso 1: abrir menú Módulos
const mod = page.locator('button:has-text("Módulos")').first();
if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await page.waitForTimeout(500); }
await shot(page, 'modulos');
let body = await page.locator('body').innerText();
console.log('=== Tras Módulos: tengo "Horarios Escolares"?', body.includes('Horarios Escolares'));

// Paso 2: click en Horarios Escolares (item del dropdown)
const item = page.locator('button:has-text("Horarios Escolares")').last();
if (await item.isVisible({ timeout:4000 }).catch(()=>false)) { await item.click(); await page.waitForTimeout(1500); }
await ensureNoOverlay(page);
await shot(page, 'horarios');
body = await page.locator('body').innerText();
console.log('=== Tras Horarios: tengo "Vista actual"?', body.includes('Vista actual'), '| "Por Día"?', body.includes('Por Día'));

// Paso 3: abrir menú de vista y elegir Plantillas
const vm = page.locator('button[aria-label^="Vista actual"]').first();
if (await vm.isVisible({ timeout:6000 }).catch(()=>false)) { await vm.click(); await page.waitForTimeout(400); }
const pl = page.locator('button:has-text("Plantillas")').last();
if (await pl.isVisible({ timeout:4000 }).catch(()=>false)) { await pl.click(); await page.waitForTimeout(1200); }
await ensureNoOverlay(page);
await shot(page, 'plantillas');
body = await page.locator('body').innerText();
console.log('=== Tras Plantillas: tengo "Plantillas de Jornada"?', body.includes('Plantillas de Jornada'));
console.log('=== ---- LÍNEAS RELEVANTES ----');
console.log(body.split('\n').filter(l=>/Jornada|Plantilla|bloque|Fin|Inicio|Aplicar|CUSTOM|OFICIAL|Pruebas|00:05|23:05|Activa/.test(l)).slice(0,70).join('\n'));
await browser.close();
