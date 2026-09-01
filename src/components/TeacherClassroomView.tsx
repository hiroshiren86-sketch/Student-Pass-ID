import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  BookOpen, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Users, 
  ShieldCheck, 
  Calendar, 
  Check, 
  AlertCircle,
  QrCode,
  Camera,
  Keyboard,
  UserCheck,
  Award,
  Crown,
  Lock,
  Zap,
  Volume2,
  VolumeX,
  Sparkles,
  ArrowRight,
  UserPlus,
  Coffee,
  HelpCircle,
  Key,
  ShieldAlert,
  Flame,
  Bell
} from 'lucide-react';
import jsQR from 'jsqr';
import { Student, AttendanceRecord, SchoolSettings, Teacher, ScheduleSlot, AttendanceStatus, EphemeralScanDelegation } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString, getCurrentTimeString } from '../services/attendanceStorage';
import { SoundService } from '../utils/sound';

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
  const scheduleSlots = AttendanceStorageService.getScheduleSlots().filter(s => s.type === 'CLASS' || s.type === 'CIVIC' || s.type === 'ADVISORY');
  const allAssignments = AttendanceStorageService.getScheduleAssignments();
  
  const uniqueGrades = AttendanceStorageService.getUniqueGrades();
  const [selectedGrade, setSelectedGrade] = useState<string>(
    teacher?.directorGrade || teacher?.assignedGrades?.[0] || uniqueGrades[0] || '6°1'
  );
  const [selectedSlotId, setSelectedSlotId] = useState<string>(scheduleSlots[0]?.id || 'slot-1');
  const [selectedSubject, setSelectedSubject] = useState<string>(teacher?.subjects?.[0] || 'Matemáticas');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  
  // Scanner state
  const [scannerOpen, setScannerOpen] = useState<boolean>(false);
  const [manualCodeInput, setManualCodeInput] = useState<string>('');
  const [scanFeedback, setScanFeedback] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Video Camera
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const animFrameId = useRef<number | null>(null);

  // Vincular stream cuando el videoRef esté disponible
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().catch(err => console.warn('Error auto-playing video:', err));
    }
  }, [cameraStream, cameraActive]);

  // Modals
  const [showRepModal, setShowRepModal] = useState<boolean>(false);
  const [showSubRepModal, setShowSubRepModal] = useState<boolean>(false);
  const [showDelegationModal, setShowDelegationModal] = useState<boolean>(false);
  const [delegatedStudentCode, setDelegatedStudentCode] = useState<string>('');
  const [latestDelegation, setLatestDelegation] = useState<EphemeralScanDelegation | null>(null);

  // Reloj vivo + ventana de aviso de fin de bloque (T-{n}) — notificación única por bloque/día
  const [nowMinuteOfDay, setNowMinuteOfDay] = useState<number>(() => {
    const [h, m] = getCurrentTimeString().split(':').map(Number);
    return h * 60 + m;
  });
  const [notifiedSlotKey, setNotifiedSlotKey] = useState<string>('');
  const [noticeDismissed, setNoticeDismissed] = useState<boolean>(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  );

  const today = getTodayDateString();
  const currentTime = getCurrentTimeString();

  // Limpiar stream al desmontar
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
      }
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setStudents(AttendanceStorageService.getStudents());
      setSettings(AttendanceStorageService.getSettings());
      setRecords(AttendanceStorageService.getAllAttendance());
    });
    return unsubscribe;
  }, []);

  // Reloj vivo: refresca cada 15 s para detectar la entrada a la ventana T-{n}
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const [h, m] = getCurrentTimeString().split(':').map(Number);
      setNowMinuteOfDay(h * 60 + m);
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Auto-detect current active slot on mount
  useEffect(() => {
    const activeInfo = AttendanceStorageService.getCurrentActiveSlot();
    if (activeInfo && activeInfo.slot) {
      setSelectedSlotId(activeInfo.slot.id);
    }
  }, []);

  // Sync selected subject with assignment if exists
  useEffect(() => {
    const dayOfWeek = new Date().getDay() || 1;
    const assignment = allAssignments.find(a => a.grade === selectedGrade && a.slotId === selectedSlotId && a.dayOfWeek === dayOfWeek);
    if (assignment) {
      setSelectedSubject(assignment.subject);
    }
  }, [selectedGrade, selectedSlotId, allAssignments]);

  const activeSlot = scheduleSlots.find(s => s.id === selectedSlotId) || scheduleSlots[0];
  const gradeStudents = useMemo(() => {
    return students.filter(s => s.grade === selectedGrade && s.active);
  }, [students, selectedGrade]);

  const representativeStudent = useMemo(() => {
    return AttendanceStorageService.getRepresentativeForGrade(selectedGrade);
  }, [students, selectedGrade]);

  const substituteStudent = useMemo(() => {
    return AttendanceStorageService.getSubstituteRepresentativeForGrade(selectedGrade);
  }, [students, selectedGrade]);

  const activeDelegations = useMemo(() => {
    return AttendanceStorageService.getEphemeralDelegations()
      .filter(d => d.grade === selectedGrade && d.slotId === selectedSlotId && d.date === today)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedGrade, selectedSlotId, today]);

  const isDirectorOfCurrentGrade = useMemo(() => {
    return teacher?.isGroupDirector && teacher?.directorGrade === selectedGrade;
  }, [teacher, selectedGrade]);

  const isNonComputableSlot = useMemo(() => {
    return AttendanceStorageService.isSlotNonComputable(selectedSlotId, selectedGrade, today);
  }, [selectedSlotId, selectedGrade, today]);

  // Ventana de aviso: minutos restantes del bloque vs noticeMinutesBeforeEnd (proporcional)
  const noticeMin = activeSlot.noticeMinutesBeforeEnd || AttendanceStorageService.getProportionalNoticeMinutes(activeSlot.durationMinutes);

  const minutesToBlockEnd = useMemo(() => {
    if (!activeSlot?.endTime) return null;
    const [h, m] = activeSlot.endTime.split(':').map(Number);
    return h * 60 + m - nowMinuteOfDay;
  }, [activeSlot, nowMinuteOfDay]);

  const inNoticeWindow = useMemo(() => {
    return minutesToBlockEnd !== null && minutesToBlockEnd > 0 && minutesToBlockEnd <= noticeMin;
  }, [minutesToBlockEnd, noticeMin]);

  // Today records for selected grade and slot
  const currentSlotRecords = useMemo(() => {
    return records.filter(r => r.studentGrade === selectedGrade && r.slotId === selectedSlotId && r.date === today);
  }, [records, selectedGrade, selectedSlotId, today]);

  const recordMapByStudentCode = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    currentSlotRecords.forEach(r => map.set(r.studentCode, r));
    return map;
  }, [currentSlotRecords]);

  // Assignment & Double Block check
  const currentAssignment = useMemo(() => {
    const dayOfWeek = new Date().getDay() || 1;
    return allAssignments.find(a => a.grade === selectedGrade && a.slotId === selectedSlotId && a.dayOfWeek === dayOfWeek);
  }, [allAssignments, selectedGrade, selectedSlotId]);

  // Metrics
  const stats = useMemo(() => {
    let punctual = 0;
    let tardy = 0;
    let absent = 0;
    let unscanned = 0;

    gradeStudents.forEach(s => {
      const rec = recordMapByStudentCode.get(s.code);
      if (!rec) {
        unscanned++;
      } else if (rec.status === 'PUNTUAL') {
        punctual++;
      } else if (rec.status === 'TARDANZA') {
        tardy++;
      } else if (rec.status === 'AUSENTE') {
        absent++;
      }
    });

    const total = gradeStudents.length;
    const attended = punctual + tardy;
    const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

    return { total, punctual, tardy, absent, unscanned, attended, rate };
  }, [gradeStudents, recordMapByStudentCode]);

  // Disparo único de la notificación de fin de bloque por slot/día (banner + sonido + push del navegador)
  useEffect(() => {
    if (!inNoticeWindow || noticeDismissed || isNonComputableSlot.isNonComputable) return;
    const key = `${today}_${activeSlot.id}`;
    if (notifiedSlotKey === key) return;
    setNotifiedSlotKey(key);
    if (soundEnabled) {
      SoundService.playNoticeBell();
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(`El bloque termina en ${minutesToBlockEnd} min`, {
          body: `${selectedGrade} · ${selectedSubject || 'Sin materia programada'}: faltan ${stats.unscanned} de ${stats.total} estudiantes por escanear.`,
          tag: key
        });
      } catch (e) {
        console.warn('Browser notification notice:', e);
      }
    }
  }, [inNoticeWindow, noticeDismissed, isNonComputableSlot, notifiedSlotKey, today, activeSlot, minutesToBlockEnd, selectedGrade, selectedSubject, stats, soundEnabled]);

  // Al cambiar de bloque se re-habilita el aviso para el siguiente slot
  useEffect(() => {
    setNoticeDismissed(false);
  }, [selectedSlotId]);

  // Handle Scan Logic
  const handleRegisterScan = async (rawCode: string, method: 'CAMERA' | 'USB' | 'MANUAL') => {
    if (!rawCode.trim() || isProcessing) return;
    setIsProcessing(true);

    try {
      const result = await AttendanceStorageService.registerClassScan({
        scanInput: rawCode.trim(),
        method,
        slotId: activeSlot.id,
        grade: selectedGrade,
        subject: selectedSubject,
        teacherName: teacher?.fullName || teacherName,
        scannedBy: 'DOCENTE',
        scannedByName: teacher?.fullName || teacherName
      });

      if (result.type === 'success_punctual') {
        if (soundEnabled) SoundService.playBeepSuccess();
        setScanFeedback({ type: 'success', message: `${result.student?.firstName} ${result.student?.lastName} registrado Puntual.` });
      } else if (result.type === 'success_tardy') {
        if (soundEnabled) SoundService.playBeepTardy();
        setScanFeedback({ type: 'warning', message: `${result.student?.firstName} ${result.student?.lastName} registrado con Tardanza.` });
      } else if (result.type === 'already_scanned') {
        setScanFeedback({ type: 'warning', message: result.message });
      } else {
        if (soundEnabled) SoundService.playBeepError();
        setScanFeedback({ type: 'error', message: result.message });
      }
    } catch (err: any) {
      setScanFeedback({ type: 'error', message: 'Error procesando escaneo en aula.' });
    } finally {
      setIsProcessing(false);
      setManualCodeInput('');
      setTimeout(() => setScanFeedback(null), 4000);
    }
  };

  // Status Change Toggle
  const handleToggleStatus = (student: Student, targetStatus: AttendanceStatus) => {
    const existing = recordMapByStudentCode.get(student.code);
    const all = AttendanceStorageService.getAllAttendance();

    if (existing) {
      existing.status = targetStatus;
      existing.time = getCurrentTimeString();
      existing.notes = `Ajustado manualmente por el docente a ${targetStatus}`;
      AttendanceStorageService.saveAttendance(all);
    } else {
      all.unshift({
        id: `rec-manual-${Date.now()}-${student.code}`,
        studentCode: student.code,
        studentDocument: student.documentId,
        studentName: `${student.firstName} ${student.lastName}`,
        studentGrade: student.grade,
        studentSection: student.section,
        slotId: activeSlot.id,
        slotName: activeSlot.name,
        slotStartTime: activeSlot.startTime,
        slotEndTime: activeSlot.endTime,
        subject: selectedSubject,
        teacherName: teacher?.fullName || teacherName,
        timestamp: new Date().toISOString(),
        date: today,
        time: getCurrentTimeString(),
        type: 'CLASE',
        status: targetStatus,
        method: 'MANUAL',
        scannedBy: 'DOCENTE',
        scannedByName: teacher?.fullName || teacherName,
        verifiedHmac: true,
        synced: true,
        notes: `Marcado manual en aula por docente`
      });
      AttendanceStorageService.saveAttendance(all);
    }
  };

  // Close Block (Auto-Cierre Inteligente con Regla de Oro)
  const handleCloseBlock = (force: boolean = false) => {
    if (isNonComputableSlot.isNonComputable) {
      alert(`Este bloque está clasificado como NO COMPUTABLE (${isNonComputableSlot.reason}). No se generan ausencias automáticas.`);
      return;
    }

    const confirmClose = force || window.confirm(
      `¿Desea ejecutar el cierre de asistencia para el bloque "${activeSlot.name}" en grado ${selectedGrade}?\n\n• Presentes: ${stats.attended}\n• Sin escanear: ${stats.unscanned}`
    );
    if (!confirmClose) return;

    const res = AttendanceStorageService.closeBlockAttendance({
      grade: selectedGrade,
      slotId: activeSlot.id,
      subject: selectedSubject,
      teacherName: teacher?.fullName || teacherName,
      dateStr: today,
      forceClose: force
    });

    if (res.status === 'NO_COMPUTABLE') {
      setScanFeedback({
        type: 'warning',
        message: `Regla de Oro: ${res.reason || '0 escaneos registrados. Se clasificó como hora libre sin marcar ausencias a los estudiantes.'}`
      });
    } else if (res.status === 'PENDIENTE_REVISION') {
      const forceChoice = window.confirm(
        `Alerta de Cierre: ${res.reason}\n\n¿Desea forzar el marcado de ausencias de todas formas?`
      );
      if (forceChoice) {
        handleCloseBlock(true);
      }
    } else {
      setScanFeedback({
        type: 'success',
        message: `Bloque cerrado exitosamente. Se marcaron ${res.markedAbsentCount} inasistencias automáticas.`
      });
    }
    setTimeout(() => setScanFeedback(null), 6000);
  };

  // Toggle Non-Computable / Free hour
  const handleToggleFreeHour = () => {
    if (isNonComputableSlot.isNonComputable) {
      AttendanceStorageService.markSlotComputable({
        slotId: activeSlot.id,
        grade: selectedGrade,
        dateStr: today
      });
      setScanFeedback({ type: 'success', message: 'El bloque ha sido reactivado como computable para el llamado a lista.' });
    } else {
      AttendanceStorageService.markSlotNonComputable({
        slotId: activeSlot.id,
        grade: selectedGrade,
        dateStr: today,
        reason: 'Hora libre / Actividad institucional / Docente ausente'
      });
      setScanFeedback({ type: 'warning', message: 'Bloque marcado como HORA LIBRE. Cero ausencias para los estudiantes.' });
    }
    setTimeout(() => setScanFeedback(null), 4000);
  };

  // Create Ephemeral Delegation
  const handleCreateDelegation = () => {
    if (!delegatedStudentCode) return;
    const std = gradeStudents.find(s => s.code === delegatedStudentCode);
    if (!std) return;

    const del = AttendanceStorageService.createEphemeralDelegation({
      teacherId: teacher?.id || 'prof-temp',
      teacherName: teacher?.fullName || teacherName,
      studentCode: std.code,
      studentName: `${std.firstName} ${std.lastName}`,
      grade: selectedGrade,
      slotId: activeSlot.id
    });

    setLatestDelegation(del);
    setShowDelegationModal(false);
    setScanFeedback({
      type: 'success',
      message: `Token temporal generado para ${del.studentName}. Válido hasta las ${del.expiresAt}.`
    });
    setTimeout(() => setScanFeedback(null), 5000);
  };

  // Camera handling
  const startCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    setCameraError(null);
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch (e) {
        // Fallback genérico si facingMode falla (laptops, webcams simples)
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      setCameraStream(stream);
      setCameraFacing(facing);
      setCameraActive(true);
      
      // Iniciar el bucle de escaneo tras breve pausa para que el video monte
      setTimeout(() => {
        if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        animFrameId.current = requestAnimationFrame(tickScan);
      }, 300);
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError('No se pudo acceder a la cámara. Verifique permisos del navegador o use lector USB / entrada manual.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      setCameraStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }
  };

  const toggleCameraFacing = () => {
    const nextFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    startCamera(nextFacing);
  };

  const tickScan = () => {
    if (!videoRef.current) {
      animFrameId.current = requestAnimationFrame(tickScan);
      return;
    }

    if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current || document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.height = videoRef.current.videoHeight;
        canvas.width = videoRef.current.videoWidth;
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data && code.data.trim().length > 0) {
          handleRegisterScan(code.data, 'CAMERA');
          // Pausar brevemente para evitar escaneos duplicados en ráfaga
          setTimeout(() => {
            animFrameId.current = requestAnimationFrame(tickScan);
          }, 1500);
          return;
        }
      }
    }
    animFrameId.current = requestAnimationFrame(tickScan);
  };

  return (
    <div className="space-y-6">
      {/* Header & Course Selector Banner */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <BookOpen className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Aula de Clase & Control de Asistencia</span>
                  {currentAssignment?.isDoubleBlock && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] font-black border border-indigo-200 dark:border-indigo-800 flex items-center gap-1">
                      <Flame className="w-3 h-3 text-amber-500" /> Bloque Doble (2h)
                    </span>
                  )}
                  {!currentAssignment && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                      Horario opcional · Escaneo libre
                    </span>
                  )}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Docente: <strong>{teacher?.fullName || teacherName}</strong> {isDirectorOfCurrentGrade && <span className="text-amber-500 font-bold ml-1">★ Director de Grupo ({selectedGrade})</span>}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Grade Selector */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Curso / Grado</label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="py-2 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none"
              >
                {uniqueGrades.map(g => (
                  <option key={g} value={g}>Grado {g}</option>
                ))}
              </select>
            </div>

            {/* Block / Slot Selector */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Bloque de Horario</label>
              <select
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                className="py-2 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none"
              >
                {scheduleSlots.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.startTime} - {s.endTime})</option>
                ))}
              </select>
            </div>

            {/* Subject Selector */}
            <div>
              <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Asignatura</label>
              <input
                type="text"
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="py-2 px-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none w-36"
              />
            </div>

            {/* Free Hour / Non computable Button */}
            <div className="pt-4">
              <button
                type="button"
                onClick={handleToggleFreeHour}
                className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  isNonComputableSlot.isNonComputable
                    ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800'
                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                }`}
                title="Marcar como Hora Libre o bloque no computable"
              >
                <Coffee className="w-3.5 h-3.5" />
                <span>{isNonComputableSlot.isNonComputable ? 'Hora Libre (Activa)' : 'Hora Libre'}</span>
              </button>
            </div>

            {/* Sound toggle */}
            <div className="pt-4">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`p-2.5 rounded-xl border transition-colors ${
                  soundEnabled 
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-800' 
                    : 'bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:border-slate-700'
                }`}
                title="Sonido de escáner"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* 3-Tier Representation & Delegation Cascade Ribbon */}
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/60 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-md shadow-indigo-600/30">
                <Crown className="w-4 h-4 text-amber-300" />
              </div>
              <div>
                <p className="text-xs text-indigo-950 dark:text-indigo-200 font-bold">
                  Jerarquía de Escaneo en Aula (Cascada de 3 Niveles)
                </p>
                <p className="text-[11px] text-indigo-700 dark:text-indigo-400">
                  Nivel 1: Representante Titular • Nivel 1.B: Suplente • Nivel 2: Delegado Efímero • Nivel 3: Docente
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDelegationModal(true)}
                className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>+ Delegar a Estudiante de Fila</span>
              </button>

              {isDirectorOfCurrentGrade && (
                <button
                  type="button"
                  onClick={() => setShowRepModal(true)}
                  className="py-1.5 px-3 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold transition-all shadow-sm shrink-0"
                >
                  Asignar Titular
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            {/* Titular */}
            <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-amber-500" />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Titular</p>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {representativeStudent ? `${representativeStudent.firstName} ${representativeStudent.lastName}` : 'No asignado'}
                  </p>
                </div>
              </div>
            </div>

            {/* Suplente */}
            <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-indigo-500" />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Suplente</p>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {substituteStudent ? `${substituteStudent.firstName} ${substituteStudent.lastName}` : 'No asignado'}
                  </p>
                </div>
              </div>
              {isDirectorOfCurrentGrade && (
                <button
                  type="button"
                  onClick={() => setShowSubRepModal(true)}
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                >
                  Cambiar
                </button>
              )}
            </div>

            {/* Delegación Efímera Activa */}
            <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-500" />
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Delegado Efímero</p>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {activeDelegations.length > 0 ? activeDelegations[0].studentName : 'Sin delegación activa'}
                  </p>
                </div>
              </div>
              {activeDelegations.length > 0 && (
                <button
                  type="button"
                  onClick={() => AttendanceStorageService.revokeEphemeralDelegation(activeDelegations[0].id)}
                  className="text-[10px] text-rose-500 font-bold hover:underline"
                >
                  Revocar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Proportional Notice & Non Computable Banner */}
      {isNonComputableSlot.isNonComputable ? (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-center gap-3">
          <Coffee className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="text-xs">
            <p className="font-bold">Bloque clasificado como NO COMPUTABLE ({isNonComputableSlot.reason})</p>
            <p className="text-amber-700 dark:text-amber-300">
              No se generarán inasistencias automáticas para los estudiantes matriculados en este horario.
            </p>
          </div>
        </div>
      ) : inNoticeWindow && !noticeDismissed ? (
        <div className="p-4 rounded-2xl bg-rose-500/10 border-2 border-rose-500/50 animate-pulse flex flex-col sm:flex-row sm:items-center gap-3">
          <Bell className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0" />
          <div className="text-xs flex-1">
            <p className="font-black text-rose-800 dark:text-rose-200">
              ¡Atención! El bloque termina en {minutesToBlockEnd} min ({activeSlot.endTime}).
            </p>
            <p className="text-rose-700 dark:text-rose-300 mt-0.5">
              Faltan <strong>{stats.unscanned}</strong> de {stats.total} estudiantes por escanear en {selectedGrade} · {selectedSubject || 'Sin materia programada'}.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleCloseBlock(false)}
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-black shadow-sm"
            >
              Cerrar bloque ahora
            </button>
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-[11px] font-bold hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              Entendido
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-500" />
            <span>
              Ventana de Auto-Cierre Proporcional: <strong>T-{noticeMin} minutos</strong> antes del fin del bloque ({activeSlot.endTime}).
            </span>
          </div>
          {notifPermission === 'default' ? (
            <button
              type="button"
              onClick={() => {
                if (typeof Notification !== 'undefined') {
                  Notification.requestPermission().then((p) => setNotifPermission(p)).catch(() => {});
                }
              }}
              className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              <Bell className="w-3 h-3" /> Activar notificaciones de fin de bloque
            </button>
          ) : (
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
              Regla de Oro: Si hay 0 escaneos = 0 ausencias
            </span>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Matriculados</p>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{stats.total}</p>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Puntuales</p>
          <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1">{stats.punctual}</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Tardanzas</p>
          <p className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-1">{stats.tardy}</p>
        </div>
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Ausentes</p>
          <p className="text-2xl font-black text-rose-700 dark:text-rose-300 mt-1">{stats.absent}</p>
        </div>
        <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/60 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Sin Escanear</p>
          <p className="text-2xl font-black text-indigo-700 dark:text-indigo-300 mt-1">{stats.unscanned}</p>
        </div>
        <div className="p-4 rounded-2xl bg-slate-900 text-white dark:bg-indigo-600 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-300 dark:text-indigo-200">% Asistencia</p>
          <p className="text-2xl font-black text-white mt-1">{stats.rate}%</p>
        </div>
      </div>

      {/* Classroom Scanner Section (Interactive) */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
              <QrCode className="w-5 h-5 text-indigo-600" />
              <span>Escáner de Aula ({activeSlot.name})</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Escanee los carnés con lector USB, cámara del dispositivo o ingrese el código manualmente.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (cameraActive) stopCamera();
                else startCamera();
              }}
              className={`py-2.5 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                cameraActive 
                  ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-md shadow-rose-600/30' 
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>{cameraActive ? 'Detener Cámara' : 'Escanear con Cámara'}</span>
            </button>

            {cameraActive && (
              <button
                type="button"
                onClick={toggleCameraFacing}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all"
                title="Cambiar entre cámara trasera y frontal"
              >
                ↻ Cambiar Cámara ({cameraFacing === 'environment' ? 'Trasera' : 'Frontal'})
              </button>
            )}

            <button
              type="button"
              onClick={() => handleCloseBlock(false)}
              disabled={isNonComputableSlot.isNonComputable || stats.unscanned === 0}
              className="py-2.5 px-4 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all border border-slate-700"
            >
              <Lock className="w-4 h-4 text-amber-400" />
              <span>Cerrar Bloque (T-{noticeMin})</span>
            </button>
          </div>
        </div>

        {/* Video Camera Container */}
        {cameraActive && (
          <div className="relative rounded-3xl overflow-hidden bg-black max-w-md mx-auto aspect-video border-2 border-indigo-500 shadow-2xl animate-fadeIn">
            <video 
              ref={videoRef} 
              className="w-full h-full object-cover" 
              playsInline 
              muted 
              autoPlay
            />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* HUD Overlay de Escaneo */}
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
              <div className="flex justify-between items-center text-[10px] font-mono font-bold text-emerald-400 bg-black/50 px-3 py-1 rounded-full backdrop-blur-xs w-max mx-auto">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-1.5" />
                <span>ESCANEANDO CARNÉ EN AULA...</span>
              </div>
              
              {/* Marco visor con láser */}
              <div className="relative w-48 h-48 mx-auto border-2 border-indigo-400/80 rounded-2xl overflow-hidden shadow-inner">
                <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-bounce shadow-lg shadow-cyan-400" />
                <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-white" />
                <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-white" />
                <div className="absolute bottom-2 left-2 w-3 h-2 border-b-2 border-l-2 border-white" />
                <div className="absolute bottom-2 right-2 w-3 h-2 border-b-2 border-r-2 border-white" />
              </div>

              <div className="text-center text-[11px] font-medium text-white/90 bg-black/60 px-3 py-1.5 rounded-xl backdrop-blur-xs">
                Apunta al código QR o código de barras del carné
              </div>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {cameraError}
          </div>
        )}

        {/* Manual / USB Input Field */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRegisterScan(manualCodeInput, 'USB');
          }}
          className="flex items-center gap-2 max-w-lg"
        >
          <div className="relative flex-1">
            <Keyboard className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={manualCodeInput}
              onChange={(e) => setManualCodeInput(e.target.value)}
              placeholder="Escanear con lector USB o teclear código..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={!manualCodeInput.trim() || isProcessing}
            className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 transition-all shrink-0"
          >
            Registrar
          </button>
        </form>

        {/* Scan feedback notification */}
        {scanFeedback && (
          <div className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fadeIn ${
            scanFeedback.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
            scanFeedback.type === 'warning' ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
            'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
          }`}>
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>{scanFeedback.message}</span>
          </div>
        )}
      </div>

      {/* Student List Table */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              Planilla de Estudiantes - Grado {selectedGrade} ({gradeStudents.length})
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            Fecha: {today}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950/50 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <tr>
                <th className="py-3 px-4">Estudiante</th>
                <th className="py-3 px-4">Código / Doc</th>
                <th className="py-3 px-4">Hora</th>
                <th className="py-3 px-4">Estado en Bloque</th>
                <th className="py-3 px-4">Escaneado Por</th>
                <th className="py-3 px-4 text-right">Acción Rápida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {gradeStudents.map((std) => {
                const rec = recordMapByStudentCode.get(std.code);
                const status = rec?.status || 'SIN_REGISTRO';
                const isRep = std.isRepresentative;
                const isSubRep = std.isSubstituteRepresentative;

                return (
                  <tr key={std.code} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-black text-xs flex items-center justify-center shrink-0">
                          {std.firstName[0]}{std.lastName[0]}
                        </div>
                        <div>
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{std.firstName} {std.lastName}</span>
                            {isRep && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 text-[10px] font-black border border-amber-200 dark:border-amber-800 flex items-center gap-0.5">
                                <Crown className="w-3 h-3" /> Titular
                              </span>
                            )}
                            {isSubRep && (
                              <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] font-black border border-indigo-200 dark:border-indigo-800 flex items-center gap-0.5">
                                <Award className="w-3 h-3" /> Suplente
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">Sección {std.section}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 font-bold">
                      {std.code}
                    </td>

                    <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                      {rec?.time || '—'}
                    </td>

                    <td className="py-3.5 px-4">
                      {status === 'PUNTUAL' && (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Puntual
                        </span>
                      )}
                      {status === 'TARDANZA' && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-[11px] inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Tardanza
                        </span>
                      )}
                      {status === 'AUSENTE' && (
                        <span className="px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-[11px] inline-flex items-center gap-1">
                          <XCircle className="w-3.5 h-3.5" /> Ausente
                        </span>
                      )}
                      {status === 'JUSTIFICADO' && (
                        <span className="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-[11px] inline-flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" /> Justificado
                        </span>
                      )}
                      {status === 'SIN_REGISTRO' && (
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium text-[11px]">
                          Pendiente
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 text-[11px]">
                      {rec ? (
                        <span>
                          {rec.scannedByName || (rec.scannedBy === 'REPRESENTANTE' ? 'Representante' : rec.scannedBy === 'DELEGADO_EFIMERO' ? 'Delegado Efímero' : 'Docente')}
                        </span>
                      ) : '—'}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(std, 'PUNTUAL')}
                          className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors"
                          title="Marcar Puntual"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(std, 'TARDANZA')}
                          className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors"
                          title="Marcar Tardanza"
                        >
                          <Clock className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(std, 'AUSENTE')}
                          className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors"
                          title="Marcar Ausente"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Delegar Escaneo Efímero (Nivel 2) */}
      {showDelegationModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Key className="w-5 h-5 text-indigo-500" />
                <span>Delegar Escaneo Efímero (Nivel 2)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowDelegationModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Asigne permisos temporales a cualquier estudiante de la fila para que apoye el escaneo de carnés durante este bloque ({activeSlot.name}). El token expirará automáticamente a las <strong>{activeSlot.endTime}</strong>.
            </p>

            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase text-slate-400">Seleccione el Estudiante Delegado</label>
              <select
                value={delegatedStudentCode}
                onChange={(e) => setDelegatedStudentCode(e.target.value)}
                className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white outline-none"
              >
                <option value="">-- Seleccionar de la lista --</option>
                {gradeStudents.map(s => (
                  <option key={s.code} value={s.code}>{s.firstName} {s.lastName} ({s.code})</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDelegationModal(false)}
                className="py-2 px-3 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateDelegation}
                disabled={!delegatedStudentCode}
                className="py-2 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/30"
              >
                Generar Permiso Efímero
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cambiar Representante Titular */}
      {showRepModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500" />
                <span>Asignar Representante Titular</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRepModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Seleccione el estudiante del grado <strong>{selectedGrade}</strong> que asumirá el rol de Representante Titular.
            </p>

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {gradeStudents.map(s => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => {
                    AttendanceStorageService.setRepresentativeForGrade(selectedGrade, s.code, false);
                    setShowRepModal(false);
                  }}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-colors ${
                    s.isRepresentative
                      ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 font-bold'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>{s.firstName} {s.lastName} ({s.code})</span>
                  {s.isRepresentative && <span className="text-amber-600 dark:text-amber-400 font-black">★ Actual</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cambiar Representante Suplente */}
      {showSubRepModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-indigo-500" />
                <span>Asignar Representante Suplente</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowSubRepModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Seleccione el estudiante del grado <strong>{selectedGrade}</strong> que asumirá el rol de Representante Suplente (Nivel 1.B).
            </p>

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {gradeStudents.map(s => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => {
                    AttendanceStorageService.setRepresentativeForGrade(selectedGrade, s.code, true);
                    setShowSubRepModal(false);
                  }}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between text-xs transition-colors ${
                    s.isSubstituteRepresentative
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 font-bold'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span>{s.firstName} {s.lastName} ({s.code})</span>
                  {s.isSubstituteRepresentative && <span className="text-indigo-600 dark:text-indigo-400 font-black">★ Actual</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
