#!/usr/bin/env bash
# ==============================================================================
# verify_excuses_p1.sh — Suite funcional P1 del motor de protección (Ronda 21)
# Valida (spec-excusas-2026 §4 + §1.2):
#   A. Overlay en D1 tras radicar (post-hoc y anticipada).
#   B. CRÍTICO — COALESCE en /api/sync/push: un dispositivo obsoleto (sin
#      excuseId local) NO borra la vinculación vigente en D1 al pushear.
#   C. Push con excuseId explícito sí escribe (auto-cierre con excusa).
#   D. /api/attendance con la misma protección.
#   E. Anticipada vigente cubre HOY → overlay al cierre (simulación vía API push
#      de registros AUTO_CIERRE ya etiquetados por el frontend).
# Uso: bash /home/z/my-project/Student-Pass-ID/scripts/verify_excuses_p1.sh
# ==============================================================================
set -u
cd /home/z/my-project/Student-Pass-ID/cloudflare-worker

PORT=8792
BASE="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
TODAY=$(date -u +%F)
TOMORROW=$(date -u -d '+1 day' +%F)
YESTERDAY=$(date -u -d '-1 day' +%F)

say() { echo -e "\n=== $1 ==="; }
assert() {
  local name="$1" body="$2" expr="$3"
  if echo "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok=($expr)
sys.exit(0 if ok else 1)
" 2>/dev/null; then echo "  ✅ PASS — $name"; PASS=$((PASS+1)); else echo "  ❌ FAIL — $name"; echo "     body: ${body:0:400}"; FAIL=$((FAIL+1)); fi
}

d1q() { # d1q <sql> → JSON de filas
  npx wrangler d1 execute inas_attendance_db --local --command "$1" --json -y 2>/dev/null | python3 -c "import json,sys; r=json.load(sys.stdin); print(json.dumps(r[0]['results'] if r and r[0].get('results') else []))"
}

# ---------- 0. D1 local fresca + semillas ----------
say "0. D1 local: schema + semillas"
rm -rf .wrangler/state/v3/d1 2>/dev/null
npx wrangler d1 execute inas_attendance_db --local --file=./schema.sql -y >/dev/null 2>&1 || { echo "FALLO init D1 local"; exit 1; }
cat > /tmp/seed_p1.sql <<EOF
INSERT INTO students (code, document_id, first_name, last_name, grade, status) VALUES
 ('P10001','880001','María','P1','9°1','ACTIVO'),
 ('P10002','880002','José','P2','9°1','ACTIVO');
-- María: AUSENTE de ayer sin excusa (para post-hoc) + registro de hoy para push
INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method) VALUES
 ('p1-rec-a','P10001','María P1','880001','9°1','${YESTERDAY}','07:30','AUSENTE','AUTO_CIERRE');
EOF
npx wrangler d1 execute inas_attendance_db --local --file=/tmp/seed_p1.sql -y >/dev/null 2>&1 || { echo "FALLO semillas"; exit 1; }
echo "  semillas OK"

# ---------- 1. Servidor local ----------
say "1. wrangler dev --local en puerto $PORT"
nohup npx wrangler dev --local --port $PORT --var EXCUSE_CHAIN_SECRET:dev-secret-ronda21 > /tmp/wrangler_dev_p1.log 2>&1 &
WPID=$!
for i in $(seq 1 45); do
  sleep 1
  if curl -s "$BASE/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('status')=='online' else 1)" 2>/dev/null; then
    echo "  worker arriba (intento $i)"; break
  fi
  if [ $i -eq 45 ]; then echo "FALLO: worker no arrancó"; tail -20 /tmp/wrangler_dev_p1.log; kill $WPID 2>/dev/null; exit 1; fi
done

# ---------- A. Post-hoc → overlay en D1 ----------
say "A. Radicar post-hoc (sourceAttendanceId) → overlay en D1"
R=$(curl -s -X POST "$BASE/api/excuses" -H 'Content-Type: application/json' -d "{
  \"studentCode\":\"P10001\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$YESTERDAY\",
  \"reason\":\"CITA_MEDICA\",\"submittedBy\":\"RECTORIA\",\"sourceAttendanceId\":\"p1-rec-a\"}")
assert "POST post-hoc → 201 success" "$R" "d.get('success')==True and d.get('recordsLinked')==1"
EXC_ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['excuse']['id'])")
ROW=$(d1q "SELECT id, excuse_id FROM attendance_records WHERE id='p1-rec-a'")
assert "D1: p1-rec-a.excuse_id = $EXC_ID" "$ROW" "len(d)==1 and d[0]['excuse_id']=='$EXC_ID'"

# ---------- B. CRÍTICO: push obsoleto NO borra el overlay ----------
say "B. COALESCE — dispositivo obsoleto pushea SIN excuseId → overlay sobrevive"
PUSH=$(curl -s -X POST "$BASE/api/sync/push" -H 'Content-Type: application/json' -d "{
  \"schoolCode\":\"INAS_2026\",
  \"data\":{\"records\":[{\"id\":\"p1-rec-a\",\"studentCode\":\"P10001\",\"studentName\":\"María P1\",\"documentId\":\"880001\",\"grade\":\"9°1\",\"date\":\"$YESTERDAY\",\"time\":\"07:30\",\"status\":\"AUSENTE\",\"method\":\"AUTO_CIERRE\",\"verifiedHmac\":true,\"notes\":\"Inasistencia marcada automáticamente por auto-cierre de bloque horario\"}]}}")
