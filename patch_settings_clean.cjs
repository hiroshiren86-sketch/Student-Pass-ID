const fs = require('fs');
let content = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');

const wipeBtn = `              <button
                type="button"
                onClick={handleWipeForProduction}
                className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Vaciar todo el sistema para Producción"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Iniciar Limpio</span>
              </button>`;

if (content.includes('Trash2')) {
    content = content.replace(wipeBtn, '');
}

const wipeLogic = `  const handleWipeForProduction = () => {
    const promptStr = window.prompt('ATENCIÓN: Esto borrará ABSOLUTAMENTE TODOS los estudiantes, asistencias y docentes de esta terminal para iniciar en blanco. Esta acción es IRREVERSIBLE. Escribe "PRODUCCION" para confirmar:');
    if (promptStr === 'PRODUCCION') {
      AttendanceStorageService.wipeAllForProduction();
      window.alert('Sistema vaciado. Listo para Producción. Serás redirigido.');
      window.location.reload();
    }
  };`;

if (content.includes('handleWipeForProduction')) {
    content = content.replace(wipeLogic, '');
    fs.writeFileSync('src/components/SettingsModal.tsx', content);
    console.log("Removed wipe button from settings.");
}
