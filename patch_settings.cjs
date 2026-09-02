const fs = require('fs');

let str = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');

const target = `  const handleResetData = () => {
    if (window.confirm('¿Deseas reiniciar todos los registros de prueba y restaurar los 50 estudiantes y datos de ejemplo iniciales?')) {
      AttendanceStorageService.resetToDemo();
      onClose();
    }
  };`;

const replace = `  const handleResetData = () => {
    if (window.confirm('¿Deseas reiniciar todos los registros de prueba y restaurar los 50 estudiantes y datos de ejemplo iniciales?')) {
      AttendanceStorageService.resetToDemo();
      onClose();
    }
  };

  const handleWipeForProduction = () => {
    const promptStr = window.prompt('ATENCIÓN: Esto borrará ABSOLUTAMENTE TODOS los estudiantes, asistencias y docentes de esta terminal para iniciar en blanco. Esta acción es IRREVERSIBLE. Escribe "PRODUCCION" para confirmar:');
    if (promptStr === 'PRODUCCION') {
      AttendanceStorageService.wipeAllForProduction();
      window.alert('Sistema vaciado. Listo para Producción. Serás redirigido.');
      window.location.reload();
    }
  };`;

if (!str.includes('handleWipeForProduction')) {
    str = str.replace(target, replace);
}

const targetBtn = `<button
              type="button"
              onClick={handleResetData}
              className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reiniciar Demo</span>
            </button>`;

const replaceBtn = `<div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetData}
                className="px-3.5 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-slate-700 dark:text-slate-300 border border-slate-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
                title="Restaurar a datos de prueba"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              
              <button
                type="button"
                onClick={handleWipeForProduction}
                className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Vaciar todo el sistema para Producción"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Iniciar Limpio</span>
              </button>
            </div>`;

if (!str.includes('handleWipeForProduction}')) {
    str = str.replace(targetBtn, replaceBtn);
}
if(!str.includes('Trash2')) {
    str = str.replace("import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock } from 'lucide-react';", 
    "import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock, Trash2 } from 'lucide-react';");
}

fs.writeFileSync('src/components/SettingsModal.tsx', str);

