import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot, ensureNoOverlay } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPull, clickPush, closeSettingsModal, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const log=(...a)=>process.stdout.write(a.join(' ')+'\n');
const TEST='999999999';
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);
const pushes=[];
page.on('response', async (r)=>{ const u=r.url(); if(u.includes('/api/sync/push')){ try{pushes.push(await r.json().catch(()=>null));}catch{} } });

// 1) Pull + cerrar modal
let ok = await openAjustes(page);
if (ok) { await clickSettingsTab(page,'Sync y Seguridad'); await clickPull(page); await wait(2500); await closeSettingsModal(page); }

// 2) Ir a Directorio Estudiantes (Módulos dropdown)
await ensureNoOverlay(page);
await page.click('button:has-text("Módulos")',{force:true}).catch(()=>{});
await wait(500);
await page.locator('button:has-text("Directorio Estudiantes")').last().click({force:true}).catch(()=>{});
await wait(1200);
await ensureNoOverlay(page);
// leer número local de estudiantes
const stBefore = await readLS(page,'inas_students_v5');
log('estudiantes locales =', Array.isArray(stBefore)?stBefore.length:'?');

// 3) + Nuevo Estudiante
await page.locator('button:has-text("+ Nuevo Estudiante")').first().click({force:true}).catch(()=>{});
await wait(700);
await page.locator('input[placeholder="Ej: Santiago Andrés"]').fill('QA');
await page.locator('input[placeholder="Ej: Gómez Restrepo"]').fill('Prueba R54');
await page.locator('input[placeholder="Ej: 1025883921"]').fill(TEST);
await page.locator('input[placeholder="Ej: 6°5, 10°4, 11°3"]').fill('6°1');
await page.locator('input[type="checkbox"]').first().check({force:true}).catch(()=>{});
await page.locator('button[type="submit"]:has-text("Guardar y Generar")').click({force:true}).catch(()=>{});
await wait(1500);
const stAfter = await readLS(page,'inas_students_v5');
log('estudiantes locales tras alta =', Array.isArray(stAfter)?stAfter.length:'?');
log('existe '+TEST+'?', JSON.stringify(stAfter||[]).includes(TEST));
await shot(page,'r54_T05_alta');

// 4) Push #1 (test student a la nube)
ok = await openAjustes(page);
if (ok) { await clickSettingsTab(page,'Sync y Seguridad'); await clickPush(page); await wait(1500); }
await wait(1500);
log('PUSH#1 =', JSON.stringify(pushes[0]).slice(0,200));

// 5) Eliminar el estudiante de prueba
await closeSettingsModal(page).catch(()=>{});
await ensureNoOverlay(page);
// navegar de nuevo a Directorio si hace falta
if (!(await page.locator('button:has-text("+ Nuevo Estudiante")').first().isVisible({timeout:2500}).catch(()=>false))) {
  await page.click('button:has-text("Módulos")',{force:true}).catch(()=>{}); await wait(500);
  await page.locator('button:has-text("Directorio Estudiantes")').last().click({force:true}).catch(()=>{});
  await wait(1200);
}
const row = page.locator(`tr:has(td:has-text("${TEST}"))`).first();
log('fila del test visible?', await row.isVisible({timeout:4000}).catch(()=>false));
await row.locator('button[aria-label^="Acciones de"]').first().click({force:true}).catch(()=>{});
await wait(600);
await page.locator('button[role="menuitem"]:has-text("Eliminar")').first().click({force:true}).catch(()=>{});
await wait(700);
await page.locator('button:has-text("Sí, eliminar")').first().click({force:true}).catch(()=>{});
await wait(1200);
const tombs = await readLS(page,'inas_tombstones_v1');
log('TOMBSTONES en LS =', JSON.stringify(tombs||[]).slice(0,200));
log('tombstone de '+TEST+'?', (tombs||[]).some(t=>t.id===TEST||t.code===TEST));
await shot(page,'r54_T05_borrado');

// 6) Push #2 (con tombstone)
ok = await openAjustes(page);
if (ok) { await clickSettingsTab(page,'Sync y Seguridad'); await clickPush(page); await wait(1800); }
log('PUSH#2 =', JSON.stringify(pushes[1]).slice(0,200));
await browser.close();
log('DONE');
