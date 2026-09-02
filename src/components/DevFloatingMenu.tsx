import React, { useState, useEffect } from 'react';
import { KeyRound, RotateCcw, X, GripHorizontal, ShieldAlert, Monitor, ArrowRight, Save } from 'lucide-react';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';
import { CloudflareSyncService } from '../services/cloudflareSync';

interface DevFloatingMenuProps {
  onLoginSuccess: (role: any, userData?: any) => void;
}

export const DevFloatingMenu: React.FC<DevFloatingMenuProps> = ({ onLoginSuccess }) => {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(true);

  // ZONA DEBUG/DEV - COMPONENTE EXCLUSIVO DE TESTEO
  // ==================================================
  // ATENCIÓN: Este componente debe ser eliminado antes del paso a producción.
  // Su propósito es brindar atajos de sesión y limpieza de base de datos a los desarrolladores.
  
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
    // @ts-ignore
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    // @ts-ignore
    e.target.releasePointerCapture(e.pointerId);
  };

  const handleWipeForProduction = async () => {
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
  };

  return (
    <div 
      className="fixed z-[9999] bg-slate-900/95 dark:bg-black/90 text-white rounded-2xl border border-slate-700 shadow-2xl backdrop-blur-xl overflow-hidden flex flex-col transition-all"
      style={{ left: position.x, top: position.y, width: isExpanded ? '320px' : 'auto' }}
    >
      {/* Drag Handle */}
      <div 
        className="px-3 py-2 bg-indigo-600 dark:bg-zinc-900 flex items-center justify-between cursor-move select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <GripHorizontal className="w-4 h-4 text-white/50" />
          <span className="text-[10px] font-mono font-bold tracking-wider">DEV / DEBUG MENU</span>
        </div>
        <button 
          onClick={() => setIsExpanded(!isExpanded)} 
          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          title="Minimizar/Maximizar"
        >
          {isExpanded ? <X className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
        </button>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> Acceso Rápido
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => onLoginSuccess('ADMIN', { username: 'Rectoría / Admin' })}
                className="w-full px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-between"
              >
                <span>🛡️ Rectoría</span> <ArrowRight className="w-3 h-3 opacity-50" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const firstTeacher = AttendanceStorageService.getTeachers()[0];
                  onLoginSuccess('DOCENTE', { teacher: firstTeacher, username: firstTeacher?.fullName || 'Prof. Juan Pablo Pérez' });
                }}
                className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-between"
              >
                <span>👨‍🏫 Docente</span> <ArrowRight className="w-3 h-3 opacity-50" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const firstStudent = AttendanceStorageService.getStudents()[0];
                  onLoginSuccess('ESTUDIANTE_ACUDIENTE', { student: firstStudent, username: `${firstStudent?.firstName || 'Demo'} ${firstStudent?.lastName || 'Estudiante'}` });
                }}
                className="w-full px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-between"
              >
                <span>🎓 Estudiante</span> <ArrowRight className="w-3 h-3 opacity-50" />
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-700/50">
            <h4 className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" /> Operaciones Peligrosas
            </h4>
            <button
              type="button"
              onClick={handleWipeForProduction}
              className="w-full px-3 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span id="wipe-btn-text">Iniciar sin precargado de estudiante</span>
            </button>
            <p className="text-[9px] text-slate-400 leading-tight text-center px-2">
              Limpia la base de datos local y evita inyección de datos de demo (Testeo).
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
