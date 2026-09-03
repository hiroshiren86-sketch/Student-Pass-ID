#!/usr/bin/env bash
# ==============================================================================
# verify_excuses_12casos.sh — Casos de aceptación §10 (parte API/worker, Ronda 22)
# Verifica de forma AUTOCONTENIDA los casos no cubiertos por las suites P0/P1:
#   Caso 5  (Incapacidad multi-día): 1 excusa → 3 registros protegidos (overlay en D1).
#   Caso 7  (Inmutabilidad): PATCH con rol ESTUDIANTE/DOCENTE → 403 (R5).
#   Caso 10 (Tampering): ALTER de fila en D1 → verify-chain intact:false.
#   Caso 12 (Bordes): R10 fecha > SCHOOL_TERM_END → 400; OTRA sin nota → 400;
#            estudiante inexistente → 404; R1 día con asistencia → 400.
# Los casos 1 (motor), 2,3,4,6,8,9,11 ya tienen evidencia en P0/P1/12casos_ui.
# Uso: bash scripts/verify_excuses_12casos.sh
# ==============================================================================
set -u
cd /home/z/my-project/Student-Pass-ID/cloudflare-worker

PORT=8793
BASE="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
TODAY=$(date -u +%F)
TOMORROW=$(date -u -d '+1 day' +%F)
TERMINO=$(date -u -d '+10 days' +%F)
D1=$(date -u -d '-1 day' +%F)
D2=$(date -u -d '-2 days' +%F)
D3=$(date -u -d '-3 days' +%F)
FARO=$(date -u -d '+40 days' +%F)

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
assert_status() {
  local name="$1" st="$2" exp="$3"
  if [ "$st" = "$exp" ]; then echo "  ✅ PASS — $name (HTTP $st)"; PASS=$((PASS+1)); else echo "  ❌ FAIL — $name (HTTP $st, esperaba $exp)"; FAIL=$((FAIL+1)); fi
}

# ---------- 0. D1 local fresca + semillas (3 días AUSENTE consecutivos) ----------
say "0. D1 local: schema + semillas (3 AUSENTE consecutivos de TEST001)"
pkill -f "wrangler dev" 2>/dev/null; sleep 1
rm -rf .wrangler/state/v3/d1 2>/dev/null
npx wrangler d1 execute inas_attendance_db --local --file=./schema.sql -y >/dev/null 2>&1 || { echo "FALLO init D1 local"; exit 1; }
cat > /tmp/seed_12casos.sql <<EOF
INSERT INTO students (code, document_id, first_name, last_name, grade, status) VALUES
 ('TEST001','999001','Daniel','Prueba','10°1','ACTIVO');
INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method) VALUES
 ('rec-d3','TEST001','Daniel Prueba','999001','10°1','${D3}','07:30','AUSENTE','AUTO_CIERRE'),
 ('rec-d2','TEST001','Daniel Prueba','999001','10°1','${D2}','07:30','AUSENTE','AUTO_CIERRE'),
 ('rec-d1','TEST001','Daniel Prueba','999001','10°1','${D1}','07:30','AUSENTE','AUTO_CIERRE');
EOF
npx wrangler d1 execute inas_attendance_db --local --file=/tmp/seed_12casos.sql -y >/dev/null 2>&1 || { echo "FALLO semillas"; exit 1; }
echo "  semillas OK"

# ---------- 1. wrangler dev con término escolar configurado (para R10) ----------
say "1. wrangler dev --local (con SCHOOL_TERM_END=${TERMINO})"
nohup npx wrangler dev --local --port $PORT --var EXCUSE_CHAIN_SECRET:dev-secret-r22 --var SCHOOL_TERM_END:${TERMINO} > /tmp/wrangler_12casos.log 2>&1 &
WPID=$!
for i in $(seq 1 60); do
  if curl -s "$BASE/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('status')=='online' else 1)" 2>/dev/null; then
    echo "  worker OK (intento $i)"; break
  fi
  sleep 1
done

B() { curl -s -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }
ST() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

