#!/usr/bin/env bash
# ==============================================================================
# verify_excuses_p0.sh — Suite funcional P0 del módulo de excusas (Ronda 21)
# Levanta wrangler dev --local con D1 local fresca + semillas, y ejecuta los
# casos de aceptación del P0 (spec-excusas-2026 §10, subconjunto API/worker).
# Uso: bash /home/z/my-project/scripts/verify_excuses_p0.sh
# ==============================================================================
set -u
cd /home/z/my-project/Student-Pass-ID/cloudflare-worker

PORT=8791
BASE="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
TODAY=$(date -u +%F)
TOMORROW=$(date -u -d '+1 day' +%F)
DAY2=$(date -u -d '+2 days' +%F)
YESTERDAY=$(date -u -d '-1 day' +%F)
YESTERDAY2=$(date -u -d '-2 days' +%F)

say() { echo -e "\n=== $1 ==="; }
assert() { # assert <nombre> <json> <expresión python sobre dict d>
  local name="$1" body="$2" expr="$3"
  if echo "$body" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok=($expr)
sys.exit(0 if ok else 1)
" 2>/dev/null; then echo "  ✅ PASS — $name"; PASS=$((PASS+1)); else echo "  ❌ FAIL — $name"; echo "     body: ${body:0:400}"; FAIL=$((FAIL+1)); fi
}
assert_status() { # assert_status <nombre> <status> <esperado>
  local name="$1" st="$2" exp="$3"
  if [ "$st" = "$exp" ]; then echo "  ✅ PASS — $name (HTTP $st)"; PASS=$((PASS+1)); else echo "  ❌ FAIL — $name (HTTP $st, esperaba $exp)"; FAIL=$((FAIL+1)); fi
}

# ---------- 0. D1 local fresca + semillas ----------
say "0. D1 local: schema + semillas"
rm -rf .wrangler/state/v3/d1 2>/dev/null
npx wrangler d1 execute inas_attendance_db --local --file=./schema.sql -y >/dev/null 2>&1 || { echo "FALLO init D1 local"; exit 1; }
cat > /tmp/seed_excuses.sql <<EOF
INSERT INTO students (code, document_id, first_name, last_name, grade, status) VALUES
 ('TEST001','999001','Daniel','Prueba','10°1','ACTIVO'),
 ('TEST002','999002','Nicolás','Prueba2','10°1','ACTIVO');
-- Caso bloque doble: 1ª hora asistió (PUNTUAL), 2ª hora AUSENTE, mismo día
INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method) VALUES
 ('rec-1a','TEST001','Daniel Prueba','999001','10°1','${YESTERDAY}','07:30','PUNTUAL','QR_CAMERA'),
 ('rec-1b','TEST001','Daniel Prueba','999001','10°1','${YESTERDAY}','09:20','AUSENTE','AUTO_CIERRE'),
 ('rec-2a','TEST001','Daniel Prueba','999001','10°1','${YESTERDAY2}','07:30','AUSENTE','AUTO_CIERRE'),
 ('rec-3a','TEST002','Nicolás Prueba2','999002','10°1','${YESTERDAY}','07:30','TARDANZA','QR_CAMERA');
EOF
npx wrangler d1 execute inas_attendance_db --local --file=/tmp/seed_excuses.sql -y >/dev/null 2>&1 || { echo "FALLO semillas"; exit 1; }
echo "  semillas OK (TEST001: 1 PUNTUAL + 2 AUSENTE; TEST002: 1 TARDANZA)"

# ---------- 1. Servidor local ----------
say "1. wrangler dev --local en puerto $PORT"
export EXCUSE_CHAIN_SECRET="dev-secret-ronda21"
nohup npx wrangler dev --local --port $PORT --var EXCUSE_CHAIN_SECRET:dev-secret-ronda21 > /tmp/wrangler_dev.log 2>&1 &
WPID=$!
for i in $(seq 1 45); do
  sleep 1
  if curl -s "$BASE/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('status')=='online' else 1)" 2>/dev/null; then
    echo "  health OK tras ${i}s"; break
  fi
  if [ "$i" = "45" ]; then echo "  ❌ servidor no respondió"; tail -20 /tmp/wrangler_dev.log; exit 1; fi
done

B() { curl -s -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }
ST() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

# ---------- 2. Casos P0 ----------
say "2. POST anticipada válida → 201 PENDIENTE (Escudo)"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$DAY2\",\"reason\":\"CITA_MEDICA\",\"submittedBy\":\"PORTAL_ESTUDIANTE\"}")
assert "anticipada 201 + PENDIENTE + protección provisional" "$R" "d['success'] and d['excuse']['status']=='PENDIENTE'"
EXC_FUTURA=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['excuse']['id'])")

