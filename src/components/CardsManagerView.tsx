import React, { useState, useEffect, useMemo } from 'react';
import { 
  CreditCard, 
  Download, 
  Users, 
  Layers, 
  Printer, 
  CheckSquare, 
  Square, 
  FileCheck, 
  Search, 
  Sparkles,
  QrCode,
  ArrowRight,
  CheckCircle2,
  Eye
} from 'lucide-react';
import { Student, SchoolSettings } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { generateStudentCardPdf, generateBatchCardsPdf, downloadPdfBlob } from '../utils/pdfGenerator';
import { matchStudentFuzzy } from '../utils/searchHelper';
import { generateBarcodeDataUrl } from '../utils/barcode';

export const CardsManagerView: React.FC = () => {
  const [students, setStudents] = useState<Student[]>(AttendanceStorageService.getStudents());
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [uniqueGrades, setUniqueGrades] = useState<string[]>(AttendanceStorageService.getUniqueGrades());

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setStudents(AttendanceStorageService.getStudents());
      setSettings(AttendanceStorageService.getSettings());
      setUniqueGrades(AttendanceStorageService.getUniqueGrades());
    });
    return unsubscribe;
  }, []);

  const [selectedGrade, setSelectedGrade] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStudentCodes, setSelectedStudentCodes] = useState<string[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [previewStudent, setPreviewStudent] = useState<Student | null>(students[0] || null);

  // Filtrar estudiantes con búsqueda inteligente fuzzy
  const filteredStudents = useMemo(() => {
    return students.filter(std => {
      const matchesGrade = selectedGrade === 'all' || std.grade === selectedGrade;
      const matchesSearch = matchStudentFuzzy(std, searchQuery);
      return matchesGrade && matchesSearch;
    });
  }, [students, selectedGrade, searchQuery]);

  // Si cambia el filtro y el preview actual no existe, seleccionar el primero disponible
  useEffect(() => {
    if (filteredStudents.length > 0) {
      if (!previewStudent || !filteredStudents.some(s => s.code === previewStudent.code)) {
        setPreviewStudent(filteredStudents[0]);
      }
    }
  }, [filteredStudents]);

  const handleSelectAll = () => {
    if (selectedStudentCodes.length === filteredStudents.length) {
      setSelectedStudentCodes([]);
    } else {
      setSelectedStudentCodes(filteredStudents.map(s => s.code));
    }
  };

  const toggleSelectStudent = (code: string) => {
    if (selectedStudentCodes.includes(code)) {
      setSelectedStudentCodes(selectedStudentCodes.filter(c => c !== code));
    } else {
      setSelectedStudentCodes([...selectedStudentCodes, code]);
    }
  };

  // Descargar un solo carné PDF
  const handleDownloadSinglePdf = async (student: Student) => {
    setIsGeneratingPdf(true);
    try {
      const pdfBytes = await generateStudentCardPdf(student, settings);
      downloadPdfBlob(pdfBytes, `Carne_${student.code}_${student.firstName}_${student.lastName}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error al generar el carné en PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Descargar lote de estudiantes filtrados o seleccionados
  const handleDownloadBatchPdf = async (customTargets?: Student[]) => {
    const targets = customTargets || students.filter(s => selectedStudentCodes.includes(s.code));
    if (targets.length === 0) {
      alert('Seleccione al menos un estudiante para generar el lote.');
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const pdfBytes = await generateBatchCardsPdf(targets, settings);
      const suffix = selectedGrade !== 'all' ? `_${selectedGrade}` : '';
      downloadPdfBlob(pdfBytes, `Lote_Carnes_${targets.length}_Estudiantes${suffix}_IEDSJ_2026.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error al generar el lote en PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn" id="cards-manager-view">
      {/* Workflow Explainer Card */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-500/10 via-slate-500/5 to-emerald-500/10 border border-indigo-500/20 dark:border-indigo-500/30 rounded-3xl">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
            Flujo Físico y Digital de Identificación Escolar
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-2xl border border-slate-200/70 dark:border-slate-800 flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">1</span>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Registro Manual</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">Se ingresan nombres, documento y curso del estudiante.</p>
            </div>
          </div>
          <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-2xl border border-indigo-200 dark:border-indigo-500/40 flex items-start gap-3 shadow-xs">
            <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-black text-xs flex items-center justify-center shrink-0">2</span>
            <div>
              <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">Generar & Imprimir (PDF)</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">Descarga el carné formato tarjeta CR80 para PVC o termo-plastificado.</p>
            </div>
          </div>
          <div className="p-3 bg-white/70 dark:bg-slate-900/60 rounded-2xl border border-slate-200/70 dark:border-slate-800 flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0">3</span>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">Escaneo de Asistencia</div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5">El lector USB o cámara lee el código y registra la asistencia al instante.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Bar */}
      <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
            Módulo de Emisión Criptográfica • CR80 (85.6 x 53.98 mm)
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5">
            Generador e Impresor de Carnés en PDF
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Produce archivos PDF listos para imprimir en impresoras térmicas de tarjetas (Zebra, Evolis, Datacard) o en hojas A4 para recortar y plastificar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {selectedGrade !== 'all' && (
            <button
              onClick={() => handleDownloadBatchPdf(filteredStudents)}
              disabled={isGeneratingPdf || filteredStudents.length === 0}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Descargar Grado {selectedGrade} ({filteredStudents.length} PDF)</span>
            </button>
          )}

          <button
            onClick={() => handleDownloadBatchPdf(students)}
            disabled={isGeneratingPdf}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Descargar Todos ({students.length} Carnés PDF)</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Student Selector & Batch Actions */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-panel p-4 sm:p-5 rounded-3xl space-y-4">
            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, código o documento..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="px-3 py-2 bg-white/80 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold"
                >
                  <option value="all">Todos los Cursos ({students.length})</option>
                  {uniqueGrades.map(g => (
                    <option key={g} value={g}>Grado {g}</option>
                  ))}
                </select>

                <button
                  onClick={handleSelectAll}
                  className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  {selectedStudentCodes.length === filteredStudents.length && filteredStudents.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400" />
                  )}
                  <span>Marcar ({selectedStudentCodes.length})</span>
                </button>
              </div>
            </div>

            {/* Batch Action Bar if selected */}
            {selectedStudentCodes.length > 0 && (
              <div className="p-3.5 bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl flex flex-wrap items-center justify-between gap-2 animate-fadeIn">
                <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  {selectedStudentCodes.length === 1 
                    ? '1 estudiante seleccionado' 
                    : `${selectedStudentCodes.length} estudiantes seleccionados`}
                </span>
                <button
                  onClick={() => handleDownloadBatchPdf()}
                  disabled={isGeneratingPdf}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>
                    {selectedStudentCodes.length === 1 
                      ? 'Descargar Carné Seleccionado (PDF)' 
                      : `Descargar Lote (${selectedStudentCodes.length} Carnés PDF)`}
                  </span>
                </button>
              </div>
            )}

            {/* Student List */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[500px] overflow-y-auto pr-1">
              {filteredStudents.map((std) => {
                const isSelected = selectedStudentCodes.includes(std.code);
                const isPreview = previewStudent?.code === std.code;

                return (
                  <div
                    key={std.code}
                    className={`py-3 px-3 rounded-2xl flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                      isPreview 
                        ? 'bg-indigo-50/70 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30' 
                        : 'hover:bg-slate-50 dark:hover:bg-slate-950/40'
                    }`}
                    onClick={() => setPreviewStudent(std)}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSelectStudent(std.code);
                        }}
                        className="text-slate-400 hover:text-indigo-600"
                        title={isSelected ? "Deseleccionar" : "Seleccionar"}
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-indigo-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>

                      <div>
                        <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{std.firstName} {std.lastName}</span>
                          {isPreview && (
                            <span className="text-[10px] px-1.5 py-0.2 bg-indigo-600 text-white rounded-md font-semibold lg:hidden">
                              En Vista
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2 mt-0.5">
                          <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 font-bold rounded">
                            {std.grade}
                          </span>
                          <span>•</span>
                          <span>CÓD: {std.code}</span>
                          <span>•</span>
                          <span>DOC: {std.documentId}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewStudent(std);
                        }}
                        className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 ${
                          isPreview 
                            ? 'bg-indigo-600 text-white shadow-xs' 
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                        title="Ver en previsualizador CR80"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Previsualizar</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadSinglePdf(std);
                        }}
                        className="px-2.5 py-1 hover:bg-indigo-600 hover:text-white text-indigo-600 dark:text-indigo-400 rounded-lg border border-indigo-200 dark:border-indigo-800/80 transition-all text-[11px] font-bold flex items-center gap-1"
                        title="Descargar carné individual PDF"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">PDF</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Col: Live Physical Card Preview (Front & Back) */}
        <div className="space-y-4">
          <div className="glass-panel p-5 rounded-3xl space-y-4 sticky top-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Previsualización CR80
                </h3>
              </div>
              {previewStudent && (
                <button
                  onClick={() => handleDownloadSinglePdf(previewStudent)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Descargar PDF
                </button>
              )}
            </div>

            {previewStudent ? (
              <div className="space-y-4">
                {/* Visual Front Card - Colombian Digital ID Aesthetic */}
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-white border-2 border-slate-300 dark:border-slate-700 shadow-xl p-3 flex flex-col justify-between relative overflow-hidden text-slate-900">
                  {/* Subtle Colombia Tricolor Header */}
                  <div className="absolute top-0 left-0 right-0 h-1.5 flex">
                    <div className="w-1/2 h-full bg-amber-400" />
                    <div className="w-1/4 h-full bg-blue-600" />
                    <div className="w-1/4 h-full bg-red-600" />
                  </div>

                  {/* Header: Institución Educativa y Año */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="min-w-0 pr-2">
                      <span className="text-[8px] font-black text-slate-900 truncate block leading-tight" title={settings.schoolName}>
                        {settings.schoolName || 'Institución Educativa'}
                      </span>
                      <span className="text-[6.5px] uppercase font-bold text-indigo-700 block">
                        Carné Estudiantil
                      </span>
                    </div>
                    <div className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[7px] font-black tracking-wider shrink-0">
                      2026
                    </div>
                  </div>

                  {/* Body with QR / Chip and Student Details */}
                  <div className="flex items-center gap-2.5 my-0.5">
                    <div className="w-14 h-14 rounded-xl bg-white p-1 border border-slate-300 shadow-xs flex items-center justify-center text-slate-900 shrink-0 relative">
                      <QrCode className="w-12 h-12" />
                      <div className="absolute -bottom-1 -right-1 px-1 bg-indigo-600 text-white text-[6px] font-black rounded">
                        HMAC
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none">
                        {previewStudent.documentType && !previewStudent.documentType.includes('DOC') ? `${previewStudent.documentType}. ` : ''}DOCUMENTO DE IDENTIDAD
                      </div>
                      <div className="text-[10.5px] font-black font-mono text-indigo-950 leading-tight">
                        {previewStudent.documentId}
                      </div>

                      <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none mt-0.5">
                        Estudiante
                      </div>
                      <div className="text-[9.5px] font-black uppercase truncate text-slate-900 leading-tight">
                        {previewStudent.lastName} {previewStudent.firstName}
                      </div>

                      <div className="text-[8px] font-bold text-indigo-700">
                        GRADO: <span className="font-black">{previewStudent.grade}</span>
                      </div>
                    </div>

                    {/* Foto si el estudiante la tiene cargada */}
                    {previewStudent.photoUrl && (
                      <img
                        src={previewStudent.photoUrl}
                        alt="Foto carné"
                        className="w-12 h-14 rounded-lg object-cover border border-slate-300 shadow-xs shrink-0"
                      />
                    )}
                  </div>

                  {/* Real 1D Barcode (Code 128) for USB Laser/CCD Scanners */}
                  <div className="bg-white border-t border-slate-200/90 -mx-3 -mb-3 px-2 py-1 flex flex-col items-center justify-center">
                    {generateBarcodeDataUrl(previewStudent.code, { height: 20 }) ? (
                      <img 
                        src={generateBarcodeDataUrl(previewStudent.code, { height: 20 })} 
                        alt={`Código de barras ${previewStudent.code}`}
                        className="h-7 max-w-full object-contain"
                      />
                    ) : (
                      <div className="font-mono text-[7px] text-slate-600">||| ||| || ||| | {previewStudent.code}</div>
                    )}
                  </div>
                </div>

                {/* Visual Back Card */}
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-slate-50 border-2 border-slate-300 dark:border-slate-700 shadow-xl p-3 flex flex-col justify-between relative overflow-hidden text-slate-900">
                  <div className="absolute top-0 left-0 right-0 h-2 bg-slate-900" />

                  <div className="pt-2 space-y-1.5">
                    <div className="text-[7.5px] font-black text-slate-800 uppercase flex items-center justify-between">
                      <span>Credenciales de Consulta</span>
                      <span className="text-[6.5px] font-bold text-emerald-700">● Institucional</span>
                    </div>

                    <div className="p-2 bg-white rounded-xl border border-slate-200 text-[8px] font-mono space-y-1 shadow-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 font-sans text-[7px] font-bold">CÓDIGO:</span>
                        <strong className="text-slate-900 text-[8.5px]">{previewStudent.code}</strong>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 font-sans text-[7px] font-bold">CLAVE ACCESO:</span>
                        <strong className="text-indigo-600 font-black text-[8.5px]">{previewStudent.tempPassword || `SJ-${previewStudent.documentId.slice(-4)}`}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Machine Readable Zone (MRZ Footer) */}
                  <div className="border-t border-slate-200/80 pt-1 flex flex-col font-mono text-[6px] text-slate-500 tracking-tighter leading-tight bg-slate-100/80 -mx-3 -mb-3 px-3 py-1">
                    <span>I&lt;COL{previewStudent.documentId.padEnd(10, '<')}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span>
                    <span>{previewStudent.code.padEnd(10, '<')}2601017COL&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;8</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                Seleccione un estudiante de la lista para ver su carné.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
