# INFORME QA — RONDA 56: SINCRONIZACIÓN TOTAL
## Diagnóstico y neutralización de los 3 bugs reportados por el propietario (10/09/2026)
**Commit:** `f95ec69` · **Bundle producción:** `index-DNTQlfdU.js` (verificado por marcadores) · **Ambiente:** `student-pass-id.pages.dev`, navegadores Chromium limpios (localStorage vacío = "teléfono nuevo"), zona America/Bogota

---

## 1. Diagnóstico (forense API + auditoría de código, ANTES de tocar nada)

**Lo que el propietario reportó vs. lo que la nube real tenía:**

| Reporte | Forense de la nube (pull ADMIN por API) | Causa raíz (código) |
|---|---|---|
| "La representante nueva no tiene rol en mi teléfono 2" | **El rol SÍ estaba en la nube**: CAMILA FELIPE ZAPATA CÓRDOBA (11°3) con `isRepresentative:true` — el push de Rectoría funcionó | El **auto-sync solo bajaba FACTS** (registros); el catálogo (roles) solo bajaba con Pull manual. Y el pull del login solo disparaba si la ficha local NO existía → un teléfono con catálogo viejo quedaba **congelado para siempre** |
| "Las tarjetas de clase dan 'tarjeta inválida / la firma no coincide'" | `qrSecret` **nunca viajó por ningún canal** (excluido del push y del respaldo Firebase por política antigua) | Cada terminal firma/verifica con SU secret (default de fábrica `INAS-HMAC-QR-SECRET-COL-2026` u otro) → firmas cruzadas **imposibles de verificar** |
| "Las plantillas personalizadas / fin de jornada no se sincronizan" | La nube SÍ tenía `dailyEndTime:18:30` (fijado por el propietario esa mañana) | `pullFromCloudflare` **nunca aplicaba `data.settings`** — subía settings pero jamás los bajaba |

## 2. Fix (Ronda 56, `src/services/cloudflareSync.ts` + `src/components/LoginScreen.tsx`)

1. **El pull AHORA aplica settings** (`applyCloudSettingsToDevice`) con exclusión de campos POR-DISPOSITIVO (URL del Worker, tokens, clave IA, cursores, sellos): todo lo institucional (jornada, plantilla activa, tolerancia, **qrSecret**) baja y converge; lo personal de cada terminal jamás se pisa.
2. **El qrSecret VIAJA en el snapshot** (política actualizada): es un secreto institucional COMPARTIDO por diseño (todas las terminales verifican las mismas firmas HMAC). Solo el push de ADMIN lo fija (el Worker descarta settings de pushes OPERATOR/identidad — verificado en `index.ts`). Se mantienen excluidos: sessionSecret, tokens, claves IA.
3. **Pull SIEMPRE en login docente/estudiante** con **UPSERT para snapshots scopeados** (`upsertBy`): la porción del grado pisa/añade sin destruir la matrícula local (antes el snapshot scopeado podía REEMPLAZAR el catálogo completo del teléfono con 38 estudiantes).
4. **Auto-sync de Rectoría push→Pull COMPLETO** cada ciclo (antes solo `scope=facts`): convergencia bidireccional automática sin intervención.
5. **Pull silencioso al login de los 3 roles** (Rectoría: fire-and-forget).

## 3. Verificación E2E en producción — **22/22 PASS** (`qa_r56_sync.mjs`)

| Fase | Prueba | Resultado |
|---|---|---|
| F0 | Nube pre: catálogo v25, qrSecret ausente; Andrés con tempPassword legible | ✅ |
| F1-A | **Rectoría en navegador LIMPIO**: login → pull silencioso → `dailyEndTime=18:30` APLICADO, `tmpl-normal`, 80 estudiantes verbatim, qrSecret local presente | ✅ ×5 |
| F1-B | Push por UI → **la nube queda con el qrSecret institucional** (len 64) | ✅ |
| F1-C | Regresión R55: chips de asignaturas intactos | ✅ |
| F2 | **DOCENTE real (Andrés) en navegador LIMPIO** = "el teléfono 2": login con clave temporal → settings 18:30 aplicadas, **qrSecret idéntico al de Rectoría** (`coincide=true`), **★ CAMILA (11°3) CON su rol de representante** (el caso exacto del propietario), UPSERT: su ficha (teachers=1 scopeado), 38 estudiantes de su porción SIN destruir nada, 90 cátedras + 8 bloques hidratados | ✅ ×7 |
| F3-★ | **Tarjeta CLASE:v2 firmada con el secret SINCRONIZADO (HMAC real generado en Node): firma VÁLIDA** — pasa el check criptográfico y llega a las validaciones siguientes (captura `r56_F3_firma_ok.png`: banner "Jornada abierta (07:30 – 18:30)" en navegador limpio + "No hay clase en curso" = guarda legítima de bloques, NO error de firma) | ✅ |
| F3-★ | **Tarjeta firmada con un secret ajeno: RECHAZADA** por "firma no coincide" (el check es real, no decorativo) | ✅ |
| F4 | Restauración neutral de la nube (qrSecret:''), nube intacta 80/20/180/2 + rol Camila | ✅ ×3 |
| — | Cero errores JS de página en las 3 sesiones | ✅ |

## 4. Prueba de resistencia (auto-sync sin intervención) — `qa_r56_autosync_soak.mjs`

Rectoría abierta 7+ minutos en navegador limpio: el intervalo de auto-sync (5 min) ejecuta el ciclo push→Pull COMPLETO; el estado local se mantiene sano (80 estudiantes, jornada 18:30, catálogo al día). Resultado: ver log en la adenda de AGENTS.md.

## 5. Estado final de producción (post-QA)

- Nube: **80 estudiantes / 20 docentes / 180 cátedras / 2 registros / Plantilla A / jornada 07:30–18:30** — restaurada NEUTRA (sin qrSecret) para que el teléfono real de Rectoría fije el canónico con su próximo push (ver instrucciones al propietario).
- Artefactos: ninguno nuevo permanente (los contexts de prueba eran limpios y se descartaron; el push F1 y el push de restauración F4 usaron opIds únicos).
- 0 errores JS. Scripts reproducibles sin credenciales embebidas (se leen de `.env` gitignored).

## 6. Resultado del soak (ejecución real 10/09/2026)

```
catalogVersion local inicial: 30
esperando 7 min (2 ciclos de auto-sync de 5 min)...
catalogVersion local final: 32
students locales: 80 | dailyEndTime: 18:30 | activeDayTemplate: tmpl-normal
PASS · auto-sync push→pull completo ejecutó sin intervención y el estado local sigue sano
```

El catálogo local del navegador de prueba avanzó de v30 a v32 SOLO (ciclos automáticos del intervalo de 5 min), trayendo cambios de la nube sin intervención humana, con la matrícula (80) y la jornada (18:30) íntegras.
