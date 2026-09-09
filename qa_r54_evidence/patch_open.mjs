import fs from 'fs';
let s = fs.readFileSync('liblogin.mjs','utf8');
// reemplazar la función openPlantillas por la validada
const marker = 'export async function openPlantillas(page){';
const idx = s.indexOf(marker);
const endMarker = '\nexport {';
const endIdx = s.indexOf(endMarker, idx);
const newFn = `export async function openPlantillas(page){
  // tab Horarios Escolares (menú Módulos)
  const mod = page.locator('button:has-text("Módulos")').first();
  if (await mod.isVisible({ timeout:6000 }).catch(()=>false)) { await mod.click(); await page.waitForTimeout(500); }
  const item = page.locator('button:has-text("Horarios Escolares")').last();
  if (await item.isVisible({ timeout:4000 }).catch(()=>false)) { await item.click(); await page.waitForTimeout(1500); }
  await ensureNoOverlay(page);
  // menú de vista → Plantillas
  const vm = page.locator('button[aria-label^="Vista actual"]').first();
  if (await vm.isVisible({ timeout:6000 }).catch(()=>false)) { await vm.click(); await page.waitForTimeout(400); }
  const pl = page.locator('button:has-text("Plantillas")').last();
  if (await pl.isVisible({ timeout:4000 }).catch(()=>false)) { await pl.click(); await page.waitForTimeout(1200); }
  await ensureNoOverlay(page);
  return page;
}
`;
s = s.slice(0, idx) + newFn + s.slice(endIdx);
fs.writeFileSync('liblogin.mjs', s);
console.log('openPlantillas actualizado');
