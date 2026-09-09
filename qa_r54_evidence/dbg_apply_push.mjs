import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot, ensureNoOverlay } from './liblogin.mjs';
import { activeTemplateLS, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>console.log(...a);
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
await openPlantillas(page);
// apply T
await page.evaluate(()=>{for(const btn of Array.from(document.querySelectorAll('button'))) if(btn.textContent.trim()==='Aplicar hoy'){const card=btn.closest('div[class*="rounded-2xl"]'); if(card&&card.querySelector('h4')?.textContent.includes('Jornada de Pruebas')){btn.click();return;}}});
await wait(1000);
log('after apply:', await activeTemplateLS(page));

// openAjustes manual, verbose
await ensureNoOverlay(page); // import below
await page.click('button[title*="Menú de Usuario"]', {force:true}).catch(e=>log('click usermenu fail', e.message.slice(0,60)));
await wait(600);
log('usermenu clicked, now find Configuración');
const b = page.locator('button:has-text("Configuración & Motores IA")').first();
log('Configuración visible?', await b.isVisible({timeout:2500}).catch(()=>false));
await b.click({force:true}).catch(e=>log('click config fail', e.message.slice(0,60)));
await wait(900);
log('modal abierta?', await page.locator('#btn-close-settings').isVisible({timeout:2500}).catch(()=>false));
await shot(page,'dbg_apply_modal');
log('buttons:', JSON.stringify((await page.locator('button').allInnerTexts().catch(()=>[])).filter(t=>/Sync|Seguridad|Sincroniz|Descargar|Probar/i.test(t))));
await browser.close();