assert "push 200" "$PUSH" "d.get('success')==True"
ROW=$(d1q "SELECT id, excuse_id FROM attendance_records WHERE id='p1-rec-a'")
assert "D1: excuse_id PRESERVADO tras push obsoleto" "$ROW" "len(d)==1 and d[0]['excuse_id']=='$EXC_ID'"

# ---------- C. Push con excuseId explícito SÍ escribe ----------
say "C. Push con excuseId explícito (auto-cierre con excusa) → overlay escrito"
PUSH=$(curl -s -X POST "$BASE/api/sync/push" -H 'Content-Type: application/json' -d "{
  \"schoolCode\":\"INAS_2026\",
  \"data\":{\"records\":[{\"id\":\"p1-rec-b\",\"studentCode\":\"P10001\",\"studentName\":\"María P1\",\"documentId\":\"880001\",\"grade\":\"9°1\",\"date\":\"$TODAY\",\"time\":\"07:30\",\"status\":\"AUSENTE\",\"method\":\"AUTO_CIERRE\",\"verifiedHmac\":true,\"excuseId\":\"$EXC_ID\"}]}}")
assert "push 200" "$PUSH" "d.get('success')==True"
ROW=$(d1q "SELECT id, excuse_id FROM attendance_records WHERE id='p1-rec-b'")
assert "D1: p1-rec-b.excuse_id escrito por push" "$ROW" "len(d)==1 and d[0]['excuse_id']=='$EXC_ID'"

# ---------- D. /api/attendance con la misma protección ----------
say "D. /api/attendance — upsert individual con COALESCE"
R=$(curl -s -X POST "$BASE/api/attendance" -H 'Content-Type: application/json' -d "{
  \"id\":\"p1-rec-c\",\"studentCode\":\"P10001\",\"studentName\":\"María P1\",\"grade\":\"9°1\",
  \"date\":\"$TODAY\",\"time\":\"08:30\",\"status\":\"AUSENTE\",\"method\":\"AUTO_CIERRE\"}")
assert "attendance POST 200" "$R" "d.get('success')==True"
R=$(curl -s -X POST "$BASE/api/attendance" -H 'Content-Type: application/json' -d "{
  \"id\":\"p1-rec-c\",\"studentCode\":\"P10001\",\"studentName\":\"María P1\",\"grade\":\"9°1\",
  \"date\":\"$TODAY\",\"time\":\"08:30\",\"status\":\"AUSENTE\",\"method\":\"AUTO_CIERRE\",\"excuseId\":\"$EXC_ID\"}")
assert "attendance POST 200 (con excuseId)" "$R" "d.get('success')==True"
ROW=$(d1q "SELECT id, excuse_id FROM attendance_records WHERE id='p1-rec-c'")
assert "D1: p1-rec-c.excuse_id escrito" "$ROW" "len(d)==1 and d[0]['excuse_id']=='$EXC_ID'"
# y el obsoleto no borra (mismo caso B, ruta individual)
R=$(curl -s -X POST "$BASE/api/attendance" -H 'Content-Type: application/json' -d "{
  \"id\":\"p1-rec-c\",\"studentCode\":\"P10001\",\"studentName\":\"María P1\",\"grade\":\"9°1\",
  \"date\":\"$TODAY\",\"time\":\"08:30\",\"status\":\"AUSENTE\",\"method\":\"AUTO_CIERRE\"}")
ROW=$(d1q "SELECT id, excuse_id FROM attendance_records WHERE id='p1-rec-c'")
assert "D1: excuse_id PRESERVADO tras attendance obsoleto" "$ROW" "len(d)==1 and d[0]['excuse_id']=='$EXC_ID'"

# ---------- E. Anticipada vigente (Escudo) + auditoría ----------
say "E. Anticipada (mañana) radica y NO toca registros; audit EXCUSE_CREATED"
R=$(curl -s -X POST "$BASE/api/excuses" -H 'Content-Type: application/json' -d "{
  \"studentCode\":\"P10002\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$TOMORROW\",
  \"reason\":\"INCAPACIDAD\",\"submittedBy\":\"PORTAL_ESTUDIANTE\"}")
assert "POST anticipada → 201, recordsLinked 0" "$R" "d.get('success')==True and d.get('recordsLinked')==0"
R=$(curl -s "$BASE/api/excuses/verify-chain")
assert "verify-chain intact tras operaciones" "$R" "d.get('intact')==True and d.get('signed')==True and d.get('checked',0)>=2"

say "Resumen"
echo "-------------------------------------"
echo "  PASS: $PASS   FAIL: $FAIL"
kill $WPID 2>/dev/null
pkill -f "wrangler dev --local --port $PORT" 2>/dev/null
[ $FAIL -eq 0 ] && echo "🎉 P1 VERDE" || echo "⚠️ hay fallos — revisar arriba"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
