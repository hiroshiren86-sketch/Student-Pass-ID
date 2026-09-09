import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, shot } from './liblogin.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
// abrir Ajustes
await page.click('button[title*="Menú de Usuario"]'); await wait(500);
await shot(page, 'dbg_usermenu');
const b = page.locator('button:has-text("Configuración & Motores IA")').first();
console.log('botón Configuración visible?', await b.isVisible({timeout:3000}).catch(()=>false));
await b.click().catch(()=>{}); await wait(800);
// ¿modal abierta?
console.log('modal abierta (#btn-close-settings)?', await page.locator('#btn-close-settings').isVisible({timeout:3000}).catch(()=>false));
// dump pestañas
const tabs = await page.locator('button').allInnerTexts().catch(()=>[]);
console.log('TABS/BOTONES en el modal:', JSON.stringify(tabs.filter(t=>/Sync|Seguridad|Instit|IA|Sincroniz|Descargar|Probar/i.test(t))));
await browser.close();
