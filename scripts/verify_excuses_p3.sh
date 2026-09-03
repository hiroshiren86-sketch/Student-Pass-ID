#!/usr/bin/env bash
# ==============================================================================
# verify_excuses_p3.sh — Fase P3 "Evidencia" (Ronda 22): soporte fotográfico
# cifrado AES-GCM + control de acceso Ley 1581. Ejecutar:
#   bash scripts/verify_excuses_p3.sh
# Verifica:
#   1. Upload como estudiante dueño → 200; D1 guarda ciphertext (NUNCA el original).
#   2. GET con rol RECTORIA → descifra y devuelve los bytes EXACTOS.
#   3. GET como el estudiante dueño (requestBy) → permitido (§5: Rectoría o dueño).
#   4. GET sin autorización (otro estudiante / sin params) → 403 (Ley 1581).
#   5. Upload de otro estudiante (no dueño, sin rol) → 403.
#   6. Payload demasiado grande → 413 con mensaje ES.
#   7. IV aleatorio: dos uploads del mismo contenido → ciphertexts distintos.
#   8. verify-chain sigue íntegro tras los adjuntos (los adjuntos NO alteran la cadena).
# ==============================================================================
set -u
cd /home/z/my-project/Student-Pass-ID/cloudflare-worker

PORT=8795
BASE="http://127.0.0.1:${PORT}"
PASS=0; FAIL=0
TOMORROW=$(date -u -d '+1 day' +%F)

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

say "0. D1 local fresca + semillas"
pkill -f "wrangler dev" 2>/dev/null; sleep 1
rm -rf .wrangler/state/v3/d1 2>/dev/null
npx wrangler d1 execute inas_attendance_db --local --file=./schema.sql -y >/dev/null 2>&1 || { echo "FALLO init D1"; exit 1; }
cat > /tmp/seed_p3.sql <<EOF
INSERT INTO students (code, document_id, first_name, last_name, grade, status) VALUES
 ('EST-P3','888001','Sofía','Prueba3','9°1','ACTIVO');
EOF
npx wrangler d1 execute inas_attendance_db --local --file=/tmp/seed_p3.sql -y >/dev/null 2>&1 || { echo "FALLO semillas"; exit 1; }
echo "  semillas OK"

say "1. wrangler dev --local (con EXCUSE_ATTACHMENT_SECRET)"
nohup npx wrangler dev --local --port $PORT --var EXCUSE_ATTACHMENT_SECRET:sec-attach-r22 --var EXCUSE_CHAIN_SECRET:sec-chain-r22 > /tmp/wrangler_p3.log 2>&1 &
WPID=$!
for i in $(seq 1 60); do
  if curl -s "$BASE/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get('status')=='online' else 1)" 2>/dev/null; then echo "  worker OK (intento $i)"; break; fi
  sleep 1
done

B() { curl -s -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }
ST() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json' ${3:+-d "$3"}; }

# Radicar una excusa anticipada (para adjuntarle el soporte)
R=$(B POST /api/excuses "{\"studentCode\":\"EST-P3\",\"startDate\":\"$TOMORROW\",\"endDate\":\"$TOMORROW\",\"reason\":\"CITA_MEDICA\",\"notes\":\"Odontología\",\"submittedBy\":\"PORTAL_ESTUDIANTE\"}")
EXC=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['excuse']['id'])")
echo "  excusa $EXC"

# "Foto" de prueba: 600 bytes aleatorios en base64 (contenido determinista con hashlib)
PHOTO=$(python3 -c "import base64,hashlib; print(base64.b64encode(hashlib.sha256(b'fotografia-soporte-p3').digest()*24).decode())")
PHOTO2=$(python3 -c "import base64,hashlib; print(base64.b64encode(hashlib.sha256(b'fotografia-soporte-p3').digest()*24).decode())")

say "2. Upload del soporte (dueño) + cifrado en D1"
S=$(ST POST "/api/excuses/$EXC/attachment" "{\"studentCode\":\"EST-P3\",\"dataBase64\":\"$PHOTO\",\"mime\":\"image/jpeg\"}")
assert_status "upload dueño → 200" "$S" 200
STORED=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT attachment_path AS p FROM student_excuses WHERE id='$EXC'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['p'] or '')")
if [[ "$STORED" == AESGCM:v1:* ]]; then echo "  ✅ PASS — D1 guarda formato AESGCM:v1 (cifrado, sin migración)"; PASS=$((PASS+1)); else echo "  ❌ FAIL — formato AESGCM:v1 en D1 (got: ${STORED:0:30})"; FAIL=$((FAIL+1)); fi
if [[ "$PHOTO" != "$STORED" && "$STORED" != *"${PHOTO:0:24}"* ]]; then echo "  ✅ PASS — el plaintext JAMÁS está en D1"; PASS=$((PASS+1)); else echo "  ❌ FAIL — plaintext en D1"; FAIL=$((FAIL+1)); fi

say "3. Descifrado por rol (Ley 1581)"
R=$(B GET "/api/excuses/$EXC/attachment?role=RECTORIA")
assert "RECTORIA descifra y recibe bytes EXACTOS" "$R" "d['success']==True and d['dataBase64']=='$PHOTO'"
R=$(B GET "/api/excuses/$EXC/attachment?requestBy=EST-P3")
assert "dueño (requestBy) también puede verlo (§5)" "$R" "d['success']==True and d['dataBase64']=='$PHOTO'"
S=$(ST GET "/api/excuses/$EXC/attachment?requestBy=OTRO-EST")
assert_status "otro estudiante → 403 (dato especial)" "$S" 403
S=$(ST GET "/api/excuses/$EXC/attachment")
assert_status "sin params → 403" "$S" 403

