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
  Crown,
  Settings as GearIcon
} from 'lucide-react';
import { Student, SchoolSettings, DocumentType, UserRole } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';
import { FirebaseService } from '../services/firebase';
import { CloudflareSyncService } from '../services/cloudflareSync';
import { generateStudentCardPdf, downloadPdfBlob } from '../utils/pdfGenerator';
import { matchStudentFuzzy, normalizeDocumentOrCode } from '../utils/searchHelper';
import { generateBarcodeDataUrl } from '../utils/barcode';
import { DocumentUploadModal } from './DocumentUploadModal';
import { ConfirmDialog } from './ConfirmDialog';
// R67: el AccountSyncModal de R66 fue ELIMINADO (reemplazado por el restablecimiento
// administrativo sin clave anterior — ver bitácora R67).
import { normalizeGradeName, isValidGrade } from '../utils/documentParser';
import { compressImageFile } from '../utils/imageCompressor';
import { resolveAccessPassword } from '../utils/credentialGen'; // R67 §9: política de generación de claves
import { KeyRound, Copy } from 'lucide-react'; // Ronda 34 (H-34-2): clave de acceso visible en la matrícula

interface StudentsManagerViewProps {
  onGenerateCard?: (student: Student) => void;
  currentRole?: UserRole;
}

