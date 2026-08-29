import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  BrainCircuit, 
  Users, 
  AlertTriangle, 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  Send, 
  RefreshCw, 
  BarChart3, 
  FileText, 
  HelpCircle,
  ChevronRight,
  School,
  ArrowUpRight
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Student, AttendanceRecord, GradeAiSummaryResult } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString } from '../services/attendanceStorage';

export const GradeAiSummaryView: React.FC = () => {
  const uniqueGrades = AttendanceStorageService.getUniqueGrades();
  const [selectedGrade, setSelectedGrade] = useState<string>(uniqueGrades[0] || '6°2');
  const [timeframe, setTimeframe] = useState<string>('month');
  const [customQuestion, setCustomQuestion] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GradeAiSummaryResult | null>(null);

  const quickPrompts = [
    `Dame un resumen conciso de ${selectedGrade}`,
    `¿Quiénes tienen más faltas y tardanzas en ${selectedGrade}?`,
    `Patrones de asistencia y días más críticos`,
    `Recomendaciones para coordinación académica`
  ];

  const fetchGradeSummary = async (queryPrompt?: string) => {
    setLoading(true);
    setError(null);

    const students = AttendanceStorageService.getStudentsByGrade(selectedGrade);
    const records = AttendanceStorageService.getAttendanceByGrade(selectedGrade);

    try {
      const response = await fetch('/api/ai/grade-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: selectedGrade,
          timeframe,
          customQuestion: queryPrompt || customQuestion || `Genera un resumen analítico relevante y conciso del curso ${selectedGrade}`,
          students,
          records
        })
      });

      if (!response.ok) {
        throw new Error(`Error en el servidor (${response.status})`);
      }

      const data = await response.json();
      if (data.success) {
        setResult(data);
      } else {
        throw new Error(data.error || 'No se pudo generar el análisis');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al conectar con el motor de IA.');
    } finally {
      setLoading(false);
    }
  };

  // Cargar automáticamente al cambiar de grado
  useEffect(() => {
    fetchGradeSummary();
  }, [selectedGrade, timeframe]);

  return (
    <div className="space-y-6 animate-fadeIn" id="grade-ai-summary-view">
      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-indigo-500" />
              IA Escolar • Gemini 3.7 Flash
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1.5">
            Analítica y Resúmenes con IA por Grado
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Consulta el estado pedagógico y de asistencia de cualquier curso (ej: 6°2, 10°1) en lenguaje natural con métricas directas y sin informes densos innecesarios.
          </p>
        </div>

        {/* Grade & Timeframe Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-white/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-1 shadow-xs">
            <span className="text-xs font-bold px-2.5 text-slate-500">Curso:</span>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-black outline-none transition-all cursor-pointer"
            >
              {uniqueGrades.map((g) => (
                <option key={g} value={g} className="bg-slate-900 text-white">
                  Grado {g}
                </option>
              ))}
            </select>
          </div>

          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="px-3 py-2 bg-white/80 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-700 dark:text-slate-200"
          >
            <option value="recent">Últimas Semanas</option>
            <option value="month">Mes Actual</option>
            <option value="quarter">Trimestre Académico</option>
          </select>

          <button
            onClick={() => fetchGradeSummary()}
            disabled={loading}
            className="p-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-2xl text-slate-700 dark:text-slate-300 disabled:opacity-50 transition-all"
            title="Actualizar análisis"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quick Prompts & Interactive Input */}
      <div className="glass-panel p-4 sm:p-5 rounded-3xl space-y-3">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
          <span>Consultas directas para el Grado {selectedGrade}:</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((prompt, i) => (
            <button
              key={i}
              onClick={() => {
                setCustomQuestion(prompt);
                fetchGradeSummary(prompt);
              }}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-100/80 dark:bg-slate-900/80 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-800 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 transition-all text-left flex items-center gap-1.5"
            >
              <span>{prompt}</span>
              <ArrowUpRight className="w-3 h-3 text-slate-400" />
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customQuestion.trim()) fetchGradeSummary();
          }}
          className="flex items-center gap-2 pt-1"
        >
          <input
            type="text"
            value={customQuestion}
            onChange={(e) => setCustomQuestion(e.target.value)}
            placeholder={`Escribe una pregunta para el Grado ${selectedGrade} (ej: ¿Cuántas inasistencias tuvo Juan David este mes?)...`}
            className="flex-1 px-4 py-2.5 bg-white/90 dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={loading || !customQuestion.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Consultar</span>
          </button>
        </form>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="glass-panel p-12 rounded-3xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto animate-pulse">
            <BrainCircuit className="w-6 h-6 animate-spin" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Analizando registros de asistencia para el Grado {selectedGrade}...
            </h3>
            <p className="text-xs text-slate-500">
              Gemini 3.7 Flash está sintetizando patrones, ausentismo y tendencias.
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="p-5 bg-rose-500/10 border border-rose-500/30 rounded-3xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <strong>Error al generar el análisis:</strong> {error}
            </div>
          </div>
          <button
            onClick={() => fetchGradeSummary()}
            className="px-3 py-1 bg-rose-600 text-white rounded-lg text-xs font-bold"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Main Results View */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Key Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="glass-panel p-4 rounded-3xl">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Estudiantes en {selectedGrade}</span>
                <Users className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {result.keyMetrics.totalStudents}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Matriculados activos</div>
            </div>

            <div className="glass-panel p-4 rounded-3xl">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Tasa de Asistencia</span>
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {result.keyMetrics.overallAttendanceRate}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Promedio del período</div>
            </div>

            <div className="glass-panel p-4 rounded-3xl">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Inasistencias</span>
                <AlertTriangle className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono">
                {result.keyMetrics.totalAbsences}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Faltas acumuladas</div>
            </div>

            <div className="glass-panel p-4 rounded-3xl">
              <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
                <span>Tardanzas</span>
                <Clock className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono">
                {result.keyMetrics.totalTardiness}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Ingresos tras 07:15 AM</div>
            </div>
          </div>

          {/* Executive Summary Card */}
          <div className="glass-panel p-5 rounded-3xl border-l-4 border-l-indigo-600 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                Resumen Ejecutivo para Docentes y Coordinación ({selectedGrade})
              </h3>
            </div>
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
              {result.summary}
            </p>
          </div>

          {/* Charts & Key Insights Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Attendance Distribution Chart */}
            <div className="glass-panel p-5 rounded-3xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Distribución de Asistencia ({selectedGrade})
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Puntuales vs Tardanzas</span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                        color: '#fff'
                      }} 
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Bar dataKey="puntuales" fill="#10b981" name="Puntuales" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="tardanzas" fill="#f59e0b" name="Tardanzas" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ausencias" fill="#f43f5e" name="Inasistencias" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Insights and Strategic Recommendations */}
            <div className="glass-panel p-5 rounded-3xl space-y-3.5">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Hallazgos y Acciones Recomendadas
                </h4>
              </div>

              <div className="space-y-2.5">
                {result.insights.map((insight, idx) => (
                  <div 
                    key={idx} 
                    className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/70 dark:border-slate-800 text-xs flex items-start gap-2.5"
                  >
                    <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <p className="text-slate-700 dark:text-slate-300 leading-normal">
                      {insight}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Frequent Absentees Table */}
          {result.frequentAbsentees && result.frequentAbsentees.length > 0 && (
            <div className="glass-panel p-5 rounded-3xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Estudiantes con Alerta de Inasistencias en {selectedGrade}
                  </h4>
                </div>
                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold px-2 py-0.5 bg-amber-500/10 rounded-full">
                  Atención Temprana
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase">
                      <th className="py-2.5 px-3">Estudiante</th>
                      <th className="py-2.5 px-3">Código</th>
                      <th className="py-2.5 px-3 text-center">Faltas Acumuladas</th>
                      <th className="py-2.5 px-3">Patrón / Observación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {result.frequentAbsentees.map((abs, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40">
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">
                          {abs.name}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">
                          {abs.code}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="px-2 py-0.5 rounded-full font-bold font-mono text-[11px] bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                            {abs.absencesCount} faltas
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                          {abs.reasonPattern}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
