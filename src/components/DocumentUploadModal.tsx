import React, { useState, useRef } from 'react';
import { 
  Upload, 
  FileText, 
  Image as ImageIcon, 
  HelpCircle, 
  X, 
  Check, 
  AlertTriangle, 
  Trash2, 
  RefreshCw, 
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import { Student, DocumentType } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { parseDocumentFile, ExtractedStudentDraft, normalizeGradeName } from '../utils/documentParser';

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (savedCount: number) => void;
  availableGrades: string[];
}

export const DocumentUploadModal: React.FC<DocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  availableGrades
}) => {
  const [drafts, setDrafts] = useState<ExtractedStudentDraft[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'valid' | 'warning'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFiles = async (files: FileList | File[]) => {
    setIsProcessing(true);
    const newDrafts: ExtractedStudentDraft[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const extracted = await parseDocumentFile(file);
        newDrafts.push(...extracted);
      } catch (err) {
        console.error('Error parsing file:', file.name, err);
      }
    }

    setDrafts((prev) => [...prev, ...newDrafts]);
    setIsProcessing(false);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const updateDraft = (id: string, updates: Partial<ExtractedStudentDraft>) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const updated = { ...d, ...updates };
        // Recalcular estado
        if (updated.documentId && updated.firstName) {
          updated.status = 'valid';
        }
        return updated;
      })
    );
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  const clearAllDrafts = () => {
    if (drafts.length === 0 || confirm('¿Desea limpiar todos los registros extraídos?')) {
      setDrafts([]);
    }
  };

  const handleSaveAll = () => {
    const validDrafts = drafts.filter((d) => d.documentId && d.firstName);
    if (validDrafts.length === 0) {
      alert('No hay registros válidos para guardar.');
      return;
    }

    let savedCount = 0;
    validDrafts.forEach((draft) => {
      const cleanDoc = draft.documentId.trim();
      const grade = normalizeGradeName(draft.grade || '6°1');
      const newStudent: Student = {
        code: cleanDoc,
        documentId: cleanDoc,
        documentType: draft.documentType || 'TI',
        firstName: draft.firstName.trim().toUpperCase(),
        lastName: draft.lastName.trim().toUpperCase(),
        grade: grade,
        section: grade.includes('-') ? grade.split('-')[1] : (grade.includes('°') ? grade.split('°')[1] : '1'),
        photoUrl: draft.photoUrl,
        active: true,
        createdAt: new Date().toISOString(),
        tempPassword: `SJ-${cleanDoc.slice(-4) || '2026'}`
      };

      const res = AttendanceStorageService.addStudent(newStudent);
      if (res.success) {
        savedCount++;
      }
    });

    onSuccess(savedCount);
    onClose();
  };

  const filteredDrafts = drafts.filter((d) => {
    if (filterStatus === 'all') return true;
    return d.status === filterStatus;
  });

  const validCount = drafts.filter((d) => d.status === 'valid').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="p-5 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col space-y-4 text-slate-900 dark:text-white">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight">
                  Carga Masiva de Documentos y Matrículas
                </h3>
                <button
                  type="button"
                  onClick={() => setShowHelp(!showHelp)}
                  className="p-1 rounded-full text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                  title="Ayuda sobre formatos soportados y funcionamiento"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sube de 1 a 100 archivos (PDFs, imágenes con foto carné, CSV, Excel o listas de secretaría) para registrar estudiantes automáticamente.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informative Help Banner (Toggleable) */}
        {showHelp && (
          <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs space-y-2 animate-fadeIn text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2 font-bold text-indigo-900 dark:text-indigo-300">
              <Info className="w-4 h-4" />
              <span>¿Qué archivos soporta y cómo funciona el algoritmo?</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-[11px] leading-relaxed">
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/60">
                <strong className="block text-indigo-600 dark:text-indigo-400 font-bold mb-1">
                  1. Fotos Carné / Imágenes (.JPG, .PNG)
                </strong>
                Si el nombre del archivo contiene datos (ej: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">TI 1025883921 Gómez Carlos 10-4.jpg</code>), el algoritmo extrae nombres, documento, grado y <strong>adjunta la foto al carné digital</strong>.
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/60">
                <strong className="block text-indigo-600 dark:text-indigo-400 font-bold mb-1">
                  2. Planillas CSV / Excel / SIMAT
                </strong>
                Reconoce columnas oficiales de secretaría: Tipo Doc (TI, CC, RC, CE, PPT), Documento, Nombres, Apellidos y Grado. Procesa cientos de filas en milisegundos.
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-100 dark:border-indigo-900/60">
                <strong className="block text-indigo-600 dark:text-indigo-400 font-bold mb-1">
                  3. Fichas de Matrícula PDF
                </strong>
                Genera borradores listos para revisión y confirmación previa. Si no hay foto, el carné se adapta automáticamente sin dejar siluetas vacías.
              </div>
            </div>
          </div>
        )}

        {/* Drag & Drop Area */}
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-3xl p-6 sm:p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
            dragActive
              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30 scale-[0.99]'
              : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.txt,.json,.pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFiles(e.target.files);
              }
            }}
          />

          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
            {isProcessing ? (
              <RefreshCw className="w-6 h-6 animate-spin" />
            ) : (
              <Upload className="w-6 h-6" />
            )}
          </div>

          <div className="space-y-0.5">
            <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {isProcessing ? 'Extrayendo datos de los archivos...' : 'Arrastra archivos aquí o haz clic para examinar'}
            </p>
            <p className="text-[11px] text-slate-400">
              Soporta: Fichas PDF, Fotos (.JPG, .PNG), Planillas (.CSV, .TXT, .JSON)
            </p>
          </div>
        </div>

        {/* Extracted Items Review Table / Confirmation */}
        {drafts.length > 0 && (
          <div className="flex-1 overflow-hidden flex flex-col space-y-3 min-h-[220px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="text-slate-700 dark:text-slate-300">
                  Registros Extraídos: <strong className="text-indigo-600 dark:text-indigo-400 font-black">{drafts.length}</strong>
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-normal">
                  ({validCount} listos para guardar)
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearAllDrafts}
                  className="px-2.5 py-1 text-slate-400 hover:text-rose-500 text-xs font-bold transition-all flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Limpiar</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-2xl">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-md z-10 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Foto / Origen</th>
                    <th className="py-2.5 px-3">Tipo Doc</th>
                    <th className="py-2.5 px-3">Documento (ID)</th>
                    <th className="py-2.5 px-3">Nombres</th>
                    <th className="py-2.5 px-3">Apellidos</th>
                    <th className="py-2.5 px-3">Grado</th>
                    <th className="py-2.5 px-3 text-right">Quitar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {filteredDrafts.map((draft) => (
                    <tr key={draft.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          {draft.photoUrl ? (
                            <img
                              src={draft.photoUrl}
                              alt="Foto carné"
                              className="w-8 h-8 rounded-lg object-cover border border-slate-300 dark:border-slate-700 shadow-xs shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                          )}
                          <span className="text-[10px] text-slate-400 truncate max-w-[100px]" title={draft.fileName}>
                            {draft.fileName}
                          </span>
                        </div>
                      </td>

                      <td className="py-2 px-3">
                        <select
                          value={draft.documentType}
                          onChange={(e) => updateDraft(draft.id, { documentType: e.target.value as DocumentType })}
                          className="px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold"
                        >
                          <option value="TI">TI (Tarjeta de Identidad)</option>
                          <option value="CC">CC (Cédula de Ciudadanía)</option>
                          <option value="RC">RC (Registro Civil)</option>
                          <option value="CE">CE (Cédula de Extranjería)</option>
                          <option value="PPT">PPT (Permiso Protección)</option>
                          <option value="PEP">PEP (Permiso Especial)</option>
                          <option value="NES">NES (Establecido Secretaría)</option>
                        </select>
                      </td>

                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={draft.documentId}
                          onChange={(e) => updateDraft(draft.id, { documentId: e.target.value })}
                          className="w-28 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400"
                        />
                      </td>

                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={draft.firstName}
                          onChange={(e) => updateDraft(draft.id, { firstName: e.target.value.toUpperCase() })}
                          className="w-32 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold uppercase"
                        />
                      </td>

                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={draft.lastName}
                          onChange={(e) => updateDraft(draft.id, { lastName: e.target.value.toUpperCase() })}
                          className="w-32 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs uppercase"
                        />
                      </td>

                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={draft.grade}
                          onChange={(e) => updateDraft(draft.id, { grade: e.target.value })}
                          placeholder="ej: 6°5, 10°4"
                          className="w-20 px-2 py-1 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-200"
                        />
                      </td>

                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeDraft(draft.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal Footer / Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs text-slate-500">
            {drafts.length > 0 ? (
              <span>Se guardarán en el directorio escolar y se generarán sus códigos QR/barras de inmediato.</span>
            ) : (
              <span>Puedes subir múltiples fotos de estudiantes y planillas de matrícula a la vez.</span>
            )}
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={validCount === 0}
              onClick={handleSaveAll}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Confirmar y Registrar ({validCount})</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
