import React, { useState, useMemo, useEffect } from 'react';
import { 
  BookOpen, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Users, 
  ShieldCheck, 
  Sparkles, 
  Save, 
  RefreshCw, 
  Calendar, 
  FileText, 
  Check, 
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Filter
} from 'lucide-react';
import { Student, AttendanceRecord, SchoolSettings, Teacher } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString, getCurrentTimeString } from '../services/attendanceStorage';

interface TeacherClassroomViewProps {
  teacher?: Teacher;
  teacherName?: string;
}

export const TeacherClassroomView: React.FC<TeacherClassroomViewProps> = ({ 
  teacher,
  teacherName = 'Prof. Juan Pablo Pérez' 
}) => {
  const [students, setStudents] = useState<Student[]>(AttendanceStorageService.getStudents());
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [records, setRecords] = useState<AttendanceRecord[]>(AttendanceStorageService.getAllAttendance());
  const scheduleSlots = AttendanceStorageService.getScheduleSlots().filter(s => s.type === 'CLASS');
  const allAssignments = AttendanceStorageService.getScheduleAssignments();
  
  const uniqueGrades = AttendanceStorageService.getUniqueGrades();
  const [selectedGrade, setSelectedGrade] = useState<string>(teacher?.assignedGrades?.[0] || uniqueGrades[0] || '10°1');
  const [selectedSubject, setSelectedSubject] = useState<string>(teacher?.subjects?.[0] || 'Matemáticas');
  const [selectedPeriod, setSelectedPeriod] = useState<string>(
    scheduleSlots[0] ? `${scheduleSlots[0].name} (${scheduleSlots[0].startTime} - ${scheduleSlots[0].endTime})` : '1ª Hora (07:00 - 07:45)'
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Detect if current day has double blocks for this grade
  const currentDayOfWeek = new Date().getDay() || 1; // 1 = Lunes
  const gradeDayAssignments = useMemo(() => {
    return allAssignments.filter(a => a.grade === selectedGrade && a.dayOfWeek === currentDayOfWeek);
  }, [allAssignments, selectedGrade, currentDayOfWeek]);

  // Classroom roll-call local state: Map of studentCode -> boolean (isInRoom)
  const [inRoomStatus, setInRoomStatus] = useState<Record<string, boolean>>({});
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [savedRecordsHistory, setSavedRecordsHistory] = useState<any[]>([]);

  const today = getTodayDateString();

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setStudents(AttendanceStorageService.getStudents());
      setSettings(AttendanceStorageService.getSettings());
      setRecords(AttendanceStorageService.getAllAttendance());
    });
    return unsubscribe;
  }, []);

  // Filter students by selected grade
  const gradeStudents = useMemo(() => {
    return students.filter(s => s.grade === selectedGrade && s.active);
  }, [students, selectedGrade]);

  // Today gate attendance map for fast lookup: studentCode -> AttendanceRecord
  const todayGateRecordsMap = useMemo(() => {
    const todayGate = records.filter(r => r.date === today && r.type === 'ENTRADA');
    const map = new Map<string, AttendanceRecord>();
    todayGate.forEach(r => map.set(r.studentCode, r));
    return map;
  }, [records, today]);

  // Initialize inRoomStatus when grade changes: By default, if the student entered gate, mark inRoom as true
  useEffect(() => {
    const initialMap: Record<string, boolean> = {};
    gradeStudents.forEach(s => {
      const gateRec = todayGateRecordsMap.get(s.code);
      initialMap[s.code] = !!gateRec; // Pre-mark as inRoom if passed gate
    });
    setInRoomStatus(initialMap);
  }, [selectedGrade, gradeStudents, todayGateRecordsMap]);

  const toggleStudentRoom = (code: string) => {
    setInRoomStatus(prev => ({
      ...prev,
      [code]: !prev[code]
    }));
  };

  const markAllGatePresent = () => {
    const updated: Record<string, boolean> = {};
    gradeStudents.forEach(s => {
      const gateRec = todayGateRecordsMap.get(s.code);
      updated[s.code] = !!gateRec;
    });
    setInRoomStatus(updated);
    setToastMessage('Se sincronizó la lista de aula con el ingreso verificado en portería.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const markAllPresent = () => {
    const updated: Record<string, boolean> = {};
    gradeStudents.forEach(s => {
      updated[s.code] = true;
    });
    setInRoomStatus(updated);
    setToastMessage('Todos los estudiantes del curso han sido marcados como presentes en aula.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Metrics computation
  const metrics = useMemo(() => {
    let gatePunctual = 0;
    let gateTardy = 0;
    let gateAbsent = 0;
    let inRoomCount = 0;
    let alertGateWithoutRoom = 0; // Passed gate but teacher unchecked them in room

    gradeStudents.forEach(s => {
      const gateRec = todayGateRecordsMap.get(s.code);
      const isRoom = inRoomStatus[s.code] ?? false;

      if (gateRec) {
        if (gateRec.status === 'PUNTUAL') gatePunctual++;
        else if (gateRec.status === 'TARDANZA') gateTardy++;

        if (!isRoom) {
          alertGateWithoutRoom++;
        }
      } else {
        gateAbsent++;
      }

      if (isRoom) inRoomCount++;
    });

    return {
      total: gradeStudents.length,
      gatePunctual,
      gateTardy,
      gateAbsent,
      inRoomCount,
      alertGateWithoutRoom
    };
  }, [gradeStudents, todayGateRecordsMap, inRoomStatus]);

  const handleSaveClassroomRecord = () => {
    const now = getCurrentTimeString();
    const classroomReport = {
      id: `class-${Date.now()}`,
      date: today,
      time: now,
      grade: selectedGrade,
      subject: selectedSubject,
      period: selectedPeriod,
      teacher: teacherName,
      metrics,
      details: gradeStudents.map(s => {
        const gateRec = todayGateRecordsMap.get(s.code);
        return {
          code: s.code,
          documentId: s.documentId,
          name: `${s.firstName} ${s.lastName}`,
          gateStatus: gateRec ? gateRec.status : 'NO_INGRESO',
          gateTime: gateRec ? gateRec.time : undefined,
          inRoom: inRoomStatus[s.code] ?? false,
          obs: observations[s.code] || ''
        };
      })
    };

    setSavedRecordsHistory(prev => [classroomReport, ...prev]);
    setToastMessage(`¡Planilla de clase guardada! Grado ${selectedGrade} - ${selectedSubject} (${metrics.inRoomCount}/${metrics.total} presentes).`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="space-y-6 animate-fadeIn" id="teacher-classroom-view">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3.5 rounded-2xl bg-indigo-600 text-white font-bold text-xs flex items-center justify-between shadow-xl animate-fadeIn">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="p-1 hover:opacity-80">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Banner: Teacher Header */}
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 uppercase tracking-wider">
              Módulo Docente • Control de Aula
            </span>
            <span className="text-[11px] font-mono text-slate-500 font-bold">
              {today}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            Asistencia en Salón de Clases
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Compara en tiempo real los estudiantes que entraron por portería frente a los presentes en tu aula.
          </p>
        </div>

        {/* Teacher Controls: Grade & Subject Selectors */}
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
          {/* Grade Selector */}
          <div className="flex-1 sm:flex-initial">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Curso / Salón
            </label>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-black text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              {uniqueGrades.map(g => (
                <option key={g} value={g}>Grado {g}</option>
              ))}
            </select>
          </div>

          {/* Subject Selector */}
          <div className="flex-1 sm:flex-initial">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Asignatura
            </label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="Matemáticas">Matemáticas</option>
              <option value="Lengua Castellana">Lengua Castellana</option>
              <option value="Ciencias Naturales">Ciencias Naturales</option>
              <option value="Ciencias Sociales">Ciencias Sociales</option>
              <option value="Inglés">Inglés</option>
              <option value="Física">Física</option>
              <option value="Química">Química</option>
              <option value="Tecnología e Informática">Tecnología e Informática</option>
              <option value="Educación Física">Educación Física</option>
              <option value="Dirección de Grupo">Dirección de Grupo</option>
            </select>
          </div>

          {/* Period Selector */}
          <div className="flex-1 sm:flex-initial">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Horario / Bloque
            </label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
            >
              {scheduleSlots.map(s => (
                <option key={s.id} value={`${s.name} (${s.startTime} - ${s.endTime})`}>
                  {s.name} ({s.startTime} - {s.endTime})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Metrics Row: Comparison between Gate and Classroom */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Matriculados */}
        <div className="p-4 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Matriculados</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.total}
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
            Estudiantes en grado {selectedGrade}
          </p>
        </div>

        {/* Ingresaron por Portería */}
        <div className="p-4 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">En Colegio (Portería)</span>
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {metrics.gatePunctual + metrics.gateTardy} <span className="text-xs text-slate-400 font-bold">/ {metrics.total}</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {metrics.gatePunctual} puntuales • {metrics.gateTardy} con retardo
          </p>
        </div>

        {/* Confirmados en Salón */}
        <div className="p-4 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-xs">
          <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400">
            <span className="text-[11px] font-bold uppercase tracking-wider">Presentes en Aula</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
            {metrics.inRoomCount} <span className="text-xs text-slate-400 font-bold">/ {metrics.total}</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {Math.round((metrics.inRoomCount / (metrics.total || 1)) * 100)}% de asistencia en clase
          </p>
        </div>

        {/* Alerta de Fuga / Deserción de Aula */}
        <div className={`p-4 rounded-3xl border backdrop-blur-xl shadow-xs transition-all ${
          metrics.alertGateWithoutRoom > 0 
            ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300' 
            : 'bg-white/70 dark:bg-slate-900/70 border-slate-200/80 dark:border-slate-800 text-slate-400'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider">Alerta de Aula</span>
            <AlertTriangle className={`w-4 h-4 ${metrics.alertGateWithoutRoom > 0 ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`} />
          </div>
          <div className={`text-2xl font-black mt-1 ${metrics.alertGateWithoutRoom > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
            {metrics.alertGateWithoutRoom}
          </div>
          <p className="text-[10px] mt-0.5 font-medium leading-tight">
            {metrics.alertGateWithoutRoom > 0 ? 'Entraron a portería pero no están en clase' : 'Sin inconsistencias de aula'}
          </p>
        </div>
      </div>

      {/* Classroom Table and Action Toolbar */}
      <div className="p-5 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-4">
        {/* Quick Batch Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              Lista de Estudiantes — {selectedGrade} ({selectedSubject})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Haz clic en el botón de estado para alternar asistencia en el salón.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={markAllGatePresent}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-1.5"
              title="Copiar los que ya entraron por portería automáticamente"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
              <span>Sincronizar con Portería</span>
            </button>

            <button
              onClick={markAllPresent}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Marcar Todos Presentes</span>
            </button>

            <button
              onClick={handleSaveClassroomRecord}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Guardar Planilla de Aula</span>
            </button>
          </div>
        </div>

        {/* Student Row List */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Estudiante</th>
                <th className="py-3 px-3">Identificación (TI / Doc)</th>
                <th className="py-3 px-3">Paso por Portería</th>
                <th className="py-3 px-3 text-center">Estado en Aula</th>
                <th className="py-3 px-3">Observaciones de Clase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {gradeStudents.map((std) => {
                const gateRec = todayGateRecordsMap.get(std.code);
                const isInRoom = inRoomStatus[std.code] ?? false;
                const isDiscrepancy = !!gateRec && !isInRoom; // Passed gate but not in room

                return (
                  <tr 
                    key={std.code} 
                    className={`transition-colors ${
                      isDiscrepancy 
                        ? 'bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-50/60' 
                        : 'hover:bg-slate-50/50 dark:hover:bg-slate-950/40'
                    }`}
                  >
                    {/* Estudiante */}
                    <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0 ${
                          isInRoom 
                            ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}>
                          {std.firstName.charAt(0)}{std.lastName.charAt(0)}
                        </div>
                        <div>
                          <span>{std.lastName} {std.firstName}</span>
                          {isDiscrepancy && (
                            <span className="block text-[9px] text-rose-600 dark:text-rose-400 font-bold animate-pulse">
                              ⚠️ En portería a las {gateRec.time} (Ausente en salón)
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Identificación */}
                    <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold mr-1.5">
                        {std.documentType || 'TI'}
                      </span>
                      {std.documentId}
                    </td>

                    {/* Paso por Portería */}
                    <td className="py-3 px-3">
                      {gateRec ? (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>{gateRec.time} ({gateRec.status})</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Sin registro en portería</span>
                        </div>
                      )}
                    </td>

                    {/* Toggle Estado en Aula */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => toggleStudentRoom(std.code)}
                        className={`px-4 py-1.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 mx-auto shadow-xs ${
                          isInRoom
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                            : 'bg-rose-100 hover:bg-rose-200 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {isInRoom ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Presente</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Ausente</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Observación de Clase */}
                    <td className="py-3 px-3">
                      <input
                        type="text"
                        placeholder="Ej: Permiso enfermería..."
                        value={observations[std.code] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setObservations(prev => ({ ...prev, [std.code]: val }));
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Historial de Planillas Guardadas en esta Sesión */}
      {savedRecordsHistory.length > 0 && (
        <div className="p-5 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Planillas de Aula Guardadas en la Sesión ({savedRecordsHistory.length})
            </h3>
          </div>

          <div className="space-y-2">
            {savedRecordsHistory.map((rep) => (
              <div 
                key={rep.id}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    Grado {rep.grade} • {rep.subject}
                  </span>
                  <span className="text-slate-400 ml-2">
                    ({rep.period}) • Guardado a las {rep.time}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {rep.metrics.inRoomCount}/{rep.metrics.total} Presentes
                  </span>
                  {rep.metrics.alertGateWithoutRoom > 0 && (
                    <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-600 text-[10px] font-bold">
                      {rep.metrics.alertGateWithoutRoom} Alertas de Aula
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