export const StudentsManagerView: React.FC<StudentsManagerViewProps> = ({ onGenerateCard, currentRole = 'ADMIN' }) => {
  const [students, setStudents] = useState<Student[]>(AttendanceStorageService.getStudents());
  const [settings, setSettings] = useState<SchoolSettings>(AttendanceStorageService.getSettings());

  // Ronda 21 — UI-2 (petición del propietario): la fila de botones dispersos (lapicito,
  // basurita, ojo, PDF) se convierte en UNA tuerca de ajustes que despliega mini-tarjetas
  // alargadas, una por acción. Una sola abierta a la vez; clic-fuera/Escape la cierran.
  const [actionsMenuFor, setActionsMenuFor] = useState<string | null>(null);
  useEffect(() => {
    if (!actionsMenuFor) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActionsMenuFor(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [actionsMenuFor]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('all');
  const [showDrawer, setShowDrawer] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [justSavedStudent, setJustSavedStudent] = useState<Student | null>(null);
  const [inspectStudent, setInspectStudent] = useState<Student | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Ronda 18 (H4): confirmación propia para eliminar estudiante (antes confirm() nativo)
  const [deleteConfirm, setDeleteConfirm] = useState<{ title: string; message: string; requireText?: string; action: () => void } | null>(null);
  // R67 (§12A — reset individual): estado del modal de restablecimiento de clave.
  // Reemplaza el AccountSyncModal de R66 (que pedía la clave anterior — ya innecesario:
  // el endpoint admin resetea Firebase con la SA sin conocerla, §11).
  const [resetState, setResetState] = useState<{ who: string; code: string; hasAccount: boolean } | null>(null);
  const [resetStrategy, setResetStrategy] = useState<'manual' | 'default' | 'random'>('default');
  const [resetManualPw, setResetManualPw] = useState('');
  const [resetGenerated, setResetGenerated] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const singlePhotoInputRef = useRef<HTMLInputElement>(null);

  const uniqueGrades = AttendanceStorageService.getUniqueGrades();

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      // Ronda 60-h (reactividad UI): el listener debe actualizar también los snapshots
      // locales (inspectStudent, justSavedStudent, editingStudent) porque si un cambio
      // externo (p.ej. edición desde otro componente) los deja stale, el visor no se
      // entera hasta recargar la página. Ahora re-buscamos el estudiante por código
      // para mantener los snapshots frescos sin perder el modal abierto.
      setStudents(AttendanceStorageService.getStudents());
      setSettings(AttendanceStorageService.getSettings());
      // Re-buscar el estudiante activo en el visor por su código (si sigue existiendo)
      setInspectStudent(prev => prev ? (AttendanceStorageService.getStudentByCodeOrDoc(prev.code) || prev) : prev);
      setJustSavedStudent(prev => prev ? (AttendanceStorageService.getStudentByCodeOrDoc(prev.code) || prev) : prev);
      // No tocamos editingStudent: el formulario de edición es editado por el usuario,
      // no queremos pisar lo que está escribiendo con datos del storage.
    });
    return unsubscribe;
  }, []);

  // Ronda 8 (B1): Escape cierra los modales de esta vista — primero la Previsualización
  // de Carné y, si no, el Drawer de Matrícula/Edición (patrón Regla E10 de SettingsModal).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (inspectStudent) setInspectStudent(null);
      else if (showDrawer) setShowDrawer(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectStudent, showDrawer]);

  // Form State con soporte para Tipo de Doc y Foto Opcional
  // Ronda 60-g: el PIN / Clave de Acceso Portal es un campo EXPLÍCITO del formulario.
  // Antes se derivaba automáticamente del documento ('SJ-' + últimos 4), patrón
  // público que permitía entrar al portal de cualquier estudiante (F-18). Ahora
  // Rectoría asigna el PIN manualmente o deja vacío (el carné muestra
  // 'Solicitar en Rectoría' como estado vacío claro).
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    grade: '6°3',
    documentType: 'TI' as DocumentType,
    documentId: '',
    photoUrl: '',
    accessPin: '', // Ronda 60-g: PIN / Clave de Acceso Portal (opcional, asignado por Rectoría)
    excuseDataConsent: false // Ronda 22 (P4): cláusula Ley 1581 art. 7 — consentimiento del representante legal
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
      photoUrl: '',
      accessPin: '', // Ronda 60-g: nuevo estudiante sin PIN asignado
      excuseDataConsent: false
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
      photoUrl: student.photoUrl || '',
      accessPin: student.tempPassword || '', // Ronda 60-g: precargar PIN existente para edición
      excuseDataConsent: !!student.excuseDataConsent
    });
    setFormError(null);
    setShowDrawer(true);
  };

  const handleSinglePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressImageFile(file).then(dataUrl => {
        setFormData(prev => ({ ...prev, photoUrl: dataUrl }));
      }).catch(err => console.error('Image compression failed:', err));
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

    if (!grade || !isValidGrade(grade)) {
      setFormError('Por favor indique un grado escolar válido (ej: 6°1, 10°4, 11°2, Transición).');
      return;
    }

    // R66→R67: si el estudiante tiene cuenta de acceso y la clave cambia, la nueva
    // clave SERÁ también la contraseña de su cuenta Firebase → mínimo 6 caracteres
    // (auth/weak-password). Para fichas SIN cuenta, la clave puede ser más corta
    // (es solo la clave del login local del carné).
    const pinForAccount = formData.accessPin.trim();
    if (editingStudent?.hasFirebaseAccount && pinForAccount && pinForAccount.length < 6) {
      setFormError('Este estudiante tiene cuenta de acceso: la clave debe tener 6 o más caracteres (requisito de Firebase).');
      return;
    }

    if (editingStudent) {
      // R67 (§9 — política de edición): campo vacío = NO cambiar la clave actual
      // (se conserva la que la ficha ya tiene; para cambiarla, escríbela o usa el
      // botón "Restablecer clave" del menú de acciones). Llena = cambiarla.
      const oldPin = (editingStudent.tempPassword || '').trim();
      const newPin = formData.accessPin.trim();
      const pinChanged = newPin !== '' && newPin !== oldPin;
      AttendanceStorageService.updateStudent(editingStudent.code, {
        firstName,
        lastName,
        documentId: cleanDocumentId,
        documentType: formData.documentType,
        grade,
        photoUrl: formData.photoUrl || undefined,
        // R67: vacío conserva (undefined NO pisa el plaintext existente — el pull
        // ya cuida la coherencia con el verifier de la nube).
        ...(pinChanged ? { tempPassword: newPin } : {}),
        // Ronda 22 (P4): el consentimiento art. 7 también se actualiza en la ficha
        excuseDataConsent: formData.excuseDataConsent,
        excuseDataConsentAt: formData.excuseDataConsent
          ? (editingStudent.excuseDataConsentAt || new Date().toISOString())
          : undefined
      });
      refreshList();
      setShowDrawer(false);
      setToastMessage(`Estudiante ${firstName} ${lastName} actualizado correctamente.`);
      setTimeout(() => setToastMessage(null), 3500);
      // R67 (§11 — restablecimiento administrativo SIN clave anterior): si la clave
      // cambió y el estudiante tiene cuenta, el endpoint /api/admin/credential/reset
      // actualiza Firebase (SA) + verifier de la nube en UNA operación atómica.
      // Esto reemplaza el patrón R61/R66 (provisioner con la clave vieja + modal
      // pidiéndola): Rectoría es la autoridad administrativa.
      if (pinChanged && editingStudent.hasFirebaseAccount) {
        setToastMessage(`Restableciendo la cuenta de acceso de ${firstName}…`);
        const res = await CloudflareSyncService.adminCredentialReset('student', [{ code: editingStudent.code, password: newPin }], 'rectoria-editar-ficha');
        if (res.ok) {
          setToastMessage(`Clave de acceso actualizada: el nuevo PIN de ${firstName} ya funciona también en su teléfono.`);
          setTimeout(() => setToastMessage(null), 5000);
        } else {
          const r = res.results?.[0];
          setToastMessage(`⚠ La ficha quedó con la clave nueva, pero la CUENTA de ${firstName} no: ${r?.error || res.message}. Usa "Restablecer clave" del menú de acciones para reintentarlo.`);
          setTimeout(() => setToastMessage(null), 9000);
        }
      } else if (pinChanged) {
        // sin cuenta: el verifier viaja con el push (sello R67 ya aplicado por
        // updateStudent) — nada más que hacer aquí.
      }
    } else {
      // R67 (§9 — registro): campo vacío = GENERAR según política (predeterminada
      // configurada → aleatoria). El estudiante siempre nace con clave coherente
      // y se muestra en el modal de éxito (copia incluida).
      const resolved = resolveAccessPassword(formData.accessPin.trim(), settings.defaultAccessPassword);
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
        // R67 (§9): manual → esa; vacío → predeterminada configurada → aleatoria.
        // La clave mostrada en el modal de éxito es EXACTAMENTE esta (misma que el
        // verifier y que la cuenta si se crea). Jamás se deriva del documento (F-18).
        tempPassword: resolved.password,
        // Ronda 22 (P4): consentimiento específico del representante legal (Ley 1581 arts. 7 y 9)
        excuseDataConsent: formData.excuseDataConsent,
        excuseDataConsentAt: formData.excuseDataConsent ? new Date().toISOString() : undefined
      };

      const res = AttendanceStorageService.addStudent(newStudent);
      if (!res.success) {
        setFormError(res.error || 'Error al registrar estudiante.');
        return;
      }

      refreshList();
      setShowDrawer(false);
      setJustSavedStudent(newStudent);
      setToastMessage(`Estudiante ${firstName} ${lastName} matriculado en grado ${grade}.${resolved.origin !== 'manual' ? ` Clave de acceso generada (${resolved.origin === 'default' ? 'predeterminada' : 'aleatoria'}): ${resolved.password}` : ''}`);
      setTimeout(() => setToastMessage(null), 6000);
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

  // R67 (§12A — restablecimiento INDIVIDUAL): abre el modal de estrategia
  // (manual / predeterminada / aleatoria) para UN estudiante. La operación usa
  // /api/admin/credential/reset (Firebase con SA + verifier CAS) — Rectoría NO
  // necesita conocer la clave anterior (§11: es una operación administrativa).
  const openResetModal = (student: Student) => {
    setResetState({
      who: `${student.firstName} ${student.lastName}`,
      code: student.code,
      hasAccount: !!student.hasFirebaseAccount
    });
    setResetStrategy('default');
    setResetManualPw('');
    setResetGenerated(null);
    setResetError(null);
  };

  const executeReset = async () => {
    if (!resetState) return;
    const resolved = resolveAccessPassword(
      resetStrategy === 'manual' ? resetManualPw : '',
      resetStrategy === 'default' ? settings.defaultAccessPassword : ''
    );
    if (resetStrategy === 'manual' && resolved.password.length < 6) {
      setResetError('La clave manual debe tener 6 o más caracteres (requisito de Firebase).');
      return;
    }
    if (resetStrategy === 'random') {
      // mostrar la clave generada ANTES de aplicarla (confirmación explícita)
      if (resetGenerated !== resolved.password) {
        setResetGenerated(resolved.password);
        setResetError(null);
        return;
      }
    }
    setResetBusy(true);
    setResetError(null);
    try {
      const res = await CloudflareSyncService.adminCredentialReset(
        'student', [{ code: resetState.code, password: resolved.password }], 'rectoria-reset-individual');
      const r = res.results?.[0];
      if (r?.ok) {
        // Ficha local alineada (plaintext + verifier con sello fresco).
        AttendanceStorageService.updateStudent(resetState.code, {
          tempPassword: resolved.password,
          hasCustomPassword: true
        } as any);
        refreshList();
        setResetState(null);
        setToastMessage(`Clave de ${resetState.who} restablecida: ${resolved.password}${r.mode === 'account+verifier' ? ' (cuenta Firebase + nube alineadas)' : r.mode === 'verifier-only' ? ' (ficha sin cuenta — clave del carné)' : ''}.`);
        setTimeout(() => setToastMessage(null), 8000);
      } else {
        setResetError(r?.error || res.message || 'No se pudo restablecer la clave.');
      }
    } finally {
      setResetBusy(false);
    }
  };

  // R67 (§12B — restablecimiento MASIVO): sobre el conjunto DINÁMICO de
  // estudiantes (jamás una lista fija). Confirmación con conteo real, estrategia
  // elegible, ejecución en fragmentos con progreso, resultados por-usuario y
  // descarga CSV de credenciales para su reparto. Los fallos se listan
  // explícitamente — nunca "éxito total" con fallos presentes.
  const [bulkState, setBulkState] = useState<{ running: boolean; done: number; total: number; results: Array<{ code: string; name: string; password: string; ok: boolean; error?: string }> } | null>(null);
  const [bulkStrategy, setBulkStrategy] = useState<'default' | 'random' | 'manual'>('default');
  const [bulkManualPw, setBulkManualPw] = useState('');

  const openBulkReset = () => {
    const targets = students.filter(s => s && s.active !== false);
    const withAccount = targets.filter(s => s.hasFirebaseAccount);
    const withoutAccount = targets.filter(s => !s.hasFirebaseAccount);
    if (withAccount.length === 0 && withoutAccount.length === 0) {
      setToastMessage('No hay estudiantes en la matrícula.');
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }
    setBulkConfirmOpen({ total: targets.length, withAccount: withAccount.length, withoutAccount: withoutAccount.length });
    setBulkStrategy(settings.defaultAccessPassword ? 'default' : 'random');
    setBulkManualPw('');
  };
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState<{ total: number; withAccount: number; withoutAccount: number } | null>(null);

  const executeBulkReset = async () => {
    if (!bulkConfirmOpen) return;
    const targets = students.filter(s => s && s.active !== false);
    const resolvedFor = () => resolveAccessPassword(
      bulkStrategy === 'manual' ? bulkManualPw : '',
      bulkStrategy === 'default' ? settings.defaultAccessPassword : ''
    );
    if (bulkStrategy === 'manual') {
      const chk = resolveAccessPassword(bulkManualPw, '');
      if (chk.origin === 'manual' && chk.password.length < 6) {
        setToastMessage('⚠ La clave manual debe tener 6 o más caracteres (requisito de Firebase).');
        setTimeout(() => setToastMessage(null), 5000);
        return;
      }
    }
    setBulkConfirmOpen(null);
    setBulkState({ running: true, done: 0, total: targets.length, results: [] });
    const results: Array<{ code: string; name: string; password: string; ok: boolean; error?: string }> = [];
    const CHUNK = 10;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK).map(s => {
        const r = resolvedFor();
        return { s, password: r.password };
      });
      const res = await CloudflareSyncService.adminCredentialReset(
        'student',
        chunk.map(c => ({ code: c.s.code, password: c.password })),
        'rectoria-reset-masivo'
      );
      chunk.forEach(c => {
        const r = res.results?.find(x => x.code === c.s.code);
        results.push({
          code: c.s.code,
          name: `${c.s.firstName} ${c.s.lastName}`,
          password: c.password,
          ok: !!r?.ok,
          error: r?.error
        });
        // ficha local alineada para los exitosos
        if (r?.ok) {
          AttendanceStorageService.updateStudent(c.s.code, { tempPassword: c.password, hasCustomPassword: true } as any);
        }
      });
      setBulkState({ running: true, done: Math.min(i + CHUNK, targets.length), total: targets.length, results: [...results] });
    }
    setBulkState({ running: false, done: results.length, total: targets.length, results });
    refreshList();
    const okCount = results.filter(r => r.ok).length;
    setToastMessage(okCount === results.length
      ? `Claves restablecidas para ${okCount} estudiantes. Descarga la lista de credenciales en el panel de resultados.`
      : `⚠ ${okCount}/${results.length} restablecidas — revisa los fallos en el panel de resultados.`);
    setTimeout(() => setToastMessage(null), 10000);
  };

  const downloadBulkCsv = () => {
    if (!bulkState) return;
    const rows = [
      'Codigo,Nombre,ClaveNueva,Resultado,Detalle',
      ...bulkState.results.map(r => `${r.code},"${r.name}","${r.password}",${r.ok ? 'OK' : 'FALLO'},"${(r.error || '').replace(/"/g, "'")}"`)
    ].join('\n');
    const blob = new Blob(['\ufeff' + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claves_acceso_estudiantes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Ronda 50 (M3): provee la cuenta REAL de Firebase Auth del estudiante (acceso por
  // identidad desde cualquier teléfono). Usa la clave temporal del carné como contraseña
  // inicial y el rol ESTUDIANTE_ACUDIENTE. Si ya hay cuenta, se informa que existe.
  // Ronda 60-g: si el estudiante no tiene PIN asignado, se le pide a Rectoría que lo asigne
  // antes de crear la cuenta de acceso (sin PIN no hay credencial que usar como contraseña).
  // R67: la cuenta nace con la clave del carné como contraseña (flujo REAL de
  // Rectoría — Regla 7: la provisión de cuentas SIGUE en el cliente). El verifier
  // de la ficha en la nube se publica con el CAS directo del cambio de PIN vía el
  // endpoint admin de credenciales (modo verifier — la cuenta la acaba de crear
  // este flujo con la MISMA clave, así que la operación es convergente).
  const handleCreateStudentAccount = async (student: Student) => {
    const accessKey = student.tempPassword;
    if (!accessKey) {
      setToastMessage(`${student.firstName} ${student.lastName} no tiene Clave de Acceso asignada. Genere o escriba una desde "Editar ficha" (o "Restablecer clave") antes de crear la cuenta de acceso.`);
      setTimeout(() => setToastMessage(null), 5000);
      return;
    }
    if (accessKey.length < 6) {
      setToastMessage(`La clave de ${student.firstName} debe tener 6 o más caracteres para poder ser contraseña de su cuenta (Firebase). Use "Restablecer clave" para asignar una válida.`);
      setTimeout(() => setToastMessage(null), 6000);
      return;
    }
    try {
      if (student.hasFirebaseAccount) {
        setToastMessage(`Este estudiante ya tiene cuenta de acceso (${student.authEmail || 'identidad'}). Para cambiar su clave use "Restablecer clave" del menú de acciones.`);
        setTimeout(() => setToastMessage(null), 5000);
        return;
      }
      const result = await FirebaseService.provisionStudentAccount(student.code, accessKey, student.code, `${student.firstName} ${student.lastName}`);
      AttendanceStorageService.updateStudent(student.code, {
        hasFirebaseAccount: true,
        authEmail: result.email,
        authUid: result.uid
      });
      refreshList();
      setToastMessage(`Cuenta de acceso creada para ${student.firstName} ${student.lastName}. Publicando la ficha en la nube para que pueda entrar desde cualquier dispositivo…`);
      setTimeout(() => setToastMessage(null), 4000);
      // R67 (§36): publicación INMEDIATA de la ficha — sin esto, el estudiante no
      // podía entrar desde otro dispositivo hasta el próximo push (5 min o manual).
      // El push también sella el verifier de la clave con la que la cuenta nació.
      try {
        const sync = await CloudflareSyncService.performCloudflareSync();
        if (sync.success) {
          setToastMessage(`Cuenta creada y ficha publicada: ${student.firstName} ya puede entrar desde su teléfono con su código y clave (${accessKey}).`);
        } else {
          setToastMessage(`Cuenta creada. La ficha se publicará con la próxima sincronización (${sync.message || 'pendiente'}). El estudiante podrá entrar desde su teléfono entonces.`);
        }
      } catch {
        setToastMessage(`Cuenta creada. La ficha se publicará con la próxima sincronización. El estudiante podrá entrar desde su teléfono entonces.`);
      }
      setTimeout(() => setToastMessage(null), 9000);
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/email-already-in-use') {
        // R67 (huérfanas): la cuenta existe pero sin ficha vinculada — el camino
        // determinista es restablecer la clave (SA) y re-vincular el espejo.
        setToastMessage(`Ya existe una cuenta con la identidad de ${student.firstName} (huérfana de una ficha anterior). Use "Restablecer clave" para tomar el control de esa cuenta y alinearla.`);
        setTimeout(() => setToastMessage(null), 9000);
        return;
      }
      setToastMessage(`No se pudo crear la cuenta de acceso (${FirebaseService.mapAuthError(err)}). Reintente con "Crear Cuenta de Acceso".`);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleDelete = (code: string, name: string) => {
    // R64 (Fix §5 — ELIMINACIÓN EN CASCADA, paso 1 de 2): Rectoría confirma la
  // intención. La cascada completa purga D1 (asistencias, excusas + eventos
  // del-, suscripciones push, fila), el snapshot (ficha, horario, tombstone),
  // el índice KV, la versión de catálogo y la cuenta Firebase Auth (provisioner
  // con la clave vigente — el paso 2 pide confirmación explícita con el texto
  // ELIMINAR). El borrado local anterior (solo ficha + tombstone) dejaba la
  // cuenta viva y TODA la huella D1 huérfana.
    setDeleteConfirm({
      title: 'Eliminar estudiante (paso 1 de 2)',
      message: `¿Eliminar al estudiante ${name} (${code})? Se abrirá una segunda confirmación: la eliminación es EN CASCADA y purga TODO (asistencias, excusas, suscripciones, catálogo de la nube y cuenta de acceso).`,
      action: () => {
        setDeleteConfirm({
          title: 'CONFIRMAR eliminación en cascada',
          message: `Escriba ELIMINAR para borrar a ${name} (${code}) y TODA su huella: registros de asistencia, excusas, suscripciones push, ficha del catálogo (D1 + snapshot + KV) y su cuenta de acceso Firebase. Esta acción no se puede deshacer.`,
          requireText: 'ELIMINAR',
          action: () => executeCascadeDelete(code, name, 'student')
        });
      }
    });
  };

  // R64 (Fix §5): ejecución de la cascada — nube primero (endpoint ADMIN),
  // cuenta Firebase después (provisioner con la clave vigente si se conoce),
  // borrado local al final (ficha + tombstone). Cada paso reporta honestamente.
  const executeCascadeDelete = async (code: string, name: string, _type: 'student') => {
    setToastMessage(`Eliminando en cascada: ${name}…`);
    setTimeout(() => setToastMessage(null), 4000);

    // 1. La nube (D1 + snapshot + KV + versión) — endpoint de Rectoría.
    const cloud = await CloudflareSyncService.cascadeDeleteEntity('student', code);
    if (!cloud.ok) {
      setToastMessage(`⚠ La eliminación en la nube FALLÓ y NO se completó: ${cloud.message || 'error desconocido'}. No se borró nada localmente (reintenta cuando la nube responda).`);
      setTimeout(() => setToastMessage(null), 8000);
      return;
    }

    // 2. Cuenta Firebase Auth (provisioner — solo si existe y conocemos la clave vigente).
    const student = students.find(s => s.code === code);
    let accountNote = '';
    if (student?.hasFirebaseAccount) {
      const knownPin = (student.tempPassword || '').trim();
      if (knownPin) {
        const del = await FirebaseService.deleteProvisionedAccount(
          student.authEmail || FirebaseService.studentInternalEmail(code),
          knownPin
        );
        accountNote = del.ok
          ? ' Cuenta de acceso Firebase eliminada.'
          : ` ⚠ La cuenta de acceso NO se pudo eliminar (${del.message || 'contraseña vigente desconocida'}). Bórrela después desde "Editar ficha" con la clave correcta, o reiníciela primero.`;
      } else {
        accountNote = ' ⚠ Sin clave vigente registrada: la cuenta de acceso Firebase quedó VIVA. Asígnele un PIN conocido, sincronice y vuelva a eliminar para cerrarla.';
      }
    }

    // 3. Local: ficha + tombstone (el pull ya no la traerá de vuelta).
    AttendanceStorageService.deleteStudent(code);
    refreshList();

    // 4. Convergencia: descargar el catálogo nuevo (la versión subió).
    try {
      await CloudflareSyncService.pullFromCloudflare();
    } catch { /* el auto-sync convergerá */ }

    setToastMessage(`Estudiante ${name} eliminado en cascada.${cloud.message ? ` (${cloud.message})` : ''}${accountNote}`);
    setTimeout(() => setToastMessage(null), accountNote ? 10000 : 6000);
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
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 uppercase tracking-wider">
              {currentRole === 'DOCENTE' ? 'Directorio Docente' : 'Directorio Escolar'}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            {currentRole === 'DOCENTE' ? 'Consulta de Estudiantes y Carnés' : 'Registro y Gestión de Estudiantes'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {currentRole === 'DOCENTE'
              ? 'Consulta la lista general de estudiantes, busca por curso o documento y genera o descarga sus carnés.'
              : 'Matricula estudiantes individuales o carga fichas masivas con fotos de carné opcionales.'}
          </p>
        </div>

        {currentRole === 'ADMIN' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Botón Cargar Archivo / Upload File */}
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-2xl text-xs font-bold transition-all border border-slate-200 dark:border-zinc-800 shadow-xs flex items-center justify-center gap-2"
              title="Cargar Fichas PDF, Fotos Carné, Planillas CSV o Listas de Matrícula"
            >
              <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Cargar Archivo(s)</span>
            </button>

            {/* R67 (§12B — restablecimiento MASIVO): sobre el conjunto dinámico de
                estudiantes, con confirmación, estrategia y resultados honestos. */}
            {currentRole === 'ADMIN' && (
              <button
                onClick={openBulkReset}
                className="flex-1 sm:flex-initial px-4 py-2.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-2xl text-xs font-bold transition-all border border-amber-200 dark:border-amber-800/60 shadow-xs flex items-center justify-center gap-2"
                title="Restablecer la clave de acceso de TODOS los estudiantes (operación administrativa masiva con confirmación)"
              >
                <KeyRound className="w-4 h-4" />
                <span>Restablecer claves (todos)</span>
              </button>
            )}

            {/* Botón Nuevo Estudiante */}
            <button
              onClick={handleOpenAdd}
              className="flex-1 sm:flex-initial px-4 py-2.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Nuevo Estudiante</span>
            </button>
          </div>
        )}
      </div>

      {/* Ronda 27 (entrega limpia): onboarding de matrícula vacía — solo visible con 0 estudiantes.
          Guía el Día Cero: importar la matrícula real (CSV/Excel/SIMAT) o crear el primer estudiante. */}
      {students.length === 0 && (
        <div className="p-4 rounded-3xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">
                Sistema listo. Importa tu matrícula para comenzar.
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {currentRole === 'ADMIN'
                  ? 'Carga la lista oficial (CSV / Excel / SIMAT) o matricula estudiantes uno a uno. La demo sigue disponible en Ajustes → "Reiniciar datos de prueba".'
                  : 'Aún no hay estudiantes registrados. Rectoría debe importar la matrícula para comenzar.'}
              </p>
            </div>
          </div>
          {currentRole === 'ADMIN' && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Importar matrícula (CSV/Excel/SIMAT)</span>
              </button>
              <button
                onClick={handleOpenAdd}
                className="px-4 py-2 bg-white dark:bg-black hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-zinc-800 flex items-center gap-2"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Nuevo estudiante</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Student Directory Table */}
      <div className="p-5 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, documento (TI, CC, RC) o código..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="px-3.5 py-2.5 bg-white dark:bg-black/70 border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold focus:outline-none"
            >
              <option value="all">Todos los Cursos ({students.length})</option>
              {uniqueGrades.map(g => (
                <option key={g} value={g}>Grado {g}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Responsive Table */}
        <div className="w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-zinc-800/50">
          <table className="w-full text-left text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-zinc-800/50 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-3">Estudiante</th>
                <th className="py-3 px-3">Grado / Curso</th>
                <th className="py-3 px-3">Tipo / Documento</th>
                <th className="py-3 px-3">Código QR / Barras</th>
                <th className="py-3 px-3">Rol en Aula</th>
                <th className="py-3 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {/* Ronda 27 (entrega limpia): empty state útil — nunca una tabla en blanco silencioso. */}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      {students.length === 0
                        ? 'Aún no hay estudiantes. Importa la matrícula (CSV/Excel/SIMAT) o crea el primero con "+ Nuevo Estudiante".'
                        : 'Sin resultados para la búsqueda o el filtro aplicado.'}
                    </p>
                  </td>
                </tr>
              )}
              {filteredStudents.map((std) => (
                <tr key={std.code} className="hover:bg-slate-100 dark:hover:bg-zinc-900/50 transition-colors group border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:shadow-sm">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                    <div className="flex items-center gap-2.5">
                      {std.photoUrl ? (
                        <img
                          src={std.photoUrl}
                          alt={`${std.firstName} ${std.lastName}`}
                          className="w-7 h-7 rounded-lg object-cover border border-slate-300 dark:border-zinc-800 shadow-xs shrink-0"
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
                  {/* Ronda 25 (P5.2): truncate + title en móvil — el código/documento ya no se
                      cortan en seco (el QA externo vio "100" por un "1000000999" truncado). */}
                  <td className="py-3 px-3 font-mono text-slate-700 dark:text-slate-300 max-w-[150px]">
                    <span className="block truncate" title={`${std.documentType || 'TI'} ${std.documentId}`}>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold mr-1.5">
                        {std.documentType || 'TI'}
                      </span>
                      {std.documentId}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-mono text-indigo-600 dark:text-indigo-400 font-bold max-w-[120px]">
                    <span className="block truncate" title={std.code}>{std.code}</span>
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
                        className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 text-slate-500 hover:text-amber-700 text-[10px] font-medium border border-slate-200 dark:border-zinc-800 flex items-center gap-1 transition-colors"
                        title="Asignar como Representante de este curso"
                      >
                        <span>Hacer Rep</span>
                      </button>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right relative">
                    {/* Ronda 21 UI-2: tuerca de ajustes → mini-tarjetas alargadas.
                        El clic-fuera se captura con un overlay transparente (z-20) para
                        no necesitar un ref por fila. */}
                    <button
                      onClick={() => setActionsMenuFor(actionsMenuFor === std.code ? null : std.code)}
                      aria-expanded={actionsMenuFor === std.code}
                      aria-haspopup="menu"
                      aria-label={`Acciones de ${std.firstName} ${std.lastName}`}
                      title="Acciones"
                      className={`p-2 rounded-xl transition-all inline-flex items-center justify-center ${
                        actionsMenuFor === std.code
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                          : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400'
                      }`}
                    >
                      <GearIcon className="w-4 h-4" />
                    </button>

                    {actionsMenuFor === std.code && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setActionsMenuFor(null)} aria-hidden="true" />
                        <div
                          role="menu"
                          aria-label={`Acciones para ${std.firstName} ${std.lastName}`}
                          className="absolute right-2 top-full mt-1 z-30 w-52 p-1.5 rounded-2xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/60 shadow-2xl shadow-slate-900/10 space-y-1 text-left animate-fadeIn"
                        >
                          <button
                            role="menuitem"
                            onClick={() => { setActionsMenuFor(null); setInspectStudent(std); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-zinc-800/60 hover:border-indigo-300 dark:hover:border-indigo-800 hover:shadow-sm transition-all"
                          >
                            <Eye className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-[11px] font-black text-slate-800 dark:text-slate-100">Ver carné</span>
                              <span className="block text-[9px] text-slate-400">Previsualizar digital</span>
                            </span>
                          </button>
                          <button
                            role="menuitem"
                            onClick={() => { setActionsMenuFor(null); handleDownloadPdf(std); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-zinc-800/60 hover:border-indigo-300 dark:hover:border-indigo-800 hover:shadow-sm transition-all"
                          >
                            <Download className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-[11px] font-black text-slate-800 dark:text-slate-100">Descargar PDF</span>
                              <span className="block text-[9px] text-slate-400">Carné imprimible CR80</span>
                            </span>
                          </button>
                          {currentRole === 'ADMIN' && (
                            <>
                              <button
                                role="menuitem"
                                onClick={() => { setActionsMenuFor(null); openResetModal(std); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-zinc-800/60 hover:border-indigo-300 dark:hover:border-indigo-800 hover:shadow-sm transition-all"
                              >
                                <KeyRound className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                <span className="min-w-0">
                                  <span className="block text-[11px] font-black text-slate-800 dark:text-slate-100">Restablecer clave</span>
                                  <span className="block text-[9px] text-slate-400">Sin conocer la anterior</span>
                                </span>
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => { setActionsMenuFor(null); handleOpenEdit(std); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-zinc-800/60 hover:border-indigo-300 dark:hover:border-indigo-800 hover:shadow-sm transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300 shrink-0" />
                                <span className="min-w-0">
                                  <span className="block text-[11px] font-black text-slate-800 dark:text-slate-100">Editar ficha</span>
                                  <span className="block text-[9px] text-slate-400">Datos, foto y rol en aula</span>
                                </span>
                              </button>
                              <button
                                role="menuitem"
                                onClick={() => { setActionsMenuFor(null); handleDelete(std.code, `${std.firstName} ${std.lastName}`); }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-rose-50/80 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/60 hover:border-rose-300 dark:hover:border-rose-800 hover:shadow-sm transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                <span className="min-w-0">
                                  <span className="block text-[11px] font-black text-rose-700 dark:text-rose-300">Eliminar</span>
                                  <span className="block text-[9px] text-rose-400/80">Quitar de la matrícula</span>
                                </span>
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
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
          <div className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
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
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs uppercase text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs uppercase text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                      className="w-full px-2.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-60"
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
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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

                {/* Ronda 60-g: PIN / Clave de Acceso Portal — campo explícito, opcional.
                    Antes se derivaba automáticamente del documento ('SJ-' + últimos 4),
                    patrón público que vulneraba F-18. Ahora Rectoría lo asigna manualmente
                    o lo deja vacío (el carné muestra 'Solicitar en Rectoría'). */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                      <span>5. Clave de Acceso (contraseña del portal y de la cuenta)</span>
                    </label>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {editingStudent ? 'Vacío = conservar la actual' : 'Vacío = se genera una'}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={formData.accessPin}
                    onChange={(e) => setFormData({ ...formData, accessPin: e.target.value })}
                    placeholder={editingStudent
                      ? (editingStudent.tempPassword || 'Ej: 839274 — déjalo vacío para NO cambiar la clave actual')
                      : 'Ej: 839274 · vacío = se genera automáticamente (6+ caracteres)'}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {editingStudent
                      ? 'Esta es la contraseña con la que el estudiante entra a su portal (y a su cuenta de acceso si tiene una). Déjala VACÍA para conservar la actual sin cambios; escríbela para cambiarla; o usa «Restablecer clave» en el menú de acciones para generar una. Firebase exige 6 o más caracteres cuando hay cuenta.'
                      : 'La clave con la que el estudiante entrará a su portal. Si la dejas vacía se genera una automáticamente (predeterminada configurada o aleatoria segura) y se muestra al guardar. Con cuenta de acceso, Firebase exige 6 o más caracteres. Jamás se deriva del documento.'}
                  </p>
                  {editingStudent?.hasFirebaseAccount && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight font-bold">
                      Este estudiante tiene cuenta de acceso: al cambiar y guardar la clave, la contraseña de su cuenta se actualiza en la misma operación (sin necesidad de conocer la anterior).
                    </p>
                  )}
                </div>

                {/* 6. Fotografía del Carné (Exclusiva del Formulario Individual) */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Camera className="w-3.5 h-3.5 text-indigo-500" />
                      <span>6. Foto del Carné (Individual)</span>
                    </label>
                    {formData.photoUrl && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, photoUrl: '' })}
                        className="text-[10px] font-bold text-rose-500 hover:underline"
                      >
                        Quitar Foto
                      </button>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-400 leading-tight">
                    Ingresa una URL o sube una imagen. La personalización de fotos se gestiona únicamente de forma individual aquí o por el estudiante en su portal.
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="url"
                      value={formData.photoUrl}
                      onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                      placeholder="https://ejemplo.com/foto.jpg"
                      className="flex-1 px-3 py-2 bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />

                    <label className="cursor-pointer px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all border border-slate-200 dark:border-zinc-800 flex items-center gap-1.5 shrink-0">
                      <Upload className="w-3 h-3 text-indigo-500" />
                      <span>Subir</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleSinglePhotoSelect}
                      />
                    </label>
                  </div>
                </div>

                {/* Ronda 22 (P4): cláusula de consentimiento art. 7 Ley 1581 — dato especial de salud */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40">
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.excuseDataConsent}
                      onChange={(e) => setFormData({ ...formData, excuseDataConsent: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded accent-amber-600"
                    />
                    <span className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug">
                      <span className="font-black">Consentimiento del representante legal (opcional): </span>
                      autoriza el tratamiento del <span className="font-bold">soporte fotográfico de incapacidades/citas médicas</span> radicadas en el Buzón de Justificaciones (dato especial de salud — Ley 1581 de 2012, arts. 7 y 9).
                      La foto viaja cifrada (AES-GCM), solo la ven Rectoría y el estudiante, y se purga al final del término +1 año.
                      Sin esta autorización, el soporte puede presentarse exclusivamente de forma física.
                    </span>
                  </label>
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
                    className="px-5 py-2.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
                  >
                    <Check className="w-4 h-4" />
                    <span>{editingStudent ? 'Actualizar' : 'Guardar y Generar'}</span>
                  </button>
                </div>
              </form>

              {/* Right Column: Live Dynamic Card Preview */}
              <div className="space-y-3 p-4 bg-slate-50 dark:bg-black/60 rounded-3xl border border-slate-200 dark:border-zinc-800/50 text-slate-900">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-indigo-500" />
                    Previsualización en Tiempo Real
                  </span>
                  <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">● Activo</span>
                </div>

                {/* Simulated Physical Card */}
                <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-gradient-to-br from-slate-50 via-sky-50/40 to-indigo-50/30 border-2 border-slate-300 dark:border-zinc-800 shadow-md p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
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
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-indigo-500/40 shadow-2xl max-w-md w-full text-center space-y-4">
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

            {/* Ronda 34 (H-34-2): la clave de acceso ANTES solo existía en el PDF impreso —
                Rectoría no podía verla en pantalla y el estudiante quedaba sin credencial
                utilizable. Ahora se muestra junto al código, con copia al portapapeles.
                Ronda 60-g: si el estudiante se creó SIN PIN, se muestra "Solicitar en
                Rectoría" y un enlace rápido a Editar ficha para asignarlo. */}
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-left space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">PIN / Clave de Acceso Portal</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">Código</span>
                  <span className="font-mono text-sm font-black text-slate-900 dark:text-white truncate block">{justSavedStudent.code}</span>
                </div>
                <div className="min-w-0 text-right">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">PIN / Clave</span>
                  {justSavedStudent.tempPassword ? (
                    <span className="font-mono text-sm font-black text-amber-700 dark:text-amber-300 truncate block">{justSavedStudent.tempPassword}</span>
                  ) : (
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 truncate block">Solicitar en Rectoría</span>
                  )}
                </div>
                {justSavedStudent.tempPassword && (
                  <button
                    type="button"
                    onClick={() => {
                      const texto = `Código: ${justSavedStudent.code} · PIN: ${justSavedStudent.tempPassword}`;
                      navigator.clipboard?.writeText(texto).then(() => {
                        setToastMessage('Credenciales copiadas al portapapeles.');
                        setTimeout(() => setToastMessage(null), 2500);
                      }).catch(() => {});
                    }}
                    className="p-2 rounded-xl bg-white dark:bg-black border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors shrink-0"
                    title="Copiar código y PIN"
                    aria-label="Copiar código y PIN de acceso"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Entréguelas impresas al estudiante/acudiente: con ellas ingresa al portal
                (pestaña Estudiante / Representante) desde cualquier dispositivo donde esté
                registrada la matrícula. El PIN también va en el reverso del carné PDF.
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
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
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
            <div className="w-full aspect-[85.6/53.98] rounded-2xl bg-gradient-to-br from-slate-50 via-sky-50/40 to-indigo-50/30 border-2 border-slate-300 dark:border-zinc-800 shadow-xl p-3.5 flex flex-col justify-between relative overflow-hidden text-slate-900">
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

            {/* Ronda 34 (H-34-2): clave de acceso consultable — antes solo el PDF la llevaba.
                Bloque discreto (solo para ojos de Rectoría ya autenticada) con copia rápida.
                Ronda 60-g: ahora muestra SIEMPRE el bloque (con "Solicitar en Rectoría" si
                el estudiante no tiene PIN asignado — antes se ocultaba y Rectoría no veía
                que faltaba asignar). */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="min-w-0">
                  <span className="block text-[9px] font-bold uppercase text-slate-400">PIN / Clave de Acceso Portal</span>
                  {inspectStudent.tempPassword ? (
                    <span className="font-mono text-xs font-black text-slate-900 dark:text-white truncate block">{inspectStudent.tempPassword}</span>
                  ) : (
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 truncate block">Solicitar en Rectoría (sin PIN asignado)</span>
                  )}
                </div>
              </div>
              {inspectStudent.tempPassword && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(inspectStudent.tempPassword || '').then(() => {
                      setToastMessage('PIN / Clave de Acceso copiada al portapapeles.');
                      setTimeout(() => setToastMessage(null), 2500);
                    }).catch(() => {});
                  }}
                  className="p-2 rounded-xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shrink-0"
                  title="Copiar PIN / Clave de Acceso"
                  aria-label="Copiar PIN / Clave de Acceso"
                >
                  <Copy className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Ronda 50 (M3): acceso a la nube por identidad — crear cuenta real de Firebase
                para que el estudiante/acudiente entre desde CUALQUIER teléfono (escaneos,
                excusas y su grado en la nube). El correo interno se deriva del código: el
                usuario NUNCA lo ve, entra con su código + clave del carné. */}
            <div className="p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <KeyRound className="w-4 h-4 text-sky-600 shrink-0" />
                <div className="min-w-0">
                  <span className="block text-[9px] font-bold uppercase text-sky-500">Acceso a la nube (identidad)</span>
                  <span className="font-mono text-[11px] font-black text-slate-900 dark:text-white truncate block">
                    {inspectStudent.hasFirebaseAccount ? (inspectStudent.authEmail || 'Cuenta creada') : 'Sin cuenta de acceso aún'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCreateStudentAccount(inspectStudent)}
                disabled={inspectStudent.hasFirebaseAccount}
                className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold shadow-sm shadow-sky-600/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
                title={inspectStudent.hasFirebaseAccount ? 'Ya tiene cuenta de acceso' : 'Crear cuenta de acceso para que entre desde su teléfono'}
                aria-label="Crear cuenta de acceso"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{inspectStudent.hasFirebaseAccount ? 'Con cuenta' : 'Crear Cuenta de Acceso'}</span>
              </button>
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
        onSuccess={(count, skipped) => {
          refreshList();
          if (count === 1) {
            const skipMsg = skipped && skipped > 0 ? ` (${skipped} omitido por duplicado)` : '';
            setToastMessage(`¡Éxito! Se matriculó 1 estudiante y su carné está listo.${skipMsg}`);
          } else if (count > 1) {
            const skipMsg = skipped && skipped > 0 ? ` (${skipped} omitidos por duplicado)` : '';
            setToastMessage(`¡Éxito! Se matricularon ${count} estudiantes y sus carnés están listos.${skipMsg}`);
          } else if (skipped && skipped > 0) {
            setToastMessage(`No se agregaron nuevos estudiantes (${skipped} ya estaban matriculados).`);
          }
          setTimeout(() => setToastMessage(null), 4000);
        }}
      />
    
      {/* Ronda 18 (H4): modal de confirmación propio (reemplaza confirm() nativo) */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title={deleteConfirm?.title || ''}
        message={deleteConfirm?.message || ''}
        requireText={deleteConfirm?.requireText}
        onConfirm={() => { const a = deleteConfirm?.action; setDeleteConfirm(null); a?.(); }}
        onCancel={() => setDeleteConfirm(null)}
      />

      {/* R67 (§12A — modal de restablecimiento INDIVIDUAL): estrategia manual /
          predeterminada / aleatoria. El endpoint admin cambia Firebase con la SA
          SIN conocer la clave anterior (§11) + verifier CAS en la misma operación. */}
      {resetState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Restablecer clave de acceso
                </h3>
              </div>
              <button onClick={() => setResetState(null)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <p>
                <span className="font-bold text-slate-800 dark:text-slate-200">{resetState.who}</span> ({resetState.code})
                {resetState.hasAccount
                  ? ' — la nueva clave se aplica a su CUENTA de acceso (Firebase) y a la ficha de la nube en una sola operación. No necesita conocer la clave anterior.'
                  : ' — este estudiante no tiene cuenta de acceso: se restablece la clave de su ficha (la del carné / login local).'}
              </p>
            </div>
            <div className="space-y-2">
              {(resetStrategy !== 'manual' && settings.defaultAccessPassword
                ? [['default', `Predeterminada (${settings.defaultAccessPassword})`], ['random', 'Aleatoria segura'], ['manual', 'Escribir manualmente']] as const
                : [['random', 'Aleatoria segura'], ['manual', 'Escribir manualmente']] as const
              ).map(([val, label]) => (
                <label key={val} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border cursor-pointer transition-all ${resetStrategy === val ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-zinc-800 hover:border-indigo-200'}`}>
                  <input type="radio" name="reset-strategy" checked={resetStrategy === val} onChange={() => { setResetStrategy(val); setResetGenerated(null); setResetError(null); }} className="accent-indigo-600" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span>
                </label>
              ))}
              {resetStrategy === 'manual' && (
                <input
                  type="text"
                  value={resetManualPw}
                  onChange={(e) => setResetManualPw(e.target.value)}
                  placeholder="La nueva clave (6 o más caracteres)…"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  autoComplete="off"
                />
              )}
              {resetStrategy === 'random' && resetGenerated && (
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                  <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Clave generada (cópiala ahora — se aplica al confirmar)</p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-lg font-black font-mono text-emerald-800 dark:text-emerald-200">{resetGenerated}</code>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(resetGenerated)} className="px-2 py-1 rounded-lg bg-white dark:bg-black border border-emerald-300 dark:border-emerald-800 text-[10px] font-black text-emerald-700 dark:text-emerald-300">COPIAR</button>
                  </div>
                </div>
              )}
              {resetError && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-[11px] font-bold text-rose-700 dark:text-rose-300 leading-relaxed">{resetError}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" disabled={resetBusy} onClick={() => setResetState(null)} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50">Cancelar</button>
              <button type="button" disabled={resetBusy} onClick={executeReset} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                {resetBusy ? 'Restableciendo…' : resetStrategy === 'random' && resetGenerated ? 'Confirmar y aplicar' : 'Restablecer clave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* R67 (§12B — confirmación del restablecimiento MASIVO y panel de resultados) */}
      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-zinc-800/50 pb-3">
              <KeyRound className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">Restablecer claves de TODOS los estudiantes</h3>
            </div>
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <p>Se restablecerá la clave de acceso de <span className="font-bold text-slate-900 dark:text-white">{bulkConfirmOpen.total} estudiantes</span>:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li><span className="font-bold">{bulkConfirmOpen.withAccount}</span> con cuenta Firebase (la clave de SU cuenta cambia — no se necesita la anterior).</li>
                <li><span className="font-bold">{bulkConfirmOpen.withoutAccount}</span> sin cuenta (solo la clave de su ficha/carné).</li>
              </ul>
              <p className="text-amber-600 dark:text-amber-400 font-bold">Los estudiantes deberán usar la clave nueva desde este momento: comunícala con la lista descargable al terminar.</p>
            </div>
            <div className="space-y-2">
              {(settings.defaultAccessPassword
                ? [['default', `Predeterminada para todos (${settings.defaultAccessPassword})`], ['random', 'Aleatoria distinta para cada uno'], ['manual', 'La misma escrita a mano']] as const
                : [['random', 'Aleatoria distinta para cada uno'], ['manual', 'La misma escrita a mano']] as const
              ).map(([val, label]) => (
                <label key={val} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border cursor-pointer transition-all ${bulkStrategy === val ? 'border-amber-400 bg-amber-50/60 dark:bg-amber-950/40' : 'border-slate-200 dark:border-zinc-800 hover:border-amber-200'}`}>
                  <input type="radio" name="bulk-strategy" checked={bulkStrategy === val} onChange={() => setBulkStrategy(val)} className="accent-amber-600" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{label}</span>
                </label>
              ))}
              {bulkStrategy === 'manual' && (
                <input type="text" value={bulkManualPw} onChange={(e) => setBulkManualPw(e.target.value)} placeholder="La misma clave para todos (6 o más caracteres)…" className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-2xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500 outline-none" autoComplete="off" />
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setBulkConfirmOpen(null)} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">Cancelar</button>
              <button type="button" onClick={executeBulkReset} className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/25">Sí, restablecer todas</button>
            </div>
          </div>
        </div>
      )}

      {bulkState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {bulkState.running ? 'Restableciendo claves…' : 'Resultado del restablecimiento masivo'}
              </h3>
              {!bulkState.running && (
                <button onClick={() => setBulkState(null)} className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar"><X className="w-4 h-4" /></button>
              )}
            </div>
            {bulkState.running && (
              <div className="space-y-2">
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round((bulkState.done / Math.max(1, bulkState.total)) * 100)}%` }} />
                </div>
                <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{bulkState.done}/{bulkState.total} estudiantes…</p>
              </div>
            )}
            {!bulkState.running && (
              <>
                <p className={`text-xs font-bold ${bulkState.results.every(r => r.ok) ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {bulkState.results.filter(r => r.ok).length}/{bulkState.results.length} restablecidas correctamente.
                  {bulkState.results.some(r => !r.ok) && ' Los fallos se listan abajo — reintentarlos es seguro (los exitosos ya quedaron aplicados).'}
                </p>
                <div className="max-h-56 overflow-y-auto rounded-2xl border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-800/60">
                  {bulkState.results.map(r => (
                    <div key={r.code} className="flex items-center justify-between gap-2 px-3.5 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-slate-800 dark:text-slate-100 truncate">{r.name}</p>
                        <p className="text-[10px] font-mono text-slate-400">{r.code} · {r.password}</p>
                      </div>
                      <span className={`text-[10px] font-black shrink-0 ${r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{r.ok ? 'OK' : (r.error || 'FALLO').slice(0, 40)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button type="button" onClick={downloadBulkCsv} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/25 flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> Descargar credenciales (CSV)
                  </button>
                  <button type="button" onClick={() => setBulkState(null)} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700">Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