say "3. Validaciones R1/R3 de creación"
S=$(ST POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$TODAY\",\"reason\":\"CITA_MEDICA\"}")
assert_status "R1 end<start → 400" "$S" 400
R=$(B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$DAY2\",\"reason\":\"OTRA\"}")
assert "R3 OTRA sin notas → rechazada" "$R" "d['success']==False and any(e['rule']=='R3' for e in d.get('errors',[]))"
S=$(ST POST /api/excuses "{\"studentCode\":\"NOEXISTE\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$DAY2\",\"reason\":\"CITA_MEDICA\"}")
assert_status "404 estudiante inexistente" "$S" 404
R=$(B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$TODAY\",\"reason\":\"CALAMIDAD\"}")
assert "R1 anticipada no puede empezar hoy/pasado (sin AUSENTE en rango TEST002→TARDANZA no cuenta R9)" "$R" "d['success']==False"

say "4. Post-hoc 1 toque sobre el AUSENTE de 2ª hora (caso bloque doble)"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$YESTERDAY\",\"reason\":\"CITA_MEDICA\",\"sourceAttendanceId\":\"rec-1b\",\"submittedBy\":\"RECTORIA\"}")
assert "post-hoc 201, ancla rec-1b" "$R" "d['success'] and d['excuse']['sourceAttendanceId']=='rec-1b'"
assert "recordsLinked == 1 (solo el AUSENTE; el PUNTUAL de 1ª hora intacto R9)" "$R" "d['recordsLinked']==1"
EXC_PH=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['excuse']['id'])")

say "5. R2: doble justificación del mismo AUSENTE"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$YESTERDAY\",\"reason\":\"CALAMIDAD\",\"sourceAttendanceId\":\"rec-1b\"}")
assert "R2 → 400 con mensaje ES" "$R" "d['success']==False and any(e['rule']=='R2' for e in d.get('errors',[]))"

say "6. R9/R1: justificar día donde asistió o sin AUSENTE"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$YESTERDAY\",\"reason\":\"CALAMIDAD\",\"sourceAttendanceId\":\"rec-1a\"}")
assert "R9 ancla PUNTUAL → 400" "$R" "d['success']==False and any(e['rule']=='R9' for e in d.get('errors',[]))"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$YESTERDAY\",\"endDate\":\"$YESTERDAY\",\"reason\":\"CALAMIDAD\"}")
assert "R1 TEST002 solo tiene TARDANZA → 400 'No hay ausencia'" "$R" "d['success']==False and any('No hay ausencia' in e['message_es'] for e in d.get('errors',[]))"

say "7. Post-hoc rango: AUSENTE de hace 2 días se vincula (overlay)"
R=$(B POST /api/excuses "{\"studentCode\":\"TEST001\",\"startDate\":\"$YESTERDAY2\",\"endDate\":\"$YESTERDAY2\",\"reason\":\"INCAPACIDAD\",\"submittedBy\":\"RECTORIA\"}")
assert "rango post-hoc 201 + recordsLinked 1 (rec-2a)" "$R" "d['success'] and d['recordsLinked']==1"

say "8. Verificación en D1 del overlay (excuse_id solo en AUSENTE)"
OV=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT id, status, excuse_id IS NOT NULL AS linked FROM attendance_records WHERE student_code='TEST001' ORDER BY id" --json 2>/dev/null | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)[0]['results']))")
assert "rec-1a PUNTUAL sin excusa" "$OV" "d[0]['id']=='rec-1a' and d[0]['linked']==0"
assert "rec-1b AUSENTE con excusa" "$OV" "d[1]['id']=='rec-1b' and d[1]['linked']==1"

say "9. R5/R6: decisiones solo Rectoría, rechazo exige motivo"
S=$(ST PATCH "/api/excuses/$EXC_PH" "{\"status\":\"APROBADA\",\"reviewedBy\":\"rectora1\",\"reviewedByRole\":\"DOCENTE\"}")
assert_status "R5 rol DOCENTE → 403" "$S" 403
S=$(ST PATCH "/api/excuses/$EXC_PH" "{\"status\":\"RECHAZADA\",\"reviewedBy\":\"rectora1\",\"reviewedByRole\":\"RECTORIA\"}")
assert_status "R6 rechazo sin motivo → 400" "$S" 400

