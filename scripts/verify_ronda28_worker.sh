#!/usr/bin/env bash
# ==============================================================================
# Ronda 28 — Suite E2E del Worker: EXPORT y PURGA de la nube (wrangler dev LOCAL).
# Ejecutar: bash scripts/verify_ronda28_worker.sh   (desde la raíz del repo)
#
# Usa SOLO los simuladores locales de wrangler v4 (D1/KV en .wrangler/state) —
# jamás toca producción (lección H-1 de la Ronda 27). Dos corridas:
#   Corrida 1 (sin AUTH_TOKEN — modo abierto): ciclo completo export→seed→purga.
#   Corrida 2 (con AUTH_TOKEN en .dev.vars): 401 sin token / 200 con token /
#            rate limit de purga (429 en la 4.ª llamada de la hora).
# ==============================================================================
set -u
cd "$(dirname "$0")/../cloudflare-worker" || exit 1

PORT=8799
PORT2=8801
LOG="/tmp/wrangler28_dev.log"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
check() { # check <nombre> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (esperado=$2, obtenido=$3)"; fi
}

jget() { # jget '<json>' '<ruta python de diccionario>' — imprime el valor
  python3 -c "
import json,sys
d=json.loads(sys.argv[1])
try:
  cur=d
  for part in sys.argv[2].split('.'):
    k=part; cur=cur[int(k)] if k.lstrip('-').isdigit() else cur[k]
  print('null' if cur is None else cur)
except Exception:
  print('MISSING')
" "$1" "$2"
}

jlen() { # jlen '<json>' '<ruta>' — imprime la longitud de lista/dict en la ruta
  python3 -c "
import json,sys
d=json.loads(sys.argv[1])
try:
  cur=d
  for part in sys.argv[2].split('.'):
    k=part; cur=cur[int(k)] if k.lstrip('-').isdigit() else cur[k]
  print(len(cur) if isinstance(cur,(list,dict)) else 'NOTLIST')
except Exception:
  print('MISSING')
" "$1" "$2"
}

echo "=== Preparación: simuladores locales limpios + schema ==="
rm -rf .wrangler/state/v3/d1 .wrangler/state/v3/kv
npx wrangler d1 execute inas_attendance_db --local --file=schema.sql >/dev/null 2>&1 \
  && ok "schema aplicado a D1 local" || fail "no se pudo aplicar el schema local"

start_dev() { # start_dev <puerto>
  local port="$1"
  pkill -f "wrangler dev --port $port" 2>/dev/null; sleep 1
  rm -f "$LOG"
  npx wrangler dev --port "$port" >"$LOG" 2>&1 &
  WRANGLER_PID=$!
  for i in $(seq 1 60); do
    if curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/health" 2>/dev/null | grep -q 200; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: wrangler dev no respondió a tiempo"; tail -20 "$LOG"; exit 1
}
stop_dev() { kill "$WRANGLER_PID" 2>/dev/null; pkill -f "wrangler dev --port" 2>/dev/null; pkill -f "workerd" 2>/dev/null; sleep 2; }

TOMORROW=$(date -d "+1 day" +%Y-%m-%d 2>/dev/null || date -v+1d +%Y-%m-%d)
DAYAFTER=$(date -d "+2 days" +%Y-%m-%d 2>/dev/null || date -v+2d +%Y-%m-%d)

# ------------------------------------------------------------------------------
echo ""
echo "=== CORRIDA 1: modo abierto (sin AUTH_TOKEN) — ciclo completo ==="
start_dev "$PORT"
BASE="http://127.0.0.1:${PORT}"

H=$(curl -s "$BASE/api/sync/export")
check "export en nube vacía: 0 estudiantes" "0" "$(jget "$H" 'counts.students')"

