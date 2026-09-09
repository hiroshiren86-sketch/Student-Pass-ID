import fs from 'fs';
let s = fs.readFileSync('libapp.mjs','utf8');
const newFn = `export async function closeSettingsModal(page) {
  for (let i=0;i<4;i++){
    await page.keyboard.press('Escape').catch(()=>{});
    await wait(500);
    const gone = !(await page.locator('#btn-close-settings').isVisible({ timeout:800 }).catch(()=>false));
    if (gone) return true;
  }
  // fallback: click close
  await page.locator('#btn-close-settings').click({ force:true }).catch(()=>{});
  await wait(700);
  const gone = !(await page.locator('#btn-close-settings').isVisible({ timeout:800 }).catch(()=>false));
  return gone;
}

`;
const idx = s.indexOf('export async function syncResultMessage');
s = newFn + s.slice(0,idx) + s.slice(idx);
fs.writeFileSync('libapp.mjs', s);
console.log('closeSettingsModal añadido');
