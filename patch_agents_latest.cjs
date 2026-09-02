const fs = require('fs');
let str = fs.readFileSync('AGENTS.md', 'utf8');

const additional = `
### 🛠️ Ronda 15 (01/09/2026): Eliminación de Residuos, Limpieza Cloud (Firebase/Cloudflare) y Zonas DEV
- **Corrección de Lógica "Iniciar Limpio" en la Nube:**
  1. Se detectó que el botón de vaciado para Producción sólo limpiaba el LocalStorage, pero no disparaba la eliminación en Firebase Firestore ni en Cloudflare D1/KV.
  2. *Solución:* Se programaron los métodos \`wipeProductionData()\` en \`FirebaseService\` y \`wipeCloudflareData()\` en \`CloudflareSyncService\`. El botón en el \`DevFloatingMenu\` ahora espera (\`await\`) a que se eliminen todas las colecciones (\`students\`, \`attendance_records\`, \`sync_snapshots\`) tanto en Firestore como en Cloudflare D1 (usando la API REST de Cloudflare o inyectando un *snapshot* vacío de reemplazo) antes de recargar la página.
- **Limpieza de Interfaz Oficial:**
  1. Se eliminó por completo el botón duplicado/obsoleto de "Iniciar Limpio" (papelera) que había quedado erróneamente en el modal de Ajustes.
  2. Todas las opciones de desarrollo, salto de login de pruebas y vaciado de base de datos ahora viven **exclusivamente** dentro de \`DevFloatingMenu.tsx\`.
- **Marcado de Zonas de Testeo (DEBUG/DEV):**
  1. El archivo \`src/components/DevFloatingMenu.tsx\` está fuertemente comentado como ZONA DEV.
  2. Instrucción de Producción: Para lanzar a producción, basta con borrar la etiqueta \`<DevFloatingMenu />\` en \`src/components/LoginScreen.tsx\` (marcada con comentarios) y el sistema quedará totalmente blindado para el usuario final.
`;

str += additional;
fs.writeFileSync('AGENTS.md', str);
