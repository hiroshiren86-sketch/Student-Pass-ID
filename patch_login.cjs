const fs = require('fs');

let str = fs.readFileSync('src/components/LoginScreen.tsx', 'utf8');

const targetOldBar = `      {/* Floating Quick Test Login Bar */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 text-white p-2.5 sm:p-3 rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-xl flex items-center gap-2 max-w-full overflow-x-auto">
        <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0 flex items-center gap-1">
          <KeyRound className="w-3 h-3 text-indigo-400" /> ACCESO RÁPIDO DE PRUEBAS:
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onLoginSuccess('ADMIN', { username: 'Rectoría / Admin' });
            }}
            className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition-all shadow-xs flex items-center gap-1"
          >
            🛡️ Rectoría
          </button>
          <button
            type="button"
            onClick={() => {
              const firstTeacher = AttendanceStorageService.getTeachers()[0];
              onLoginSuccess('DOCENTE', { teacher: firstTeacher, username: firstTeacher?.fullName || 'Prof. Juan Pablo Pérez' });
            }}
            className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-all shadow-xs flex items-center gap-1"
          >
            👨‍🏫 Docente
          </button>
          <button
            type="button"
            onClick={() => {
              const firstStudent = AttendanceStorageService.getStudents()[0];
              onLoginSuccess('ESTUDIANTE_ACUDIENTE', { student: firstStudent, username: \`\${firstStudent?.firstName} \${firstStudent?.lastName}\` });
            }}
            className="px-2.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold transition-all shadow-xs flex items-center gap-1"
          >
            🎓 Estudiante
          </button>
        </div>
      </div>`;

if (str.includes(targetOldBar)) {
    str = str.replace(targetOldBar, '      {/* ZONA DEBUG: DevFloatingMenu Inyectado */} \n      <DevFloatingMenu onLoginSuccess={onLoginSuccess} />');
}

// Add import
if (!str.includes('DevFloatingMenu')) {
    str = str.replace("import { KeyRound, Mail, Lock, ArrowRight, User } from 'lucide-react';", "import { KeyRound, Mail, Lock, ArrowRight, User } from 'lucide-react';\nimport { DevFloatingMenu } from './DevFloatingMenu';");
}

fs.writeFileSync('src/components/LoginScreen.tsx', str);
console.log("Patched login screen.");