say "10. Rechazo real → desvinculación del registro (vuelve AUSENTE puro)"
R=$(B PATCH "/api/excuses/$EXC_PH" "{\"status\":\"RECHAZADA\",\"reviewedBy\":\"rectora1\",\"reviewedByRole\":\"RECTORIA\",\"rejectReason\":\"Soporte no válido: la cita es del mes pasado\"}")
assert "PATCH 200 RECHAZADA" "$R" "d['success'] and d['excuse']['status']=='RECHAZADA' and d['excuse']['reject_reason']!=''"
OV=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT excuse_id IS NOT NULL AS linked FROM attendance_records WHERE id='rec-1b'" --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['linked'])")
assert "rec-1b desvinculado tras rechazo (overlay=NULL)" "$OV" "d==0"

say "11. 409: sin transiciones en reversa"
S=$(ST PATCH "/api/excuses/$EXC_PH" "{\"status\":\"APROBADA\",\"reviewedBy\":\"rectora1\",\"reviewedByRole\":\"RECTORIA\"}")
assert_status "ya decidida → 409" "$S" 409

say "12. R3: límite de 3 activas (las post-hoc pasadas no cuentan)"
B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$DAY2\",\"endDate\":\"$DAY2\",\"reason\":\"DEPORTIVA\"}" >/dev/null
B POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$DAY2\",\"endDate\":\"$DAY2\",\"reason\":\"INCAPACIDAD\"}" >/dev/null
S=$(ST POST /api/excuses "{\"studentCode\":\"TEST002\",\"startDate\":\"$DAY2\",\"endDate\":\"$DAY2\",\"reason\":\"CALAMIDAD\"}")
assert_status "4ª activa → 400 R3" "$S" 400

say "13. GET list con filtros + aprobación"
N=$(curl -s "$BASE/api/excuses?studentCode=TEST001" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['excuses']))")
if [ "$N" -ge 2 ]; then echo "  ✅ PASS — lista TEST001 tiene $N excusas"; PASS=$((PASS+1)); else echo "  ❌ FAIL — lista TEST001 ($N)"; FAIL=$((FAIL+1)); fi
S=$(ST PATCH "/api/excuses/$EXC_FUTURA" "{\"status\":\"APROBADA\",\"reviewedBy\":\"rectora1\",\"reviewedByRole\":\"RECTORIA\",\"physicalDocumentVerified\":true}")
assert_status "aprobación con soporte físico verificado → 200" "$S" 200

say "14. verify-chain (signed:true) + tampering forense en dos frentes"
R=$(curl -s "$BASE/api/excuses/verify-chain")
assert "cadena íntegra antes de manipular" "$R" "d['intact']==True and d['signed']==True and d['checked']>=7"

# Frente 1 (§10.10): alterar la FILA de la excusa fuera del API → 2ª pasada lo caza
npx wrangler d1 execute inas_attendance_db --local --command "UPDATE student_excuses SET status='APROBADA' WHERE id='$EXC_PH'" -y >/dev/null 2>&1
R=$(curl -s "$BASE/api/excuses/verify-chain")
assert "fila alterada detectada (intact:false, culprit=excusa)" "$R" "d['intact']==False and d.get('firstBroken')=='$EXC_PH'"
npx wrangler d1 execute inas_attendance_db --local --command "UPDATE student_excuses SET status='RECHAZADA' WHERE id='$EXC_PH'" -y >/dev/null 2>&1
R=$(curl -s "$BASE/api/excuses/verify-chain")
assert "restaurada → cadena íntegra de nuevo" "$R" "d['intact']==True"

# Frente 2: alterar el PAYLOAD del log (razón) → 1ª pasada lo caza
npx wrangler d1 execute inas_attendance_db --local --command "UPDATE audit_logs SET details_json = replace(details_json, '\"CITA_MEDICA\"', '\"CITA_FALSA\"') WHERE event_type='EXCUSE_CREATED' AND details_json LIKE '%CITA_MEDICA%'" -y >/dev/null 2>&1
R=$(curl -s "$BASE/api/excuses/verify-chain")
assert "payload del log alterado detectado (firstBroken=evento audit)" "$R" "d['intact']==False and d.get('firstBroken') and d.get('firstBroken')!='' and d.get('firstBroken').startswith('aud-')"

say "15. Resumen"
echo "-------------------------------------"
echo "  PASS: $PASS   FAIL: $FAIL"
kill $WPID 2>/dev/null
[ $FAIL -eq 0 ] && echo "🎉 P0 VERDE" || echo "⚠️ hay fallos — revisar arriba"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
