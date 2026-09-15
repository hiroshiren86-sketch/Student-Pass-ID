/**
 * R69 · E2E "Mini Colegio" — reportero de evidencia.
 * Imprime en consola y escribe un JSON + un TXT por corrida en tests/evidence/,
 * para que el resultado quede versionado y auditable (mismo espíritu que las
 * QA de R54-R58).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, REPO_ROOT } from './env.mjs';

export function evidenceDirFor(scriptName) {
  if (env.evidenceDir) {
    const d = resolve(env.evidenceDir);
    mkdirSync(d, { recursive: true });
    return d;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const d = resolve(REPO_ROOT, 'tests/evidence', `e2e_${scriptName}_${stamp}`);
  mkdirSync(d, { recursive: true });
  return d;
}

export class Reporter {
  constructor(scriptName, meta = {}) {
    this.scriptName = scriptName;
    this.meta = meta;
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.results = [];
    this.evidenceDir = evidenceDirFor(scriptName);
    console.log(`\n═══ R69 E2E · ${scriptName} ═══`);
    console.log(`  evidencia: ${this.evidenceDir}`);
    console.log(`  app: ${env.baseUrl}`);
    if (env.loadedFrom) console.log(`  env: ${env.loadedFrom}`);
  }

  section(title) {
    console.log(`\n━━━ ${title} ━━━`);
    this.results.push({ type: 'section', title });
  }

  check(name, cond, extra = '') {
    const ok = !!cond;
    if (ok) { this.passed++; console.log(`  ✓ ${name}`); }
    else { this.failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
    this.results.push({ type: 'check', name, ok, extra: extra || undefined });
    return ok;
  }

  skip(name, why) {
    this.skipped++;
    console.log(`  ○ ${name} — SKIP: ${why}`);
    this.results.push({ type: 'skip', name, why });
  }

  note(text) {
    console.log(`  · ${text}`);
    this.results.push({ type: 'note', text });
  }

  /** Cierra la corrida escribiendo la evidencia y devuelve el código de salida. */
  finish(exitCodeOverride) {
    const summary = {
      script: this.scriptName,
      ranAt: new Date().toISOString(),
      baseUrl: env.baseUrl,
      workerUrl: env.workerUrl || null,
      meta: this.meta,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped,
      results: this.results,
    };
    const base = resolve(this.evidenceDir, this.scriptName);
    writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2), 'utf8');
    const txt = [
      `R69 E2E · ${this.scriptName}`,
      `fecha      : ${summary.ranAt}`,
      `app        : ${env.baseUrl}`,
      `worker     : ${env.workerUrl || '(sin configurar)'}`,
      `resultado  : ${this.passed} OK · ${this.failed} FALLO · ${this.skipped} SKIP`,
      '',
      ...this.results.map(r => {
        if (r.type === 'section') return `\n── ${r.title} ──`;
        if (r.type === 'note') return `   · ${r.text}`;
        if (r.type === 'skip') return `   ○ ${r.name} — SKIP: ${r.why}`;
        return `   ${r.ok ? '✓' : '✗'} ${r.name}${r.extra ? ` — ${r.extra}` : ''}`;
      }),
    ].join('\n');
    writeFileSync(`${base}.txt`, txt, 'utf8');

    console.log('\n══════════════════════════════════════');
    console.log(`  ${this.scriptName}: ${this.passed} OK · ${this.failed} FALLO · ${this.skipped} SKIP`);
    console.log(`  evidencia: ${base}.json`);
    console.log('══════════════════════════════════════');
    const code = exitCodeOverride !== undefined ? exitCodeOverride : (this.failed === 0 ? 0 : 1);
    process.exitCode = code;
    return code;
  }
}