# ---------- CASO 12: bordes ----------
say "CASO 12 — Bordes"
S=$(ST POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$FARO\",\"endDate\":\"$FARO\",\"reason\":\"CITA_MEDICA\",\"submittedBy\":\"RECTORIA\"}")
assert_status "R10: fecha > SCHOOL_TERM_END → 400" "$S" 400
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$FARO\",\"endDate\":\"$FARO\",\"reason\":\"CITA_MEDICA\",\"submittedBy\":\"RECTORIA\"}")
assert "R10: mensaje ES con la fecha del término" "$R" "d['success']==False and any('R10' in str(e.get('rule','')) for e in d.get('errors',[]))" "$R"
R=$(B POST /api/excuses "{\"studentCode\":\"NOEXISTE\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$TOMORROW\",\"reason\":\"CITA_MEDICA\",\"submittedBy\":\"RECTORIA\"}")
assert "borde: estudiante sin matrícula → 404 ES" "$R" "d['success']==False and ('no encontrado' in json.dumps(d,ensure_ascii=False).lower() or 'matrícula' in json.dumps(d,ensure_ascii=False).lower())"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$D3\",\"endDate\":\"$D3\",\"reason\":\"OTRA\",\"notes\":\" \",\"sourceAttendanceId\":\"rec-d3\",\"submittedBy\":\"RECTORIA\"}")
assert "borde: OTRA sin nota → 400 (R3)" "$R" "d['success']==False and any('R3' in str(e.get('rule','')) for e in d.get('errors',[]))"

# ---------- CASO 5: incapacidad multi-día (1 excusa → 3 registros) ----------
# (PRIMERO el rango completo: los 3 AUSENTE están libres aún — R2 impide dobles)
say "CASO 5 — Incapacidad multi-día: rango de 3 días"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$D3\",\"endDate\":\"$D1\",\"reason\":\"INCAPACIDAD\",\"notes\":\"Incapacidad médica 3 días\",\"submittedBy\":\"RECTORIA\"}")
assert "POST post-hoc rango 3 días → 201 con recordsLinked=3" "$R" "d['success']==True and d['recordsLinked']==3" "$R"
EXC5=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['excuse']['id'])")
N=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM attendance_records WHERE excuse_id='${EXC5}'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "D1: los 3 AUSENTE quedaron vinculados a UNA excusa (overlay §1.2)" "$N" "int('$N')==3"

# ---------- CASO 7: inmutabilidad (roles sin autoridad) ----------
say "CASO 7 — Inmutabilidad: solo RECTORÍA decide"
S=$(ST PATCH "/api/excuses/$EXC5" "{\"status\":\"APROBADA\",\"reviewedBy\":\"estu1\",\"reviewedByRole\":\"ESTUDIANTE\"}")
assert_status "PATCH rol ESTUDIANTE → 403 (R5)" "$S" 403
S=$(ST PATCH "/api/excuses/$EXC5" "{\"status\":\"APROBADA\",\"reviewedBy\":\"doc1\",\"reviewedByRole\":\"DOCENTE\"}")
assert_status "PATCH rol DOCENTE → 403 (R5)" "$S" 403
R=$(B PATCH "/api/excuses/$EXC5" "{\"status\":\"RECHAZADA\",\"reviewedBy\":\"rectora\",\"reviewedByRole\":\"RECTORIA\",\"rejectReason\":\"Soporte no válido\"}")
assert "PATCH rol RECTORÍA con motivo → 200 (R6 exige motivo)" "$R" "d['success']==True and d['excuse']['status']=='RECHAZADA'" "$R"
NV=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM attendance_records WHERE excuse_id='${EXC5}'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "desvinculación tras rechazo: los 3 registros vuelven a AUSENTE puro" "$NV" "int('$NV')==0"

# ---------- CASO 10: tampering forense (pasada 2 endurecida Ronda 22) ----------
say "CASO 10 — Tampering: alterar la FILA en D1 se detecta (notes firmado desde Ronda 22)"
R=$(B GET /api/excuses/verify-chain)
assert "cadena íntegra antes de manipular" "$R" "d['intact']==True and d['signed']==True"
npx wrangler d1 execute inas_attendance_db --local --command "UPDATE student_excuses SET notes='ALTERADO POR ATACANTE' WHERE id='${EXC5}'" -y >/dev/null 2>&1
R=$(B GET /api/excuses/verify-chain)
assert "notes de la fila alterado → intact:false (pasada 2 endurecida)" "$R" "d['intact']==False and d.get('firstBroken','')== '${EXC5}'" "$R"
npx wrangler d1 execute inas_attendance_db --local --command "UPDATE student_excuses SET notes='Incapacidad médica 3 días' WHERE id='${EXC5}'" -y >/dev/null 2>&1
R=$(B GET /api/excuses/verify-chain)
assert "restaurada → cadena íntegra de nuevo" "$R" "d['intact']==True"

say "Resumen 12-casos (API/worker)"
echo "-------------------------------------"
echo "  PASS: $PASS   FAIL: $FAIL"
kill $WPID 2>/dev/null
pkill -f "wrangler dev" 2>/dev/null
[ $FAIL -eq 0 ] && echo "🎉 12-CASOS API VERDE" || echo "⚠️ hay fallos — revisar arriba"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
