import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Calendar, 
  Download, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  UserX, 
  TrendingUp, 
  FileSpreadsheet,
  Layers,
  ArrowUpDown,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { AttendanceRecord, AttendanceSummary, UserRole } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString } from '../services/attendanceStorage';
import { matchStudentFuzzy } from '../utils/searchHelper';
import { ExcuseJustifyModal } from './ExcuseJustifyModal'; // Ronda 21: justificación post-hoc de 1 toque

interface AttendanceReportsViewProps {
  currentRole?: UserRole;
  reviewedBy?: string;
}

export const AttendanceReportsView: React.FC<AttendanceReportsViewProps> = ({ currentRole = 'ADMIN', reviewedBy = 'RECTORIA' }) => {
  const isAdmin = currentRole === 'ADMIN';
  const [justifyRecord, setJustifyRecord] = useState<AttendanceRecord | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>(AttendanceStorageService.getSummary());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  const uniqueGrades = AttendanceStorageService.getUniqueGrades();

  const loadData = () => {
    const recs = AttendanceStorageService.getAttendanceByDate(selectedDate);
    setRecords(recs);
    setSummary(AttendanceStorageService.getSummary(selectedDate));
  };

  useEffect(() => {
    loadData();
    const unsub = AttendanceStorageService.subscribe(loadData);
    return unsub;
  }, [selectedDate]);

  // Filtros de tabla con búsqueda inteligente fuzzy
  const filteredRecords = records.filter(r => {
    const matchesSearch = matchStudentFuzzy(
      {
        firstName: r.studentName,
        lastName: '',
        code: r.studentCode,
        documentId: r.studentDocument,
        grade: r.studentGrade
      },
      searchQuery
    );
    const matchesGrade = selectedGrade === 'all' || r.studentGrade === selectedGrade;
    const matchesStatus = selectedStatus === 'all' || r.status === selectedStatus;

    return matchesSearch && matchesGrade && matchesStatus;
  });

  const handleExportCsv = () => {
    AttendanceStorageService.exportAttendanceCsv(selectedDate, filteredRecords);
  };

  // Ronda 25 (P2 del informe QA externo): píldora de estado extraída — la usan la tabla
  // (md+) y las tarjetas móviles, sin duplicar la lógica del overlay de excusas (§4.2/§5).
  const StatusPill: React.FC<{ r: AttendanceRecord }> = ({ r }) => {
    if (r.status === 'PUNTUAL') {
      return <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Puntual</span>;
    }
    if (r.status === 'AUSENTE') {
      /* Ronda 21 (spec §4.2): etiqueta derivada del overlay de excusas.
         La planilla JAMÁS muestra el motivo ni la foto (minimización §5). */
      if (r.excuseId) {
        return (
          <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1"
            title="Ausencia protegida por excusa — la decisión es de Rectoría">
            <ShieldCheck className="w-3 h-3" />
            {r.excuseStatus === 'APROBADA' ? 'Excusada (verificada)' : 'Excusada (bajo revisión)'}
          </span>
        );
      }
      return <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">Ausente</span>;
    }
    return <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">Tardanza</span>;
  };

  return (
    <div className="space-y-6 animate-fadeIn" id="attendance-reports-view">
      {/* Top Controls & Export */}
      <div className="glass-panel p-5 sm:p-6 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
            Consolidado Diario & Analítica
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
            Planilla y Registro de Asistencia
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-white/80 dark:bg-black/80 px-3 py-2 border border-slate-200 dark:border-zinc-800/50 rounded-xl">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-900 dark:text-white focus:outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={handleExportCsv}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2"
            title="Descargar planilla compatible con Microsoft Excel, Google Sheets y LibreOffice"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Descargar Planilla (Excel / CSV)</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
        <div className="glass-panel p-4 rounded-2xl space-y-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase">Matrícula Activa</span>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {summary.totalEnrolled}
          </div>
          <span className="text-[10px] text-slate-500">Estudiantes en sistema</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-emerald-500/30">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Presentes Hoy</span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {summary.totalPresent}
          </div>
          {/* Ronda 19 (BUG-2): sin registros la tasa es null → texto honesto en vez de un % inventado */}
          <span className="text-[10px] text-emerald-600/80">
            {summary.attendanceRate === null
              ? (summary.totalClassesToday === 0 ? 'Sin registros en esta fecha' : 'Matrícula activa vacía')
              : `${summary.attendanceRate}% de asistencia`}
          </span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-indigo-500/30">
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">Puntuales</span>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
            {summary.punctualCount}
          </div>
          <span className="text-[10px] text-indigo-600/80">Antes de 07:15 AM</span>
        </div>

        <div className="glass-panel p-4 rounded-2xl space-y-1 border-amber-500/30">
          <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase">Tardanzas</span>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {summary.tardyCount}
          </div>
          <span className="text-[10px] text-amber-600/80">Ingreso extemporáneo</span>
        </div>

        {/* Ronda 21 (spec §4.3): 4º número del resumen — ausencias protegidas por excusa.
            No sustituye a Ausentes: es la porción de las faltas que NO son injustificadas. */}
        <div className="glass-panel p-4 rounded-2xl space-y-1 border-emerald-400/30">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Justificadas</span>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {summary.justificados}
          </div>
          <span className="text-[10px] text-emerald-600/80">Ausencias con excusa vigente</span>
        </div>
      </div>

      {/* Filter and Table Panel */}
      <div className="glass-panel p-5 rounded-3xl space-y-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Filtrar por nombre, código o documento..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold"
            >
              <option value="all">Todos los Cursos</option>
              {uniqueGrades.map(g => (
                <option key={g} value={g}>Curso {g}</option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2.5 bg-white/80 dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-bold"
            >
              <option value="all">Todos los Estados</option>
              <option value="PUNTUAL">Puntuales</option>
              <option value="TARDANZA">Tardanzas</option>
              <option value="AUSENTE">Ausentes (Inasistencias)</option>
            </select>
          </div>
        </div>

        {/* Clean Responsive Table */}
        {filteredRecords.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No se encontraron registros de asistencia para los filtros seleccionados.
          </div>
        ) : (
          <>
          {/* Ronda 25 (P2, WCAG 1.4.10 Reflow): la tabla de 11 columnas vive solo en md+;
              en móvil las tarjetas de abajo son la vista de consulta rápida. */}
          <div className="hidden md:block w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800/50">
            <table className="w-full text-left text-xs min-w-[780px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-zinc-800/50 text-slate-400 font-bold uppercase">
                  <th className="py-3 px-3">Hora</th>
                  <th className="py-3 px-3">Código QR/Barras</th>
                  <th className="py-3 px-3">Documento (ID)</th>
                  <th className="py-3 px-3">Estudiante</th>
                  <th className="py-3 px-3">Curso</th>
                  {/* Ronda 19 (hallazgo 6 del informe): la data ya existía en cada registro (el CSV
                      export sí la traía) — faltaba en pantalla. Es la consulta central del docente. */}
                  <th className="py-3 px-3">Asignatura</th>
                  <th className="py-3 px-3">Tipo</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Dispositivo</th>
                  <th className="py-3 px-3">Notas</th>
                  {/* Ronda 21 (spec §7.2): acción de 1 toque — SOLO Rectoría (R5) */}
                  {isAdmin && <th className="py-3 px-3">Acción</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-100 dark:hover:bg-zinc-900/50 transition-colors group border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:shadow-sm">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                      {r.time}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {r.studentCode}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                      {r.studentDocument}
                    </td>
                    <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                      {r.studentName}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-md font-bold text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {r.studentGrade}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                        {r.subject || '—'}
                      </span>
                      {/* Ronda 19 — QR de Clase: transparencia del porqué de la vinculación (informe, sección 5.3) */}
                      {r.contextSource === 'QR_CLASE' && (
                        <span
                          className="ml-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border border-indigo-300/60 dark:border-indigo-700/60"
                          title={r.classQrVerified ? 'Vinculado por QR de Clase firmado (HMAC válido)' : 'Vinculado por QR de Clase'}
                        >
                          QR
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                        {r.type}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <StatusPill r={r} />
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {r.method}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[11px] max-w-[200px] truncate">
                      {r.notes || '-'}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-3">
                        {/* Solo AUSENTE sin excusa ofrece el 1 toque; ya justificada → el badge
                            verde lo indica y el botón desaparece (R2 impide la segunda excusa) */}
                        {r.status === 'AUSENTE' && !r.excuseId ? (
                          <button
                            onClick={() => setJustifyRecord(r)}
                            aria-label={`Justificar ausencia de ${r.studentName} el ${r.date}`}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black transition-all shadow-sm shadow-emerald-600/20 inline-flex items-center gap-1"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Justificar
                          </button>
                        ) : (
                          <span className="text-slate-300 dark:text-zinc-700 text-[11px]">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ronda 25 (P2): tarjetas móviles de la Planilla — la consulta en el teléfono es
              "¿quién no ha escaneado?" (nombre + curso + hora + estado + acción 1 toque R5).
              Las 11 columnas completas siguen en la tabla md+ y en el CSV/Excel (nada se pierde). */}
          <div className="md:hidden space-y-2.5" aria-label="Planilla de asistencia (vista móvil)">
            {filteredRecords.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-200 dark:border-zinc-800/50 bg-white dark:bg-zinc-950/60 p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate" title={r.studentName}>{r.studentName}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-md font-bold text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">{r.studentGrade}</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{r.time}</span>
                      {r.subject && <span className="text-indigo-700 dark:text-indigo-300 font-bold">· {r.subject}</span>}
                    </p>
                  </div>
                  <StatusPill r={r} />
                </div>
                {isAdmin && r.status === 'AUSENTE' && !r.excuseId && (
                  <button
                    onClick={() => setJustifyRecord(r)}
                    aria-label={`Justificar ausencia de ${r.studentName} el ${r.date}`}
                    className="mt-3 w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black transition-all shadow-sm shadow-emerald-600/20 inline-flex items-center justify-center gap-1"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Justificar
                  </button>
                )}
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      {/* Ronda 21: modal de 1 toque — la radicación dispara applyOverlay → notify →
          loadData (subscribe) y el badge "Excusada (bajo revisión)" aparece al instante */}
      {justifyRecord && (
        <ExcuseJustifyModal
          record={justifyRecord}
          onClose={() => setJustifyRecord(null)}
          onRadicated={() => setJustifyRecord(null)}
        />
      )}
    </div>
  );
};
