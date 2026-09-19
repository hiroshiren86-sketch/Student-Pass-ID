/**
 * Generador del PDF del guion de presentación (INAS — prototipo final, Ronda 69).
 * ---------------------------------------------------------------------------
 * Uso:  node scripts/gen_guion_pdf.mjs GUION-PRESENTACION-INAS.md GUION-PRESENTACION-INAS.pdf
 *
 * Convierte un subconjunto de Markdown (títulos #/##/###, negrita, listas -/1.,
 * reglas ---, citas >) a un PDF con pdfmake (Roboto, alfabeto latino completo).
 * No forma parte de las suites de verificación del sistema: es una utilidad de
 * documentación. pdfmake se instala con `npm i --no-save pdfmake`.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

// pdfmake 0.3.x es CommonJS (module.exports = instancia única).
const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('Uso: node scripts/gen_guion_pdf.mjs <entrada.md> <salida.pdf>');
  process.exit(1);
}

const md = fs.readFileSync(inFile, 'utf8').replace(/\r\n/g, '\n');

/** Limpia caracteres que Roboto no trae (por si el markdown trae iconos). */
const sanitize = (s) => s
  .replace(/[\u2700-\u27BF\u2B00-\u2BFF\uFE0F]/g, '')      // dingbats / flechas decorativas
  .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')                   // emojis
  .replace(/\u00A0/g, ' ')
  .replace(/ {2,}/g, ' ');

/** Markdown en línea -> arreglo de textos pdfmake. */
function inline(text) {
  const clean = sanitize(text.replace(/`/g, ''));
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) parts.push({ text: clean.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith('**')) parts.push({ text: token.slice(2, -2), bold: true });
    else parts.push({ text: token.slice(1, -1), italics: true });
    last = m.index + token.length;
  }
  if (last < clean.length) parts.push({ text: clean.slice(last) });
  return parts.filter(p => p.text !== '');
}

const doc = { content: [], styles: {} };
const COLORS = { ink: '#1e293b', accent: '#4338ca', muted: '#64748b' };

const lines = md.split('\n');
let pendingList = null; // { type: 'ul' | 'ol', items: [] }
let pendingQuote = null;

function flushList() {
  if (!pendingList) return;
  doc.content.push({
    [pendingList.type === 'ul' ? 'ul' : 'ol']: pendingList.items,
    margin: pendingList.type === 'ul' ? [6, 0, 0, 8] : [6, 0, 0, 8],
    markerColor: COLORS.accent,
    lineHeight: 1.25
  });
  pendingList = null;
}

function flushQuote() {
  if (!pendingQuote) return;
  doc.content.push({
    table: { widths: ['*'], body: [[{ stack: pendingQuote, margin: [8, 4, 4, 4] }]] },
    layout: {
      hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0),
      vLineColor: () => COLORS.accent, paddingLeft: () => 12, paddingRight: () => 6
    },
    fillColor: '#f8fafc',
    margin: [0, 0, 0, 10]
  });
  pendingQuote = null;
}

for (const raw of lines) {
  const line = raw.trimEnd();

  if (line.trim() === '') { flushList(); flushQuote(); continue; }
  if (/^-{3,}$/.test(line.trim())) {
    flushList(); flushQuote();
    doc.content.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#e2e8f0' }],
      margin: [0, 6, 0, 10]
    });
    continue;
  }

  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    flushList(); flushQuote();
    const level = h[1].length;
    const text = sanitize(h[2]);
    if (level === 1) doc.content.push({ text, style: 'h1', pageBreak: doc.content.length ? 'before' : undefined });
    else if (level === 2) doc.content.push({ text, style: 'h2' });
    else if (level === 3) doc.content.push({ text, style: 'h3' });
    else doc.content.push({ text, style: 'h4' });
    continue;
  }

  if (/^>\s?/.test(line)) {
    flushList();
    if (!pendingQuote) pendingQuote = [];
    pendingQuote.push({ text: inline(line.replace(/^>\s?/, '')), fontSize: 10, color: COLORS.ink, lineHeight: 1.3 });
    continue;
  }
  flushQuote();

  const ul = /^[-*]\s+(.*)$/.exec(line.trim());
  if (ul) {
    if (!pendingList || pendingList.type !== 'ul') { flushList(); pendingList = { type: 'ul', items: [] }; }
    pendingList.items.push({ text: inline(ul[1]), fontSize: 10.5, lineHeight: 1.3, margin: [0, 1, 0, 1] });
    continue;
  }
  const ol = /^(\d+)\.\s+(.*)$/.exec(line.trim());
  if (ol) {
    if (!pendingList || pendingList.type !== 'ol') { flushList(); pendingList = { type: 'ol', items: [] }; }
    pendingList.items.push({ text: inline(ol[2]), fontSize: 10.5, lineHeight: 1.3, margin: [0, 1, 0, 1] });
    continue;
  }
  flushList();

  doc.content.push({ text: inline(line.trim()), style: 'p' });
}
flushList(); flushQuote();

doc.styles = {
  h1: { fontSize: 21, bold: true, color: COLORS.accent, margin: [0, 0, 0, 2], lineHeight: 1.1 },
  h2: { fontSize: 14.5, bold: true, color: COLORS.accent, margin: [0, 16, 0, 6] },
  h3: { fontSize: 12, bold: true, color: COLORS.ink, margin: [0, 12, 0, 4] },
  h4: { fontSize: 11, bold: true, color: COLORS.muted, margin: [0, 10, 0, 3] },
  p: { fontSize: 10.5, color: COLORS.ink, lineHeight: 1.35, margin: [0, 0, 0, 9], alignment: 'justify' }
};

doc.pageSize = 'A4';
doc.pageMargins = [56, 54, 56, 58];
doc.defaultStyle = { fontSize: 10.5 };
doc.info = {
  title: 'Guion para presentar el sistema INAS (prototipo final)',
  author: 'Institución Educativa Antonia Santos (I.N.A.S) — proyecto Student-Pass-ID',
  subject: 'Guion de demostración del sistema de control de asistencia escolar con carné digital'
};
doc.footer = (currentPage, pageCount) => ({
  margin: [56, 18, 56, 0],
  columns: [
    { text: 'INAS — Guion de presentación (versión final)', fontSize: 8, color: COLORS.muted },
    { text: `Página ${currentPage} de ${pageCount}`, fontSize: 8, color: COLORS.muted, alignment: 'right' }
  ]
});

pdfmake.setFonts({
  Roboto: {
    normal: 'node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf',
    bold: 'node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf',
    italics: 'node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics: 'node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf'
  }
});
pdfmake.setLocalAccessPolicy(() => true);   // solo se leen las fuentes locales de pdfmake
pdfmake.setUrlAccessPolicy(() => false);    // sin descargas externas

const pdf = pdfmake.createPdf(doc);
await pdf.write(outFile);
console.log(`PDF escrito: ${outFile} (${fs.statSync(outFile).size} bytes)`);
