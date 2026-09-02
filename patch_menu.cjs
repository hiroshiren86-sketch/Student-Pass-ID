const fs = require('fs');
let content = fs.readFileSync('src/components/DevFloatingMenu.tsx', 'utf8');

if (!content.includes('import { FirebaseService }')) {
    content = content.replace(
        "import { AttendanceStorageService } from '../services/attendanceStorage';", 
        "import { AttendanceStorageService } from '../services/attendanceStorage';\nimport { FirebaseService } from '../services/firebase';\nimport { CloudflareSyncService } from '../services/cloudflareSync';"
    );
}

const targetWipe = `  const handleWipeForProduction = () => {
    if (window.confirm('ATENCIÓN (MODO DEV): Se eliminará todo el contenido de prueba (estudiantes, profesores, horarios) para iniciar en blanco. ¿Continuar?')) {
      AttendanceStorageService.wipeAllForProduction();
      window.alert('Datos eliminados. El sistema iniciará sin precargado de estudiante/demo.');
      window.location.reload();
    }
  };`;

const newWipe = `  const handleWipeForProduction = async () => {
    if (window.confirm('ATENCIÓN (MODO DEV): Se eliminará todo el contenido de prueba LOCAL Y EN LA NUBE (Firebase y Cloudflare) para iniciar en blanco. ¿Continuar?')) {
      const originalText = document.getElementById('wipe-btn-text');
      if (originalText) originalText.innerText = 'Borrando (Local, Firebase y CF)...';
      
      // 1. Wipe local
      AttendanceStorageService.wipeAllForProduction();
      
      // 2. Wipe Firebase
      await FirebaseService.wipeProductionData();
      
      // 3. Wipe Cloudflare (push empty state & try D1 drop)
      await CloudflareSyncService.wipeCloudflareData();
      
      window.alert('Sistema vaciado por completo (Local + Nube). Listo para iniciar sin precargado de estudiante.');
      window.location.reload();
    }
  };`;

if (content.includes('AttendanceStorageService.wipeAllForProduction();') && !content.includes('FirebaseService.wipeProductionData')) {
    content = content.replace(targetWipe, newWipe);
    content = content.replace('<span>Iniciar sin precargado de estudiante</span>', '<span id="wipe-btn-text">Iniciar sin precargado de estudiante</span>');
    fs.writeFileSync('src/components/DevFloatingMenu.tsx', content);
    console.log("Updated DevFloatingMenu wipe logic");
}
