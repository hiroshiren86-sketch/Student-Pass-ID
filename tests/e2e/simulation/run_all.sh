#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# R69 · Simulación E2E "Mini Colegio" — corredor completo
# ══════════════════════════════════════════════════════════════════════════
# Ejecuta los 6 guiones Playwright en orden y deja la evidencia en
# tests/evidence/e2e_<guion>_<timestamp>/ (capturas + reporte JSON/TXT).
#
# Requisitos (entorno del propietario/QA — NO el sandbox de CI):
#   · Node 18+ y Playwright con Chromium:
#       npm i -D playwright && npx playwright install chromium
#   · Opcional (para decodificar el PNG del QR en el paso 04):
#       npm i -D jsqr pngjs
#   · tests/e2e/simulation/.env completo (ver .env.example) con credenciales
#     REALES. Nunca commitee el .env (Regla 9 de AGENTS.md).
#
# Uso:
#   bash tests/e2e/simulation/run_all.sh            # los 6 guiones
#   bash tests/e2e/simulation/run_all.sh 01 04      # sólo los guiones 01 y 04
#   HEADLESS=false SLOWMO_MS=120 bash tests/e2e/simulation/run_all.sh   # visible
set -uo pipefail
cd "$(dirname "$0")"

SELECT="${*:-01 02 03 04 05 06}"
FAIL=0
for n in $SELECT; do
  SCRIPT=$(ls ${n}_*.mjs 2>/dev/null | head -1)
  if [ -z "$SCRIPT" ]; then echo "⚠ no se encontró el guion $n"; FAIL=1; continue; fi
  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  ▶ $SCRIPT"
  echo "════════════════════════════════════════════════════════════"
  node "$SCRIPT"
  RC=$?
  if [ $RC -ne 0 ]; then echo "  ✗ $SCRIPT terminó con código $RC"; FAIL=1; else echo "  ✓ $SCRIPT OK"; fi
done

echo ""
echo "════════════════════════════════════════════════════════════"
if [ $FAIL -eq 0 ]; then echo "  SIMULACIÓN E2E COMPLETA: todos los guiones en verde"; else echo "  SIMULACIÓN E2E: hay guiones con fallos (ver evidencia en tests/evidence/)"; fi
echo "════════════════════════════════════════════════════════════"
exit $FAIL