say "4. Controles de upload"
S=$(ST POST "/api/excuses/$EXC/attachment" "{\"studentCode\":\"OTRO-EST\",\"dataBase64\":\"$PHOTO\",\"mime\":\"image/jpeg\"}")
assert_status "upload por NO dueño (sin rol) → 403" "$S" 403
BIG=$(python3 -c "print('A'*500000)")
printf '{"studentCode":"EST-P3","dataBase64":"%s","mime":"image/jpeg"}' "$BIG" > /tmp/p3_big.json
S=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/excuses/$EXC/attachment" -H 'Content-Type: application/json' --data-binary @/tmp/p3_big.json)
assert_status "payload > 400 KB base64 → 413" "$S" 413
S=$(ST POST "/api/excuses/$EXC/attachment" "{\"studentCode\":\"EST-P3\",\"dataBase64\":\"$PHOTO\",\"mime\":\"application/pdf\"}")
assert_status "mime no imagen → 400" "$S" 400

say "5. IV aleatorio: mismo contenido → ciphertext distinto"
B POST "/api/excuses/$EXC/attachment" "{\"studentCode\":\"EST-P3\",\"dataBase64\":\"$PHOTO2\",\"mime\":\"image/jpeg\"}" > /dev/null
STORED2=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT attachment_path AS p FROM student_excuses WHERE id='$EXC'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['p'] or '')")
if [ -n "$STORED2" ] && [ "$STORED2" != "$STORED" ]; then echo "  ✅ PASS — ciphertext cambió con el mismo contenido (IV fresh)"; PASS=$((PASS+1)); else echo "  ❌ FAIL — ciphertext idéntico (IV repetido?)"; FAIL=$((FAIL+1)); fi

say "6. La cadena de auditoría no se ve afectada por adjuntos"
R=$(B GET /api/excuses/verify-chain)
assert "verify-chain intact tras uploads (los adjuntos no son eventos de decisión)" "$R" "d['intact']==True and d['signed']==True"

say "7. P4 — Purga de retención (minimización, término+1 año)"
OLD=$(date -u -d '-13 months' +%F)
RECENT=$(date -u -d '-5 days' +%F)
RECENT2=$(date -u -d '-4 days' +%F)
# Excusa VIEJA (fuera de retención) + reciente (vigente) vinculada a un registro
cat > /tmp/seed_p4.sql <<EOF
INSERT INTO student_excuses (id, student_code, student_name, grade, start_date, end_date, reason, status, submitted_by, created_at) VALUES
 ('exc-vieja', 'EST-P3', 'Sofía Prueba3', '9°1', '${OLD}', '${OLD}', 'CITA_MEDICA', 'APROBADA', 'RECTORIA', '${OLD}T10:00:00Z'),
 ('exc-reciente', 'EST-P3', 'Sofía Prueba3', '9°1', '${RECENT}', '${RECENT2}', 'INCAPACIDAD', 'PENDIENTE', 'RECTORIA', '${RECENT}T10:00:00Z');
INSERT INTO attendance_records (id, student_code, student_name, document_id, grade, date, time, status, method, excuse_id) VALUES
 ('rec-vieja', 'EST-P3', 'Sofía Prueba3', '888001', '9°1', '${OLD}', '08:00', 'AUSENTE', 'AUTO_CIERRE', 'exc-vieja'),
 ('rec-rec', 'EST-P3', 'Sofía Prueba3', '888001', '9°1', '${RECENT}', '08:00', 'AUSENTE', 'AUTO_CIERRE', 'exc-reciente');
EOF
npx wrangler d1 execute inas_attendance_db --local --file=/tmp/seed_p4.sql -y >/dev/null 2>&1
R=$(B GET /api/excuses)
assert "GET dispara el sweep de retención y purga la excusa >12 meses" "$R" "d['success']==True and d.get('purgedThisSweep',0)>=1"
N=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM student_excuses WHERE id='exc-vieja'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "excusa vieja eliminada de D1 (con su attachment)" "$N" "int('$N')==0"
N=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM student_excuses WHERE id='exc-reciente'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "excusa reciente (dentro de retención) SE CONSERVA" "$N" "int('$N')==1"
N=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM attendance_records WHERE id='rec-vieja' AND excuse_id IS NULL" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "registro de la excusa purgada desvinculado (sin excuse_id huérfano)" "$N" "int('$N')==1"
N=$(npx wrangler d1 execute inas_attendance_db --local --command "SELECT COUNT(*) AS n FROM attendance_records WHERE id='rec-rec' AND excuse_id='exc-reciente'" -y --json 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['n'])")
assert "overlay de la excusa vigente intacto" "$N" "int('$N')==1"

say "Resumen P3"
echo "-------------------------------------"
echo "  PASS: $PASS   FAIL: $FAIL"
kill $WPID 2>/dev/null
pkill -f "wrangler dev" 2>/dev/null
[ $FAIL -eq 0 ] && echo "🎉 P3 VERDE" || echo "⚠️ hay fallos — revisar arriba"
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
