import { chromium } from './node_modules/playwright/index.mjs';
import { loginAsRectoria, openPlantillas, shot } from './liblogin.mjs';
import { openAjustes, clickSettingsTab, clickPush, syncResultMessage, activeTemplateLS, readLS } from './libapp.mjs';
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const browser = await chromium.launch({ headless:true });
const { ctx, page } = await loginAsRectoria(browser);

await openPlantillas(page);
const before = await activeTemplateLS(page);
console.log('PLANTILLA ACTIVA (antes):', before);

// Aplicar Plantilla T vía page.evaluate (robusto)
const applied = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  for (const btn of btns) {
    if (btn.textContent.trim() === 'Aplicar hoy') {
      const card = btn.closest('div[class*="rounded-2xl"]');
      if (card && card.querySelector('h4')?.textContent.includes('Jornada de Pruebas')) {
        btn.click();
        return 'clicked_T';
      }
    }
  }
  return 'NOT_FOUND';
});
console.log('apply evaluate:', applied);
await wait(1000);
const after = await activeTemplateLS(page);
console.log('PLANTILLA ACTIVA (después):', after);
const slots = await readLS(page, 'inas_schedule_slots_v5');
console.log('SLOTS:', Array.isArray(slots) ? slots.length : (slots?JSON.stringify(slots).slice(0,60):'null'));
await shot(page, 'r54_T01_plantillaT_aplicada');
await page.locator('text="Plantilla \\"Plantilla T: Jornada de Pruebas\\" aplicada"').first().waitFor({timeout:4000}).catch(()=>console.log('(toast no captado)'));

// Abrir Ajustes → Sync → Push
await openAjustes(page);
await clickSettingsTab(page, 'Sync y Seguridad');
await shot(page, 'r54_T01_ajax_sync');
await clickPush(page);
await wait(2500);
const msg = await syncResultMessage(page);
console.log('RESULTADO PUSH:', JSON.stringify(msg).slice(0,300));
await shot(page, 'r54_T01_push_result');

console.log('=== VEREDICTO T01 ===');
console.log('T aplicada localmente:', after === 'tmpl-pruebas-extendida' ? 'PASS' : 'FAIL('+after+')');
console.log('PUSH:', msg ? ('INFORMATIVO: '+msg.slice(0,140)) : 'sin mensaje');
await browser.close();
