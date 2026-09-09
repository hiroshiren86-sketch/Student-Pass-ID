import fs from 'fs';
let s = fs.readFileSync('libapp.mjs','utf8');
const idx = s.indexOf('export async function syncResultMessage');
const end = s.indexOf('export async function activeTemplateLS');
const newFn = `export async function syncResultMessage(page) {
  const el = page.locator('div[class*="bg-emerald-50"], div[class*="bg-rose-50"]').last();
  try { return (await el.innerText()).trim(); } catch { return ''; }
}
`;
s = s.slice(0,idx) + newFn + s.slice(end);
fs.writeFileSync('libapp.mjs', s);
console.log('syncResultMessage actualizado (target bg-emerald/bg-rose)');
