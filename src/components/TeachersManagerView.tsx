import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Key, 
  Shield, 
  Edit3, 
  Trash2, 
  Check, 
  X, 
  Copy, 
  RefreshCw, 
  Mail, 
  Phone, 
  BookOpen, 
  GraduationCap, 
  Search, 
  Lock, 
  Eye, 
  EyeOff,
  AlertCircle,
  Save,
  CheckCircle2
} from 'lucide-react';
import { Teacher } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';

export const TeachersManagerView: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>(AttendanceStorageService.getTeachers());
  const uniqueGrades = AttendanceStorageService.getUniqueGrades();

  const [searchTerm, setSearchTerm] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Add / Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    documentId: '',
    fullName: '',
    email: '',
    phone: '',
    subjectsText: '',
    assignedGrades: [] as string[],
    directorGrade: '',
    username: '',
    tempPassword: ''
  });

  // Password Reset Alert Modal
  const [resetModalTeacher, setResetModalTeacher] = useState<Teacher | null>(null);
  const [newGeneratedPass, setNewGeneratedPass] = useState<string | null>(null);
  const [copiedPass, setCopiedPass] = useState(false);

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setTeachers(AttendanceStorageService.getTeachers());
    });
    return unsubscribe;
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleOpenAdd = () => {
    setEditingTeacher(null);
    setFormData({
      documentId: '',
      fullName: '',
      email: '',
      phone: '',
      subjectsText: 'Matemáticas, Física',
      assignedGrades: ['10°1', '10°2'],
      directorGrade: '',
      username: '',
      tempPassword: `Docente${Math.floor(1000 + Math.random() * 9000)}*`
    });
    setShowModal(true);
  };

  const handleOpenEdit = (t: Teacher) => {
    setEditingTeacher(t);
    setFormData({
      documentId: t.documentId,
      fullName: t.fullName,
      email: t.email,
      phone: t.phone || '',
      subjectsText: t.subjects.join(', '),
      assignedGrades: t.assignedGrades,
      directorGrade: t.directorGrade || '',
      username: t.username,
      tempPassword: t.tempPassword || ''
    });
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName.trim() || !formData.documentId.trim()) return;

    const subjects = formData.subjectsText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const generatedUsername = formData.username.trim() || 
      formData.fullName.toLowerCase().split(' ')[0] + '.' + formData.documentId.slice(-4);

    const isGroupDirector = Boolean(formData.directorGrade && formData.directorGrade.trim() !== '');

    if (editingTeacher) {
      AttendanceStorageService.updateTeacher(editingTeacher.id, {
        documentId: formData.documentId,
        fullName: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        subjects,
        assignedGrades: formData.assignedGrades,
        isGroupDirector,
        directorGrade: isGroupDirector ? formData.directorGrade : undefined,
        username: generatedUsername,
        tempPassword: formData.tempPassword
      });
      showToast(`¡Docente ${formData.fullName} actualizado con éxito!`);
    } else {
      const newTeacher: Teacher = {
        id: `prof-${Date.now()}`,
        documentId: formData.documentId,
        fullName: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        subjects,
        assignedGrades: formData.assignedGrades,
        isGroupDirector,
        directorGrade: isGroupDirector ? formData.directorGrade : undefined,
        username: generatedUsername,
        tempPassword: formData.tempPassword || `Docente${Math.floor(1000 + Math.random() * 9000)}*`,
        active: true,
        createdAt: new Date().toISOString()
      };

      const res = AttendanceStorageService.addTeacher(newTeacher);
      if (!res.success) {
        alert(res.error || 'Error al guardar docente');
        return;
      }
      showToast(`¡Docente ${formData.fullName} registrado correctamente!`);
    }

    setShowModal(false);
  };

  const handleDelete = (t: Teacher) => {
    if (window.confirm(`¿Seguro que deseas eliminar al docente ${t.fullName}? Esta acción revocará sus accesos.`)) {
      AttendanceStorageService.deleteTeacher(t.id);
      showToast(`Docente ${t.fullName} eliminado.`);
    }
  };

  const handleResetPassword = (t: Teacher) => {
    const res = AttendanceStorageService.resetTeacherPassword(t.id);
    if (res.success && res.newPassword) {
      setResetModalTeacher(t);
      setNewGeneratedPass(res.newPassword);
      setCopiedPass(false);
    }
  };

  const handleCopyPassword = () => {
    if (newGeneratedPass) {
      navigator.clipboard.writeText(newGeneratedPass);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  const toggleGradeSelection = (grade: string) => {
    setFormData(prev => {
      const exists = prev.assignedGrades.includes(grade);
      return {
        ...prev,
        assignedGrades: exists 
          ? prev.assignedGrades.filter(g => g !== grade) 
          : [...prev.assignedGrades, grade]
      };
    });
  };

  const filteredTeachers = teachers.filter(t => 
    t.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.documentId.includes(searchTerm) ||
    t.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.subjects.some(s => s.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-fadeIn" id="teachers-manager-view">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="p-3.5 rounded-2xl bg-indigo-600 text-white font-bold text-xs flex items-center justify-between shadow-xl animate-fadeIn">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>{toastMsg}</span>
          </div>
          <button onClick={() => setToastMsg(null)} className="p-1 hover:opacity-80">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 uppercase tracking-wider">
              Administración • Gestión de Personal
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            Panel de Control de Docentes & Credenciales
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Administra el cuerpo docente, asigna asignaturas, gestiona usuarios de acceso y restablece contraseñas al instante.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2 self-stretch md:self-auto justify-center"
        >
          <UserPlus className="w-4 h-4" />
          <span>Registrar Nuevo Docente</span>
        </button>
      </div>

      {/* Search and Summary Counter */}
      <div className="p-4 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar docente por nombre, cédula, materia o usuario..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
          <Users className="w-4 h-4 text-indigo-500" />
          <span>{filteredTeachers.length} docentes registrados</span>
        </div>
      </div>

      {/* Teachers Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTeachers.map((teacher) => (
          <div
            key={teacher.id}
            className="p-5 rounded-3xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
          >
            {/* Top: Avatar & Basic Info */}
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black text-sm">
                    {teacher.fullName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">
                      {teacher.fullName}
                    </h3>
                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                      CC. {teacher.documentId}
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  Activo
                </span>
              </div>

              {/* Contact Info */}
              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                {teacher.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{teacher.email}</span>
                  </div>
                )}
                {teacher.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{teacher.phone}</span>
                  </div>
                )}
              </div>

              {/* Subjects & Grades Badges */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                {/* Director de Grupo Badge */}
                <div className="flex items-center gap-1.5">
                  {teacher.directorGrade ? (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 shadow-xs">
                      <span>⭐ Director de Grupo:</span>
                      <span className="underline font-black">{teacher.directorGrade}</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium italic">
                      Sin dirección de grupo (N/A)
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {teacher.subjects.map(s => (
                    <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900">
                      {s}
                    </span>
                  ))}
                </div>

                {teacher.assignedGrades && teacher.assignedGrades.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                    <span className="font-semibold">Cursos:</span>
                    {teacher.assignedGrades.map(g => (
                      <span key={g} className="font-bold text-slate-600 dark:text-slate-300">
                        {g}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Access Credentials Box */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-500">Usuario:</span>
                  <span className="font-mono font-black text-indigo-600 dark:text-indigo-400">
                    {teacher.username}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-500">Clave actual:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                    {teacher.tempPassword || '••••••••'}
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5">
              <button
                onClick={() => handleResetPassword(teacher)}
                className="px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 text-[11px] font-bold transition-all border border-amber-200 dark:border-amber-800 flex items-center gap-1"
                title="Restablecer contraseña de acceso"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Restablecer Clave</span>
              </button>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleOpenEdit(teacher)}
                  className="p-2 rounded-xl text-slate-600 hover:text-indigo-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Editar datos del docente"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(teacher)}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors"
                  title="Eliminar docente"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* MODAL: ADD / EDIT TEACHER */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {editingTeacher ? 'Editar Ficha del Docente' : 'Registrar Nuevo Docente'}
                </h3>
                <p className="text-xs text-slate-500">
                  Completa los datos pedagógicos y credenciales de acceso al portal de aula.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Document ID */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Cédula / Documento
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: 71829301"
                    value={formData.documentId}
                    onChange={(e) => setFormData({ ...formData, documentId: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    required
                  />
                </div>

                {/* Full Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Nombre Completo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Juan Pablo Pérez Gómez"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Email */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Correo Institucional
                  </label>
                  <input
                    type="email"
                    placeholder="jperez@inas.edu.co"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    type="tel"
                    placeholder="3001234567"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              {/* Subjects */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Asignaturas que Dicta (Separadas por coma)
                </label>
                <input
                  type="text"
                  placeholder="Matemáticas, Física, Geometría"
                  value={formData.subjectsText}
                  onChange={(e) => setFormData({ ...formData, subjectsText: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  required
                />
              </div>

              {/* Assigned Grades Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Cursos / Salones Asignados
                </label>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-2 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800">
                  {uniqueGrades.map(g => {
                    const isSelected = formData.assignedGrades.includes(g);
                    return (
                      <button
                        type="button"
                        key={g}
                        onClick={() => toggleGradeSelection(g)}
                        className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Director de Grupo Selection */}
              <div className="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-amber-950 dark:text-amber-200 uppercase tracking-wider">
                    ⭐ Dirección de Grupo (Opcional)
                  </label>
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                    {formData.directorGrade ? `Asignado a: ${formData.directorGrade}` : 'Sin asignar (N/A)'}
                  </span>
                </div>
                <select
                  value={formData.directorGrade}
                  onChange={(e) => setFormData({ ...formData, directorGrade: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-amber-300 dark:border-amber-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">N/A - Sin dirección de grupo asignada</option>
                  {uniqueGrades.map(g => (
                    <option key={g} value={g}>
                      Director de Grupo de: {g}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                  Al asignar un curso, el docente tendrá acceso a la supervisión general de jornada y mensajes motivacionales de su grupo a cargo.
                </p>
              </div>

              {/* Credentials Section */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Usuario de Acceso
                  </label>
                  <input
                    type="text"
                    placeholder="jperez"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Contraseña Temporal
                  </label>
                  <input
                    type="text"
                    value={formData.tempPassword}
                    onChange={(e) => setFormData({ ...formData, tempPassword: e.target.value })}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingTeacher ? 'Guardar Cambios' : 'Registrar Docente'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESET PASSWORD SUCCESS NOTIFICATION */}
      {resetModalTeacher && newGeneratedPass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/80 text-amber-600 mx-auto flex items-center justify-center">
              <Key className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Contraseña Restablecida
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nueva clave para el docente <strong>{resetModalTeacher.fullName}</strong> ({resetModalTeacher.username}):
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-mono text-base font-black text-indigo-600 dark:text-indigo-400">
                {newGeneratedPass}
              </span>
              <button
                onClick={handleCopyPassword}
                className="p-2 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 shadow-xs text-xs font-bold flex items-center gap-1"
              >
                {copiedPass ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                <span>{copiedPass ? 'Copiada' : 'Copiar'}</span>
              </button>
            </div>

            <p className="text-[10px] text-slate-400">
              * El docente podrá iniciar sesión en el portal de aula inmediatamente con esta clave.
            </p>

            <button
              onClick={() => {
                setResetModalTeacher(null);
                setNewGeneratedPass(null);
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
