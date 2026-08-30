import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  UserPlus, 
  Search, 
  Trash2, 
  CreditCard, 
  Download, 
  Edit2, 
  Check, 
  X, 
  AlertCircle, 
  QrCode,
  Eye,
  Camera,
  Layers,
  Upload,
  HelpCircle,
  Sparkles,
  CheckCircle,
  ShieldCheck,
  Crown
} from 'lucide-react';
import { Student, SchoolSettings, DocumentType } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { generateStudentCardPdf, downloadPdfBlob } from '../utils/pdfGenerator';
import { matchStudentFuzzy, normalizeDocumentOrCode } from '../utils/searchHelper';
import { generateBarcodeDataUrl } from '../utils/barcode';
import { DocumentUploadModal } from './DocumentUploadModal';
import { normalizeGradeName } from '../utils/documentParser';

interface StudentsManagerViewProps {
  onGenerateCard?: (student: Student) => void;
}

export const StudentsManagerView: React.FC<StudentsManagerViewProps> = ({ onGenerateCard }) => {
  const [students, setStudents] = useState<Student[]>(AttendanceStorageService.getStudents());
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [showDrawer, setShowDrawer] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [justSavedStudent, setJustSavedStudent] = useState<Student | null>(null);
  const [inspectStudent, setInspectStudent] = useState<Student | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const singlePhotoInputRef = useRef<HTMLInputElement>(null);

  const uniqueGrades = AttendanceStorageService.getUniqueGrades();

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setStudents(AttendanceStorageService.getStudents());
      setSettings(AttendanceStorageService.getSettings());
    });
    return unsubscribe;
  }, []);

  // Form State con soporte para Tipo de Doc y Foto Opcional
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    grade: '6°3',
    documentType: 'TI' as DocumentType,
    documentId: '',
    photoUrl: ''
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-generate standardized code dynamically from documentId
  const dynamicallyGeneratedCode = useMemo(() => {
    const cleanDoc = normalizeDocumentOrCode(formData.documentId);
    return cleanDoc;
  }, [formData.documentId]);

  const refreshList = () => {
    setStudents(AttendanceStorageService.getStudents());
  };

  // Smart fuzzy & suggestion search
  const filteredStudents = useMemo(() => {
    return students.filter(s => {
      const matchesGrade = selectedGrade === 'all' || s.grade === selectedGrade;
      const matchesSearch = matchStudentFuzzy(s, searchQuery);
      return matchesGrade && matchesSearch;
    });
  }, [students, selectedGrade, searchQuery]);

  const handleOpenAdd = () => {
    setEditingStudent(null);
    setFormData({
      firstName: '',
      lastName: '',
      grade: uniqueGrades[0] || '6°3',
      documentType: 'TI',
      documentId: '',
      photoUrl: ''
    });
    setFormError(null);
    setShowDrawer(true);
  };

  const handleOpenEdit = (student: Student) => {
    setEditingStudent(student);
    setFormData({
      firstName: student.firstName,
      lastName: student.lastName,
      grade: student.grade,
      documentType: student.documentType || 'TI',
      documentId: student.documentId,
      photoUrl: student.photoUrl || ''
    });
    setFormError(null);
    setShowDrawer(true);
  };

  const handleSinglePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const firstName = formData.firstName.trim().toUpperCase();
    const lastName = formData.lastName.trim().toUpperCase();
    const rawDocumentId = formData.documentId.trim();
    const cleanDocumentId = normalizeDocumentOrCode(rawDocumentId);
    const grade = normalizeGradeName(formData.grade.trim());

    if (!firstName || !lastName) {
      setFormError('Por favor ingrese nombres y apellidos completos.');
      return;
    }

    if (!cleanDocumentId) {
      setFormError('Por favor ingrese un número de documento de identidad válido.');
      return;
    }

    if (!grade) {
      setFormError('Por favor indique el grado escolar (ej: 6°5, 10°4, 11°2).');
      return;
    }

    if (editingStudent) {
      AttendanceStorageService.updateStudent(editingStudent.code, {
        firstName,
        lastName,
        documentId: cleanDocumentId,
        documentType: formData.documentType,
        grade,
        photoUrl: formData.photoUrl || undefined
      });
      refreshList();
      setShowDrawer(false);
      setToastMessage(`Estudiante ${firstName} ${lastName} actualizado correctamente.`);
      setTimeout(() => setToastMessage(null), 3500);
    } else {
      const newStudent: Student = {
        code: cleanDocumentId,
        documentId: cleanDocumentId,
        documentType: formData.documentType,
        firstName,
        lastName,
        grade,
        section: grade.includes('-') ? grade.split('-')[1] : (grade.includes('°') ? grade.split('°')[1] : '1'),
        photoUrl: formData.photoUrl || undefined,
        active: true,
        createdAt: new Date().toISOString(),
        tempPassword: `SJ-${cleanDocumentId.slice(-4) || '2026'}`
      };

      const res = AttendanceStorageService.addStudent(newStudent);
      if (!res.success) {
        setFormError(res.error || 'Error al registrar estudiante.');
        return;
      }

      refreshList();
      setShowDrawer(false);
      setJustSavedStudent(newStudent);
      setToastMessage(`Estudiante ${firstName} ${lastName} matriculado en grado ${grade}.`);
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  const handleDownloadPdf = async (student: Student) => {
    try {
      const pdfBytes = await generateStudentCardPdf(student, settings);
      downloadPdfBlob(pdfBytes, `Carne_${student.code}_${student.firstName}_${student.lastName}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Error al generar el carné.');
    }
  };

  const handleDelete = (code: string, name: string) => {
    if (confirm(`¿Eliminar al estudiante ${name} (${code})?`)) {
      AttendanceStorageService.deleteStudent(code);
      refreshList();
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn" id="students-manager-view">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-xs flex items-center justify-between shadow-xl animate-fadeIn">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="p-1 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 uppercase tracking-wider">
              Directorio Escolar
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            Registro y Gestión de Estudiantes
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Matricula estudiantes individuales o carga fichas masivas con fotos de carné opcionales.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Botón Cargar Archivo / Upload File */}
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-2xl text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-center gap-2"
            title="Cargar Fichas PDF, Fotos Carné, Planillas CSV o Listas de Matrícula"
          >
            <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Cargar Archivo(s)</span>
          </button>

          {/* Botón Nuevo Estudiante */}
          <button
            onClick={handleOpenAdd}
            className="flex-1 sm:flex-initial px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            <span>+ Nuevo Estudiante</span>
          </button>
        </div>
      </div>

      {/* Main Student Directory Table */}
      <div className="p-5 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, documento (TI, CC, RC) o código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="px-3.5 py-2.5 bg-white dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold focus:outline-none"
            >
              <option value="all">Todos los Cursos ({students.length})</option>
              {uniqueGrades.map(g => (
                <option key={g} value={g}>Grado {g}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Estudiante</th>
                <th className="py-3 px-3">Grado / Curso</th>
                <th className="py-3 px-3">Tipo / Documento</th>
                <th className="py-3 px-3">Código QR / Barras</th>
                <th className="py-3 px-3">Rol en Aula</th>
                <th className="py-3 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {filteredStudents.map((std) => (
                <tr key={std.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                    <div className="flex items-center gap-2.5">
                      {std.photoUrl ? (
                        <img
                          src={std.photoUrl}
                          alt={`${std.firstName} ${std.lastName}`}
                          className="w-7 h-7 rounded-lg object-cover border border-slate-300 dark:border-slate-700 shadow-xs shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center text-[10px] font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                          {std.firstName.charAt(0)}{std.lastName.charAt(0)}
                        </div>
                      )}
                      <span>{std.firstName} {std.lastName}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <span className="px-2.5 py-1 rounded-lg font-bold text-[11px] bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                      {std.grade}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold mr-1.5">
                      {std.documentType || 'TI'}
                    </span>
                    {std.documentId}
                  </td>
                  <td className="py-3 px-3 font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    {std.code}
                  </td>
                  <td className="py-3 px-3">
                    {std.isRepresentative ? (
                      <button
                        type="button"
                        onClick={() => {
                          AttendanceStorageService.setRepresentativeForGrade(std.grade, '');
                          refreshList();
                        }}
                        className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-[10px] font-bold border border-amber-300 dark:border-amber-800 flex items-center gap-1 hover:bg-amber-200 transition-colors"
                        title="Clic para remover rol de representante"
                      >
                        <Crown className="w-3 h-3 text-amber-600" />
                        <span>Representante</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          AttendanceStorageService.setRepresentativeForGrade(std.grade, std.code);
                          refreshList();
                        }}
                        className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 text-slate-500 hover:text-amber-700 text-[10px] font-medium border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors"
                        title="Asignar como Representante de este curso"
                      >
                        <span>Hacer Rep</span>
                      </button>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right space-x-1">
                    <button
                      onClick={() => setInspectStudent(std)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl transition-all inline-flex items-center gap-1 font-bold text-[11px]"
                      title="Previsualizar Carné Digital"
                    >
                      <Eye className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span className="hidden md:inline">Ver Carné</span>
                    </button>
                    <button
                      onClick={() => handleDownloadPdf(std)}
                      className="p-2 hover:bg-indigo-600 hover:text-white text-indigo-600 dark:text-indigo-400 rounded-xl transition-all inline-flex items-center gap-1 font-bold text-[11px]"
                      title="Descargar Carné PDF"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">PDF</span>
                    </button>
                    <button
                      onClick={() => handleOpenEdit(std)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 rounded-xl transition-all inline-block"
                      title="Editar"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(std.code, `${std.firstName} ${std.lastName}`)}
                      className="p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 rounded-xl transition-all inline-block"
                      title="Eliminar"
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

      {/* Drawer: Add / Edit Single Student */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                  {editingStudent ? 'Editar Ficha del Estudiante' : 'Matricular Nuevo Estudiante'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Puedes ingresar cualquier grado (ej: 6°5, 10°4) y adjuntar foto de carné opcional.
                </p>
              </div>
              <button
                onClick={() => setShowDrawer(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Left Column: Form Inputs */}
              <form onSubmit={handleSaveStudent} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    1. Nombres
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="Ej: Santiago Andrés"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs uppercase text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    2. Apellidos
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Ej: Gómez Restrepo"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs uppercase text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Tipo de Documento y Número */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1 sm:col-span-1">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Tipo Doc
                    </label>
                    <select
                      value={formData.documentType}
                      onChange={(e) => setFormData({ ...formData, documentType: e.target.value as DocumentType })}
                      className="w-full px-2.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    >
                      <option value="TI">TI (Tarjeta Identidad)</option>
                      <option value="CC">CC (Cédula Ciudadanía)</option>
                      <option value="RC">RC (Registro Civil)</option>
                      <option value="CE">CE (Cédula Extranjería)</option>
                      <option value="PPT">PPT (Protección Temporal)</option>
                      <option value="PEP">PEP (Permiso Especial)</option>
                      <option value="NES">NES (Secretaría)</option>
                    </select>
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      3. Número de Documento (ID)
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.documentId}
                      disabled={!!editingStudent}
                      onChange={(e) => setFormData({ ...formData, documentId: e.target.value })}
                      placeholder="Ej: 1025883921"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Grado Dinámico Libre (permite crear 6°5, 10°4, etc.) */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      4. Grado o Curso (Creación Libre)
                    </label>
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                      Escribe cualquier grado (ej: 6°5, 10°4)
                    </span>
                  </div>
                  <input
                    type="text"
                    required
                    list="grades-list-drawer"
                    value={formData.grade}
                    onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                    placeholder="Ej: 6°5, 10°4, 11°3"
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  <datalist id="grades-list-drawer">
                    {uniqueGrades.map(g => (
                      <option key={g} value={g} />
                    ))}
                    <option value="6°4" />
                    <option value="6°5" />
                    <option value="7°4" />
                    <option value="8°4" />
                    <option value="9°4" />
                    <option value="10°4" />
                    <option value="11°4" />
                  </datalist>
                </div>

                <div className="p-3.5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-indigo-700 dark:text-indigo-300">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Emisión Digital Automatizada</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Al guardar, el sistema generará de forma instantánea el Código QR seguro con firma criptográfica HMAC-SHA256, el Código de Barras 1D Code 128 y la clave permanente de consulta para el acudiente.
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDrawer(false)}
                    className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>{editingStudent ? 'Actualizar' : 'Guardar y Generar'}</span>
                  </button>
                </div>
              </form>

              {/* Right Column: Live Dynamic Card Preview */}
              <div className="space-y-3 p-4 bg-slate-50 dark:bg-slate-950/60 rounded-3xl border border-slate-200 dark:border-slate-800 text-slate-900">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-indigo-500" />
                    Previsualización en Tiempo Real
                  </span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">● Activo</span>
                </div>

                {/* Simulated Physical Card */}
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-gradient-to-br from-slate-50 via-sky-50/40 to-indigo-50/30 border-2 border-slate-300 dark:border-slate-700 shadow-md p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
                  <div className="absolute top-0 left-0 right-0 h-1.5 flex">
                    <div className="w-1/2 h-full bg-amber-400" />
                    <div className="w-1/4 h-full bg-blue-600" />
                    <div className="w-1/4 h-full bg-red-600" />
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[8px] font-bold text-slate-800 tracking-tight">
                    <div>
                      <span className="text-[7px] uppercase text-indigo-900 block font-black">REPÚBLICA DE COLOMBIA</span>
                      <span className="text-[8px] font-black text-slate-900 line-clamp-1 max-w-[185px] block leading-tight" title={settings.schoolName}>
                        {settings.schoolName || 'Institución Educativa Antonia Santos (I.N.A.S)'}
                      </span>
                    </div>
                    <div className="w-6 h-6 rounded-full border border-indigo-200 bg-indigo-50/80 flex items-center justify-center text-[7px] font-black text-indigo-700">
                      2026
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 my-0.5">
                    <div className="w-14 h-14 rounded-xl bg-white p-1 border border-slate-300 shadow-sm flex items-center justify-center text-slate-900 shrink-0 relative">
                      <QrCode className="w-12 h-12" />
                      <div className="absolute -bottom-1 -right-1 px-1 bg-indigo-600 text-white text-[6px] font-black rounded">
                        HMAC
                      </div>
                    </div>

                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none">
                        {formData.documentType}. DOCUMENTO
                      </div>
                      <div className="text-[10.5px] font-black font-mono text-indigo-950 leading-tight">
                        {dynamicallyGeneratedCode || '10XXXXXXXX'}
                      </div>

                      <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none mt-0.5">Nombres y Apellidos</div>
                      <div className="text-[9px] font-black uppercase truncate text-slate-900 leading-tight">
                        {formData.firstName || 'NOMBRES'} {formData.lastName || 'APELLIDOS'}
                      </div>

                      <div className="text-[7.5px] font-bold text-indigo-600">
                        CURSO: <span className="font-black">{formData.grade || '6°3'}</span>
                      </div>
                    </div>

                    {/* Foto si existe */}
                    {formData.photoUrl && (
                      <img
                        src={formData.photoUrl}
                        alt="Foto carné"
                        className="w-12 h-14 rounded-lg object-cover border border-slate-300 shadow-xs shrink-0"
                      />
                    )}
                  </div>

                  {/* Real 1D Barcode (Code 128) */}
                  <div className="bg-white border-t border-slate-200/90 -mx-3.5 -mb-3.5 px-2 py-1 flex flex-col items-center justify-center">
                    {generateBarcodeDataUrl(dynamicallyGeneratedCode || '1000000000', { height: 18 }) ? (
                      <img 
                        src={generateBarcodeDataUrl(dynamicallyGeneratedCode || '1000000000', { height: 18 })} 
                        alt="Código de barras"
                        className="h-6 max-w-full object-contain"
                      />
                    ) : (
                      <div className="font-mono text-[6.5px] text-slate-600">||| ||| || ||| | {dynamicallyGeneratedCode}</div>
                    )}
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 leading-tight text-center">
                  Al guardar, el carné queda firmado y listo para ser leído por el láser USB o la cámara sin internet.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Notification Drawer with Instant PDF Download */}
      {justSavedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-indigo-500/40 shadow-2xl max-w-md w-full text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                ¡Estudiante Registrado con Éxito!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                <strong>{justSavedStudent.firstName} {justSavedStudent.lastName}</strong> ({justSavedStudent.grade}) ya cuenta con su código <strong>{justSavedStudent.code}</strong>.
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setJustSavedStudent(null)}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-xs font-bold"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  handleDownloadPdf(justSavedStudent);
                  setJustSavedStudent(null);
                }}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Carné PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect / Preview Carné Modal */}
      {inspectStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Previsualización de Carné Oficial (CR80)
                </h3>
              </div>
              <button
                onClick={() => setInspectStudent(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Carné Visual Card */}
            <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-gradient-to-br from-slate-50 via-sky-50/40 to-indigo-50/30 border-2 border-slate-300 dark:border-slate-700 shadow-xl p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
              <div className="absolute top-0 left-0 right-0 h-1.5 flex">
                <div className="w-1/2 h-full bg-amber-400" />
                <div className="w-1/4 h-full bg-blue-600" />
                <div className="w-1/4 h-full bg-red-600" />
              </div>

              <div className="flex items-center justify-between pt-1 text-[8px] font-bold text-slate-800 tracking-tight">
                <div>
                  <span className="text-[7px] uppercase text-indigo-900 block font-black">REPÚBLICA DE COLOMBIA</span>
                  <span className="text-[8px] font-black text-slate-900 line-clamp-1 max-w-[185px] block leading-tight" title={settings.schoolName}>
                    {settings.schoolName || 'Institución Educativa Antonia Santos (I.N.A.S)'}
                  </span>
                </div>
                <div className="w-6 h-6 rounded-full border border-indigo-200 bg-indigo-50/80 flex items-center justify-center text-[7px] font-black text-indigo-700">
                  ESC
                </div>
              </div>

              <div className="flex items-center gap-2.5 my-0.5">
                <div className="w-14 h-14 rounded-xl bg-white p-1 border border-slate-300 shadow-sm flex items-center justify-center text-slate-900 shrink-0 relative">
                  <QrCode className="w-12 h-12" />
                  <div className="absolute -bottom-1 -right-1 px-1 bg-indigo-600 text-white text-[6px] font-black rounded">
                    HMAC
                  </div>
                </div>

                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none">
                    {inspectStudent.documentType || 'TI'}. DOCUMENTO
                  </div>
                  <div className="text-[10.5px] font-black font-mono text-indigo-950 leading-tight">
                    {inspectStudent.documentId}
                  </div>

                  <div className="text-[6.5px] font-bold text-slate-400 uppercase leading-none mt-0.5">Apellidos y Nombres</div>
                  <div className="text-[9px] font-black uppercase truncate text-slate-900 leading-tight">
                    {inspectStudent.lastName} {inspectStudent.firstName}
                  </div>

                  <div className="text-[7.5px] font-bold text-indigo-600">
                    CURSO: <span className="font-black">{inspectStudent.grade}</span>
                  </div>
                </div>

                {/* Foto si existe en el estudiante */}
                {inspectStudent.photoUrl && (
                  <img
                    src={inspectStudent.photoUrl}
                    alt="Foto estudiante"
                    className="w-12 h-14 rounded-lg object-cover border border-slate-300 shadow-xs shrink-0"
                  />
                )}
              </div>

              {/* Real 1D Barcode (Code 128) */}
              <div className="bg-white border-t border-slate-200/90 -mx-3.5 -mb-3.5 px-2 py-1 flex flex-col items-center justify-center">
                {generateBarcodeDataUrl(inspectStudent.code, { height: 20 }) ? (
                  <img 
                    src={generateBarcodeDataUrl(inspectStudent.code, { height: 20 })} 
                    alt={`Código de barras ${inspectStudent.code}`}
                    className="h-7 max-w-full object-contain"
                  />
                ) : (
                  <div className="font-mono text-[7px] text-slate-600">||| ||| || ||| | {inspectStudent.code}</div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setInspectStudent(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  handleDownloadPdf(inspectStudent);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>Descargar Carné PDF (CR80)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Carga Masiva de Documentos y Matrículas Modal */}
      <DocumentUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        availableGrades={uniqueGrades}
        onSuccess={(count) => {
          refreshList();
          setToastMessage(`¡Éxito! Se registraron ${count} estudiantes y sus carnés están listos.`);
          setTimeout(() => setToastMessage(null), 4000);
        }}
      />
    </div>
  );
};
