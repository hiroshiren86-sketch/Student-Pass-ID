const fs = require('fs');

let str = fs.readFileSync('AGENTS.md', 'utf8');

const newRound = `
### 🛠️ Ronda 14 (01/09/2026): Menú Flotante de Desarrollo (Dev Mod Menu) y Vaciado Completo
- **Corrección de Lógica "Iniciar Limpio":**
  1. El método anterior fallaba porque, al eliminar la llave de estudiantes del \`localStorage\`, la clase de almacenamiento (\`attendanceStorage.ts\`) autodetectaba que estaba vacío y volvía a inyectar toda la data de prueba en la siguiente llamada a \`getStudents()\`.
  2. *Solución:* \`wipeAllForProduction()\` ahora en lugar de usar \`removeItem\`, asigna explícitamente *arrays vacíos* (\`"[]"\`) a las llaves. Esto previene que se lance el disparador de *fallback* e inicie el sistema verdaderamente sin precargado de estudiantes (en cero).
- **Consolidación en "DevFloatingMenu" (Modo Debug):**
  1. Se eliminó el botón de "Iniciar Limpio" de la pantalla de Ajustes.
  2. Se retiró la barra fija inferior de credenciales en la pantalla de Login.
  3. Se creó un nuevo componente \`DevFloatingMenu.tsx\` que es un panel flotante, móvil (draggable), y minimizable en la vista de Login.
  4. Este panel consolida el acceso rápido a sesiones (Rectoría, Docente, Estudiante) y contiene el botón **"Iniciar sin precargado de estudiante"**.
  5. **ATENCIÓN PARA PRODUCCIÓN:** El archivo \`src/components/DevFloatingMenu.tsx\` y su llamado en \`src/components/LoginScreen.tsx\` están fuertemente comentados y marcados como código de **DEBUG / DEV**. Para la etapa final de producción oficial, basta con retirar la etiqueta \`<DevFloatingMenu />\` del \`LoginScreen\` y eliminar el archivo para que ningún usuario final pueda inyectar sesiones o vaciar el sistema.
`;

str += newRound;
fs.writeFileSync('AGENTS.md', str);
