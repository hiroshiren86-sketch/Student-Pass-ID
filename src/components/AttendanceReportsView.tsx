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
  Sparkles
} from 'lucide-react';
import { AttendanceRecord, AttendanceSummary } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString } from '../services/attendanceStorage';
import { matchStudentFuzzy } from '../utils/searchHelper';

export const AttendanceReportsView: React.FC = () => {
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
          <div className="flex items-center gap-2 bg-white/80 dark:bg-slate-950/80 px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-xl">
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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
          <span className="text-[10px] text-emerald-600/80">{summary.attendanceRate}% de asistencia</span>
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
              className="w-full pl-10 pr-4 py-2.5 bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="px-3 py-2.5 bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold"
            >
              <option value="all">Todos los Cursos</option>
              {uniqueGrades.map(g => (
                <option key={g} value={g}>Curso {g}</option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2.5 bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold"
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase">
                  <th className="py-3 px-3">Hora</th>
                  <th className="py-3 px-3">Código QR/Barras</th>
                  <th className="py-3 px-3">Documento (ID)</th>
                  <th className="py-3 px-3">Estudiante</th>
                  <th className="py-3 px-3">Curso</th>
                  <th className="py-3 px-3">Tipo</th>
                  <th className="py-3 px-3">Estado</th>
                  <th className="py-3 px-3">Dispositivo</th>
                  <th className="py-3 px-3">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40">
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
                      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                        {r.type}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {r.status === 'PUNTUAL' ? (
                        <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                          Puntual
                        </span>
                      ) : r.status === 'AUSENTE' ? (
                        <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                          Ausente
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          Tardanza
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">
                      {r.method}
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-[11px] max-w-[200px] truncate">
                      {r.notes || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