PUSH=$(curl -s -X POST "$BASE/api/sync/push" -H 'Content-Type: application/json' -d "{
  \"schoolCode\":\"INAS_2026\",
  \"data\":{\"students\":[
      {\"code\":\"2000000001\",\"documentId\":\"2000000001\",\"documentType\":\"TI\",\"firstName\":\"Purga\",\"lastName\":\"Uno\",\"grade\":\"6°1\",\"status\":\"ACTIVO\"},
      {\"code\":\"2000000002\",\"documentId\":\"2000000002\",\"documentType\":\"TI\",\"firstName\":\"Purga\",\"lastName\":\"Dos\",\"grade\":\"7°2\",\"status\":\"ACTIVO\"}],
   \"records\":[{\"id\":\"2000000001_2026-09-04_06:30\",\"studentCode\":\"2000000001\",\"studentName\":\"Purga Uno\",\"grade\":\"6°1\",\"date\":\"2026-09-04\",\"time\":\"06:30:00\",\"status\":\"PUNTUAL\",\"method\":\"QR_CAMERA\"}],
   \"teachers\":[],\"assignments\":[],\"slots\":[]}}")
check "push semilla aceptado" "True" "$(jget "$PUSH" 'success')"

EXC=$(curl -s -X POST "$BASE/api/excuses" -H 'Content-Type: application/json' -d "{
  \"studentCode\":\"2000000001\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$DAYAFTER\",
  \"reason\":\"CITA_MEDICA\",\"notes\":\"prueba r28\",\"submittedBy\":\"QA_R28\"}")
check "excusa radicada (201)" "True" "$(jget "$EXC" 'success')"

H2=$(curl -s "$BASE/api/sync/export")
check "export post-semilla: 2 estudiantes" "2" "$(jget "$H2" 'counts.students')"
check "export post-semilla: 1 asistencia (D1 completo, sin recorte 500)" "1" "$(jget "$H2" 'counts.records')"
check "export post-semilla: 1 excusa" "1" "$(jget "$H2" 'counts.excuses')"
check "export trae snapshot KV (syncedAt vivo)" "2026" "$(jget "$H2" 'data.kvSnapshotSyncedAt' | head -c 4)"

P400=$(curl -s -X POST "$BASE/api/sync/purge" -H 'Content-Type: application/json' -d '{"confirm":"OTRA_COSA"}')
check "purga sin frase exacta → 400" "False" "$(jget "$P400" 'success')"
P400B=$(curl -s -X POST "$BASE/api/sync/purge" -H 'Content-Type: application/json' -d '{}')
check "purga sin confirm → 400" "False" "$(jget "$P400B" 'success')"
H3=$(curl -s "$BASE/api/sync/export")
check "purga rechazada NO borró nada (students=2)" "2" "$(jget "$H3" 'counts.students')"

PG=$(curl -s -X POST "$BASE/api/sync/purge" -H 'Content-Type: application/json' -d '{"confirm":"PURGAR","performedBy":"QA_R28"}')
check "purga con confirm PURGAR → 200" "True" "$(jget "$PG" 'success')"
check "  reporte: 2 estudiantes borrados" "2" "$(jget "$PG" 'tables.students')"
check "  reporte: 1 asistencia borrada" "1" "$(jget "$PG" 'tables.attendance_records')"
check "  reporte: 1 excusa borrada" "1" "$(jget "$PG" 'tables.student_excuses')"
check "  reporte: 2 claves KV borradas" "2" "$(jlen "$PG" 'kvDeleted')"

H4=$(curl -s "$BASE/api/sync/export")
check "export post-purga: 0 estudiantes" "0" "$(jget "$H4" 'counts.students')"
check "export post-purga: 0 excusas" "0" "$(jget "$H4" 'counts.excuses')"
check "export post-purga: snapshot KV fuera (null)" "null" "$(jget "$H4" 'data.kvSnapshotSyncedAt')"
check "auditoría: el evento CLOUD_PURGE sobrevive (audit_logs=1)" "1" "$(jget "$H4" 'counts.audit_logs')"
echo "    (audit_logs expuesto solo como conteo — archive-only por diseño)"

stop_dev

# ------------------------------------------------------------------------------
echo ""
echo "=== CORRIDA 2: con AUTH_TOKEN — guard + rate limit de purga ==="
echo "AUTH_TOKEN=tok28prueba-local" > .dev.vars
start_dev "$PORT2"
BASE="http://127.0.0.1:${PORT2}"

C1=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/export")
check "export sin Bearer → 401" "401" "$C1"
C2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/export" -H "Authorization: Bearer token-incorrecto")
check "export con Bearer incorrecto → 401" "401" "$C2"
C3=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/sync/export" -H "Authorization: Bearer tok28prueba-local")
check "export con Bearer correcto → 200" "200" "$C3"
CH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")
check "health sigue abierto (por diseño) → 200" "200" "$CH"

R1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/purge" -H "Authorization: Bearer tok28prueba-local" -H 'Content-Type: application/json' -d '{"confirm":"PURGAR"}')
R2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/purge" -H "Authorization: Bearer tok28prueba-local" -H 'Content-Type: application/json' -d '{"confirm":"PURGAR"}')
R3=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/purge" -H "Authorization: Bearer tok28prueba-local" -H 'Content-Type: application/json' -d '{"confirm":"PURGAR"}')
R4=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/sync/purge" -H "Authorization: Bearer tok28prueba-local" -H 'Content-Type: application/json' -d '{"confirm":"PURGAR"}')
check "purga 1/3 (misma hora) → 200" "200" "$R1"
check "purga 2/3 → 200" "200" "$R2"
check "purga 3/3 → 200" "200" "$R3"
check "purga 4/3 → 429 (rate limit por IP)" "429" "$R4"

stop_dev
rm -f .dev.vars

echo ""
echo "========================================"
echo "Ronda 28 worker — $PASS PASS, $FAIL FAIL"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
echo "SUITE COMPLETA: OK"
