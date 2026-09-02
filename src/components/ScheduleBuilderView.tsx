import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Clock, 
  Calendar, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Sparkles, 
  Coffee, 
  BookOpen, 
  ArrowRight, 
  ArrowLeftRight, 
  Utensils, 
  Users, 
  School, 
  Save, 
  RotateCcw,
  SlidersHorizontal,
  ChevronRight,
  Info,
  Zap,
  AlertTriangle,
  Grid,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Lock,
  Copy,
  Power,
  QrCode,
  Download,
  Upload
} from 'lucide-react';
import {
  ScheduleSlot,
  ScheduleSlotType,
  ClassScheduleAssignment,
  Teacher,
  DayTemplateConfig,
  ScheduleImportResult
} from '../types/attendance';
import { AttendanceStorageService, schoolYearEndEpochMs } from '../services/attendanceStorage';
import QRCode from 'qrcode';
import { generateClassQrPayload } from '../utils/crypto';
import { ToggleSwitch } from './ToggleSwitch';
import { ConfirmDialog } from './ConfirmDialog';

const DAYS_OF_WEEK = [
  { id: 1, name: 'Lunes', short: 'LUN' },
  { id: 2, name: 'Martes', short: 'MAR' },
  { id: 3, name: 'Miércoles', short: 'MIÉ' },
  { id: 4, name: 'Jueves', short: 'JUE' },
  { id: 5, name: 'Viernes', short: 'VIE' },
  { id: 6, name: 'Sábado', short: 'SÁB' }
];

const SLOT_TYPE_CONFIG: Record<ScheduleSlotType, { label: string; icon: any; bg: string; text: string; border: string; desc: string }> = {
  CLASS: {
    label: 'Clase / Cátedra',
    icon: BookOpen,
    bg: 'bg-indigo-50 dark:bg-indigo-950/60',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200 dark:border-indigo-800',
    desc: 'Bloque pedagógico de asignatura'
  },
  TRANSITION: {
    label: 'Cambio de Salón',
    icon: ArrowLeftRight,
    bg: 'bg-slate-100 dark:bg-slate-800/80',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-300 dark:border-zinc-800',
    desc: '5-10 min para desplazamiento entre aulas'
  },
  BREAK: {
    label: 'Descanso / Recreo',
    icon: Coffee,
    bg: 'bg-emerald-50 dark:bg-emerald-950/60',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800',
    desc: 'Receso estudiantil y de convivencia'
  },
  LUNCH: {
    label: 'Almuerzo / Pausa',
    icon: Utensils,
    bg: 'bg-amber-50 dark:bg-amber-950/60',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
    desc: 'Comedor escolar / restaurante'
  },
  CIVIC: {
    label: 'Acto Cívico / Izada',
    icon: Sparkles,
    bg: 'bg-purple-50 dark:bg-purple-950/60',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-800',
    desc: 'Izada de bandera / Actividad cívica'
  },
  ADVISORY: {
    label: 'Asesoría de Grupo',
    icon: Users,
    bg: 'bg-teal-50 dark:bg-teal-950/60',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-800',
    desc: 'Dirección de grupo / Acompañamiento'
  }
};

export const ScheduleBuilderView: React.FC = () => {
  const [slots, setSlots] = useState<ScheduleSlot[]>(AttendanceStorageService.getScheduleSlots());
  const [assignments, setAssignments] = useState<ClassScheduleAssignment[]>(AttendanceStorageService.getScheduleAssignments());
  const [teachers, setTeachers] = useState<Teacher[]>(AttendanceStorageService.getTeachers());
  const grades = AttendanceStorageService.getUniqueGrades();

  // Mode: 'grid' (Timetable matrix) vs 'weekly-matrix' (Full 5-day week) vs 'slots-editor' (Design structure of hours) vs 'templates' (Plantillas + política) vs 'class-qr' (QR de Clase — Ronda 19)
  const [subView, setSubView] = useState<'grid' | 'weekly-matrix' | 'slots-editor' | 'templates' | 'class-qr'>('grid');

  // Ronda 19 — QR de Clase: modal de generación/descarga de la tarjeta A6 firmada
  const [classQrModal, setClassQrModal] = useState<{ grade: string; dayOfWeek: number; slotId: string; slotName: string; slotStartTime: string; slotEndTime: string; subject: string; teacherName: string; classroom?: string } | null>(null);
  const [classQrDataUrl, setClassQrDataUrl] = useState<string>('');

  // Ronda 19 (Regla E10): Escape cierra la tarjeta QR de Clase
  useEffect(() => {
    if (!classQrModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setClassQrModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [classQrModal]);

  // Ronda 19 — Importación masiva de horarios (roadmap #3 del informe): modal de rectoría
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [importPreview, setImportPreview] = useState<ScheduleImportResult | null>(null);
  const [importWipe, setImportWipe] = useState<boolean>(false);
  const [importFileName, setImportFileName] = useState<string>('');

  // Ronda 19 (Regla E10): Escape cierra también el modal de importación
  useEffect(() => {
    if (!showImportModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setShowImportModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showImportModal]);

  // Ronda 4 (F1): editor de plantillas propias de Rectoría
  const [editingTemplate, setEditingTemplate] = useState<DayTemplateConfig | null>(null);
  const [templatesOnlyMode, setTemplatesOnlyMode] = useState<boolean>(AttendanceStorageService.getSettings().templatesOnlyMode ?? false);

  // Ronda 8 (B2): auto-scroll al editor al abrirlo (Nueva plantilla / Duplicar / Editar)
  const templateEditorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingTemplate && templateEditorRef.current) {
      const t = setTimeout(() => templateEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return () => clearTimeout(t);
    }
    // Dependencia por ID: evita re-scroll en cada pulsación del teclado dentro del editor
  }, [editingTemplate?.id]);

  // Ronda 8 (O2): confirmación propia en lugar de window.confirm nativo
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; action: () => void } | null>(null);

  // Filters for Grid view
  const [selectedGrade, setSelectedGrade] = useState<string>(grades[0] || '10°1');
  const [selectedDay, setSelectedDay] = useState<number>(1); // 1 = Lunes

  // Assignment Modal
  const [editingSlot, setEditingSlot] = useState<ScheduleSlot | null>(null);
  const [assignedSubject, setAssignedSubject] = useState<string>('Matemáticas');
  const [assignedTeacherId, setAssignedTeacherId] = useState<string>('');
  const [assignedClassroom, setAssignedClassroom] = useState<string>('Aula 204');
  const [isDoubleBlock, setIsDoubleBlock] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Slot Configuration Form state (when in slots-editor)
  const [newSlotName, setNewSlotName] = useState('');
  const [newSlotType, setNewSlotType] = useState<ScheduleSlotType>('CLASS');
  const [newSlotStart, setNewSlotStart] = useState('07:00');
  const [newSlotEnd, setNewSlotEnd] = useState('07:45');
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = AttendanceStorageService.subscribe(() => {
      setSlots(AttendanceStorageService.getScheduleSlots());
      setAssignments(AttendanceStorageService.getScheduleAssignments());
      setTeachers(AttendanceStorageService.getTeachers());
    });
    return unsubscribe;
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Next consecutive class slot available for double blocks
  const nextClassSlot = useMemo(() => {
    if (!editingSlot) return undefined;
    return AttendanceStorageService.getNextClassSlot(editingSlot.id);
  }, [editingSlot]);

  // Open assignment editor for a specific slot in grid
  const handleOpenAssign = (slot: ScheduleSlot, dayOverride?: number) => {
    if (slot.type !== 'CLASS') return;
    const targetDay = dayOverride !== undefined ? dayOverride : selectedDay;
    if (dayOverride !== undefined) {
      setSelectedDay(dayOverride);
    }
    setEditingSlot(slot);

    // Check existing assignment
    const existing = assignments.find(a => 
      a.slotId === slot.id && 
      a.grade === selectedGrade && 
      a.dayOfWeek === targetDay
    );

    if (existing) {
      setAssignedSubject(existing.subject);
      setAssignedTeacherId(existing.teacherId || '');
      setAssignedClassroom(existing.classroom || '');
      setIsDoubleBlock(!!existing.isDoubleBlock);
    } else {
      setAssignedSubject('Matemáticas');
      setAssignedTeacherId(teachers[0]?.id || '');
      setAssignedClassroom(`Aula ${selectedGrade}`);
      setIsDoubleBlock(false);
    }
  };

  // Check teacher conflict in real time
  const teacherConflict = useMemo(() => {
    if (!assignedTeacherId || !editingSlot) return undefined;
    return AttendanceStorageService.checkTeacherConflict({
      teacherId: assignedTeacherId,
      dayOfWeek: selectedDay,
      slotId: editingSlot.id,
      excludeGrade: selectedGrade
    });
  }, [assignedTeacherId, editingSlot, selectedDay, selectedGrade, assignments]);

  const handleSaveAssignment = () => {
    if (!editingSlot) return;

    const teacherObj = teachers.find(t => t.id === assignedTeacherId);

    if (isDoubleBlock && nextClassSlot) {
      // Save as Double Block (2 hours in sequence)
      AttendanceStorageService.setDoubleBlockAssignment({
        firstSlotId: editingSlot.id,
        secondSlotId: nextClassSlot.id,
        dayOfWeek: selectedDay,
        grade: selectedGrade,
        subject: assignedSubject,
        teacherId: assignedTeacherId || undefined,
        teacherName: teacherObj ? teacherObj.fullName : undefined,
        classroom: assignedClassroom
      });
      showToast(`¡Bloque Doble (2 Horas) de ${assignedSubject} guardado para ${selectedGrade}! ⚡`);
    } else {
      // Single hour assignment
      AttendanceStorageService.setAssignment({
        dayOfWeek: selectedDay,
        slotId: editingSlot.id,
        grade: selectedGrade,
        subject: assignedSubject,
        teacherId: assignedTeacherId || undefined,
        teacherName: teacherObj ? teacherObj.fullName : undefined,
        classroom: assignedClassroom,
        isDoubleBlock: false
      });
      showToast(`¡Asignatura guardada para ${selectedGrade} a las ${editingSlot.startTime}!`);
    }

    setEditingSlot(null);
  };

  const handleRemoveAssignment = (slotId: string) => {
    AttendanceStorageService.removeAssignment(selectedGrade, slotId, selectedDay, true);
    setEditingSlot(null);
    showToast('Asignación de clase eliminada del horario.');
  };

  // Slot Builder CRUD
  const handleSaveSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlotName.trim()) return;

    // Calculate duration in minutes
    const [h1, m1] = newSlotStart.split(':').map(Number);
    const [h2, m2] = newSlotEnd.split(':').map(Number);
    const dur = Math.max(5, (h2 * 60 + m2) - (h1 * 60 + m1));

    let updatedSlots = [...slots];

    if (editingSlotId) {
      updatedSlots = updatedSlots.map(s => s.id === editingSlotId ? {
        ...s,
        name: newSlotName,
        type: newSlotType,
        startTime: newSlotStart,
        endTime: newSlotEnd,
        durationMinutes: dur
      } : s);
    } else {
      const newSlot: ScheduleSlot = {
        id: `slot-${Date.now()}`,
        order: slots.length + 1,
        name: newSlotName,
        type: newSlotType,
        startTime: newSlotStart,
        endTime: newSlotEnd,
        durationMinutes: dur,
        color: newSlotType === 'CLASS' ? '#4f46e5' : (newSlotType === 'BREAK' ? '#10b981' : '#94a3b8')
      };
      updatedSlots.push(newSlot);
    }

    // Sort by start time
    updatedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    updatedSlots = updatedSlots.map((s, idx) => ({ ...s, order: idx + 1 }));

    AttendanceStorageService.saveScheduleSlots(updatedSlots);
    setEditingSlotId(null);
    setNewSlotName('');
    showToast('Estructura de bloques de horario actualizada exitosamente.');
  };

  const handleDeleteSlot = (id: string) => {
    // Ronda 8 (O2): confirmación con modal propio (antes window.confirm nativo)
    setConfirmState({
      title: 'Eliminar bloque',
      message: '¿Eliminar este bloque del horario escolar? Esta acción no se puede deshacer.',
      action: () => {
        const updated = slots.filter(s => s.id !== id).map((s, idx) => ({ ...s, order: idx + 1 }));
        AttendanceStorageService.saveScheduleSlots(updated);
        showToast('Bloque eliminado.');
      }
    });
  };

  const handleStartEditSlot = (slot: ScheduleSlot) => {
    setEditingSlotId(slot.id);
    setNewSlotName(slot.name);
    setNewSlotType(slot.type);
    setNewSlotStart(slot.startTime);
    setNewSlotEnd(slot.endTime);
  };

  // Helper to get assignment for current grade/day/slot
  const getAssignment = (slotId: string, day: number = selectedDay, grade: string = selectedGrade) => {
    return assignments.find(a => 
      a.slotId === slotId && 
      a.grade === grade && 
      a.dayOfWeek === day
    );
  };

  // Calculate total weekly hours and double blocks count for selected grade
  const gradeStats = useMemo(() => {
    const gradeAssignments = assignments.filter(a => a.grade === selectedGrade);
    const doubleBlocksCount = gradeAssignments.filter(a => a.isDoubleBlock && a.doubleBlockRole === 'FIRST_HOUR').length;
    const totalHours = gradeAssignments.length;
    return {
      totalHours,
      doubleBlocksCount,
      subjectsCount: new Set(gradeAssignments.map(a => a.subject)).size
    };
  }, [assignments, selectedGrade]);

  return (
    <div className="space-y-6 animate-fadeIn" id="schedule-builder-view">
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
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 uppercase tracking-wider">
              Gestión Académica • Horarios Escolares Colombia
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              Soporta Bloques Dobles (2h)
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1.5">
            Constructor de Horarios & Bloques Pedagógicos
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Configura las cátedras, descansos, cambios de salón y bloques dobles de 2 horas seguidas (común en Matemáticas, Ciencias y Talleres).
          </p>
        </div>

        {/* Sub-view Switcher */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-zinc-800 self-stretch md:self-auto overflow-x-auto">
          <button
            onClick={() => setSubView('grid')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'grid'
                ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Por Día</span>
          </button>

          <button
            onClick={() => setSubView('weekly-matrix')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'weekly-matrix'
                ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Semana Completa</span>
          </button>

          <button
            onClick={() => setSubView('slots-editor')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'slots-editor'
                ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Estructura ({slots.length})</span>
          </button>

          <button
            onClick={() => setSubView('templates')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'templates'
                ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>Plantillas</span>
          </button>

          {/* Ronda 19 — QR de Clase (informe de testing, sección 5.3): la vía que vincula la
              materia sin depender del reloj ni del horario completo */}
          <button
            onClick={() => setSubView('class-qr')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'class-qr'
                ? 'bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR de Clase</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: TIMETABLE GRID MATRIX (SINGLE DAY) */}
      {subView === 'grid' && (
        <div className="space-y-4">
          {/* Controls Bar: Grade Selector & Days Selector */}
          <div className="p-4 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Grade Selector & Stats */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                  Curso / Grado:
                </label>
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {grades.map(g => (
                    <option key={g} value={g}>Grado {g}</option>
                  ))}
                </select>
              </div>

              <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold">
                  {gradeStats.totalHours}h semanales
                </span>
                {gradeStats.doubleBlocksCount > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 font-bold flex items-center gap-1">
                    <Zap className="w-3 h-3 text-amber-500" />
                    {gradeStats.doubleBlocksCount} bloques dobles
                  </span>
                )}
              </div>
            </div>

            {/* Day of Week Tabs + Importación (Ronda 19) */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {DAYS_OF_WEEK.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDay(d.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      selectedDay === d.id
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{d.name}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => { setShowImportModal(true); setImportPreview(null); }}
                className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-all flex items-center gap-1.5 shrink-0"
                title="Carga el horario del término desde un archivo CSV/Excel delimitado — sin clics uno a uno"
                aria-label="Importar horario masivo por CSV"
              >
                <Upload className="w-3.5 h-3.5" />
                Importar CSV
              </button>
            </div>
          </div>

          {/* Slots & Classes Timeline List */}
          <div className="grid grid-cols-1 gap-3">
            {slots.map((slot) => {
              const cfg = SLOT_TYPE_CONFIG[slot.type];
              const Icon = cfg.icon;
              const assign = getAssignment(slot.id);

              if (slot.type === 'TRANSITION') {
                return (
                  <div 
                    key={slot.id}
                    className="p-2.5 rounded-2xl bg-slate-100/70 dark:bg-zinc-950/40 border border-dashed border-slate-300 dark:border-zinc-800/50 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
                  >
                    <div className="flex items-center gap-2 font-mono">
                      <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-bold text-[11px]">{slot.startTime} - {slot.endTime} ({slot.durationMinutes} min)</span>
                      <span className="font-medium text-[11px]">— {slot.name} (Desplazamiento de alumnos)</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">Transición</span>
                  </div>
                );
              }

              if (slot.type === 'BREAK' || slot.type === 'LUNCH') {
                return (
                  <div 
                    key={slot.id}
                    className={`p-4 rounded-3xl border flex items-center justify-between ${cfg.bg} ${cfg.border} shadow-xs`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-2xl bg-white dark:bg-zinc-950 ${cfg.text} shadow-xs`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className={`text-sm font-black ${cfg.text}`}>
                            {slot.name}
                          </h4>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white dark:bg-zinc-950 text-slate-600 dark:text-slate-300">
                            {slot.startTime} - {slot.endTime} ({slot.durationMinutes} min)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {cfg.desc}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider hidden sm:inline">
                      Pausa Institucional
                    </span>
                  </div>
                );
              }

              // CLASS SLOT
              return (
                <div
                  key={slot.id}
                  onClick={() => handleOpenAssign(slot)}
                  className={`p-4 rounded-3xl border transition-all cursor-pointer group shadow-xs ${
                    assign 
                      ? assign.isDoubleBlock 
                        ? 'bg-gradient-to-r from-indigo-50/70 via-white to-amber-50/40 dark:from-indigo-950/40 dark:via-slate-900 dark:to-amber-950/20 border-amber-300/80 dark:border-amber-700/60 hover:shadow-md'
                        : 'bg-white/80 dark:bg-zinc-950/80 border-slate-200/80 dark:border-zinc-800/50 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-md' 
                      : 'bg-slate-50/50 dark:bg-black/40 border-dashed border-slate-300 dark:border-zinc-800/50 hover:bg-indigo-50/30'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      {/* Order / Time Badge */}
                      <div className={`w-12 h-12 rounded-2xl border flex flex-col items-center justify-center shrink-0 ${
                        assign?.isDoubleBlock 
                          ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                          : 'bg-indigo-50 dark:bg-indigo-950/70 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                      }`}>
                        <span className="text-[10px] font-bold uppercase">{slot.name.split(' ')[0]}</span>
                        <span className="text-xs font-mono font-black">{slot.startTime}</span>
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-slate-400 font-bold">
                            {slot.startTime} - {slot.endTime} ({slot.durationMinutes} min)
                          </span>
                          {assign?.isDoubleBlock && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-black border border-amber-300 dark:border-amber-700 flex items-center gap-1">
                              <Zap className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                              Bloque Doble 2h ({assign.doubleBlockRole === 'FIRST_HOUR' ? '1ª Hora' : '2ª Hora'})
                            </span>
                          )}
                          {assign?.classroom && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                              📍 {assign.classroom}
                            </span>
                          )}
                        </div>

                        {assign ? (
                          <div className="mt-0.5">
                            <h4 className="text-base font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {assign.subject}
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <Users className="w-3.5 h-3.5 text-indigo-500" />
                              <span className="font-semibold">{assign.teacherName || 'Docente no asignado'}</span>
                            </p>
                          </div>
                        ) : (
                          <div className="mt-0.5">
                            <h4 className="text-sm font-bold text-slate-400 italic flex items-center gap-1.5">
                              <span>Sin asignatura asignada</span>
                              <span className="text-[10px] text-indigo-500 font-bold underline">Hacer clic para asignar</span>
                            </h4>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        type="button"
                        className="px-3.5 py-1.5 rounded-xl bg-slate-100 group-hover:bg-indigo-600 group-hover:text-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-all flex items-center gap-1"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{assign ? 'Modificar' : 'Asignar Materia'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: FULL 5-DAY WEEKLY MATRIX */}
      {subView === 'weekly-matrix' && (
        <div className="p-6 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-zinc-800/50">
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Horario Semanal Completo — Grado {selectedGrade}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Visualización de Lunes a Viernes con detección de cátedras y bloques de 2 horas seguidas.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Grado:</label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400"
              >
                {grades.map(g => (
                  <option key={g} value={g}>Grado {g}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-zinc-800/50 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 px-3 font-bold">Bloque / Hora</th>
                  {DAYS_OF_WEEK.slice(0, 5).map(d => (
                    <th key={d.id} className="py-2.5 px-3 font-black text-slate-900 dark:text-white">
                      {d.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                {slots.map((slot) => {
                  const cfg = SLOT_TYPE_CONFIG[slot.type];

                  if (slot.type === 'TRANSITION') {
                    return (
                      <tr key={slot.id} className="bg-slate-50/60 dark:bg-black/40 text-[10px] text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-900/50 transition-colors group border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:shadow-sm">
                        <td className="py-1.5 px-3 font-mono font-bold">{slot.startTime}</td>
                        <td colSpan={5} className="py-1.5 px-3 italic">
                          🚶 {slot.name} ({slot.durationMinutes} min)
                        </td>
                      </tr>
                    );
                  }

                  if (slot.type === 'BREAK' || slot.type === 'LUNCH') {
                    return (
                      <tr key={slot.id} className={`${cfg.bg} text-[11px] font-bold ${cfg.text}`}>
                        <td className="py-2 px-3 font-mono">{slot.startTime}</td>
                        <td colSpan={5} className="py-2 px-3">
                          ☕ {slot.name} ({slot.startTime} - {slot.endTime})
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={slot.id} className="hover:bg-slate-100 dark:hover:bg-zinc-900/50 transition-colors group border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:shadow-sm">
                      <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-slate-500">
                        <div>{slot.name.split(' ')[0]}</div>
                        <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                      </td>

                      {DAYS_OF_WEEK.slice(0, 5).map((d) => {
                        const asgn = getAssignment(slot.id, d.id, selectedGrade);

                        return (
                          <td 
                            key={d.id} 
                            onClick={() => {
                              handleOpenAssign(slot, d.id);
                            }}
                            className="py-2 px-3 cursor-pointer"
                          >
                            {asgn ? (
                              <div className={`p-2 rounded-xl border text-[11px] space-y-0.5 transition-all ${
                                asgn.isDoubleBlock 
                                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-200' 
                                  : 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900 text-slate-900 dark:text-white'
                              }`}>
                                <div className="font-black flex items-center justify-between">
                                  <span>{asgn.subject}</span>
                                  {asgn.isDoubleBlock && (
                                    <span title="Bloque Doble 2h" className="shrink-0 inline-flex"><Zap className="w-2.5 h-2.5 text-amber-600" /></span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                  {asgn.teacherName?.split(' ')[0]} {asgn.teacherName?.split(' ')[1] || ''}
                                </div>
                              </div>
                            ) : (
                              <div className="p-2 rounded-xl border border-dashed border-slate-200 dark:border-zinc-800/50 text-[10px] text-slate-400 text-center hover:border-indigo-400">
                                + Asignar
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: SLOTS & TRANSITIONS STRUCTURE BUILDER */}
      {subView === 'slots-editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left / Top: Form to add or edit slot */}
          <div className="p-6 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm space-y-4 lg:col-span-1">
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {editingSlotId ? 'Editar Bloque de Horario' : 'Crear Nuevo Bloque'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Añade clases, cambios de aula (5 min) o descansos.
              </p>
            </div>

            <form onSubmit={handleSaveSlot} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Nombre del Bloque
                </label>
                <input
                  type="text"
                  placeholder="Ej: 1ª Hora, Cambio de Salón, Recreo..."
                  value={newSlotName}
                  onChange={(e) => setNewSlotName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500 font-semibold"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Tipo de Bloque
                </label>
                <select
                  value={newSlotType}
                  onChange={(e) => setNewSlotType(e.target.value as ScheduleSlotType)}
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500 font-semibold"
                >
                  <option value="CLASS">📚 Clase / Cátedra Pedagógica</option>
                  <option value="TRANSITION">🚶 Cambio de Salón / Aula (5-10 min)</option>
                  <option value="BREAK">☕ Descanso / Recreo</option>
                  <option value="LUNCH">🍲 Almuerzo / Pausa Activa</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Hora Inicio
                  </label>
                  <input
                    type="time"
                    value={newSlotStart}
                    onChange={(e) => setNewSlotStart(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                    Hora Fin
                  </label>
                  <input
                    type="time"
                    value={newSlotEnd}
                    onChange={(e) => setNewSlotEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none"
                    required
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                {editingSlotId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSlotId(null);
                      setNewSlotName('');
                    }}
                    className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingSlotId ? 'Guardar Cambios' : 'Agregar Bloque'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Right: Current Schedule Structure Timeline */}
          <div className="p-6 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-sm space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800/50">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Estructura de la Jornada Escolar ({slots.length} Bloques)
              </h3>
              <span className="text-xs font-mono text-slate-400 font-bold">
                {slots[0]?.startTime || '07:00'} - {slots[slots.length - 1]?.endTime || '13:30'}
              </span>
            </div>

            <div className="space-y-2">
              {slots.map((slot) => {
                const cfg = SLOT_TYPE_CONFIG[slot.type];
                const Icon = cfg.icon;

                return (
                  <div
                    key={slot.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-3 ${cfg.bg} ${cfg.border}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl bg-white dark:bg-zinc-950 ${cfg.text}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900 dark:text-white">
                            {slot.order}. {slot.name}
                          </span>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white dark:bg-zinc-950 text-slate-600 dark:text-slate-300">
                            {slot.startTime} - {slot.endTime} ({slot.durationMinutes} min)
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {cfg.label}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEditSlot(slot)}
                        className="p-1.5 rounded-lg bg-white dark:bg-zinc-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors"
                        title="Editar bloque"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="p-1.5 rounded-lg bg-white dark:bg-zinc-950 text-rose-500 hover:text-rose-700 transition-colors"
                        title="Eliminar bloque"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ASSIGNMENT MODAL (WITH DOUBLE BLOCK SUPPORT & TEACHER CONFLICT ALERTS) */}
      {editingSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="p-6 rounded-3xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/50 shadow-2xl max-w-md w-full space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800/50 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {DAYS_OF_WEEK.find(d => d.id === selectedDay)?.name} • Grado {selectedGrade}
                </span>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Asignar Cátedra: {editingSlot.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {editingSlot.startTime} - {editingSlot.endTime} ({editingSlot.durationMinutes} minutos)
                </p>
              </div>
              <button
                onClick={() => setEditingSlot(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Teacher Conflict Alert */}
            {teacherConflict && (
              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">¡Cruce de horario detectado!</span>
                  <span>
                    El docente ya está asignado a <strong>{teacherConflict.conflictingGrade}</strong> ({teacherConflict.conflictingSubject}) a esta misma hora ({editingSlot.startTime}).
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3.5">
              {/* Asignatura */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Materia / Asignatura
                </label>
                <select
                  value={assignedSubject}
                  onChange={(e) => setAssignedSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="Matemáticas">Matemáticas</option>
                  <option value="Física">Física</option>
                  <option value="Química">Química</option>
                  <option value="Ciencias Naturales">Ciencias Naturales</option>
                  <option value="Ciencias Sociales">Ciencias Sociales</option>
                  <option value="Lengua Castellana">Lengua Castellana</option>
                  <option value="Inglés">Inglés</option>
                  <option value="Tecnología e Informática">Tecnología e Informática</option>
                  <option value="Educación Física">Educación Física</option>
                  <option value="Geometría">Geometría</option>
                  <option value="Filosofía">Filosofía</option>
                  <option value="Ética y Valores">Ética y Valores</option>
                  <option value="Dirección de Grupo">Dirección de Grupo</option>
                </select>
              </div>

              {/* Docente a Cargo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Profesor / Docente Responsable
                </label>
                <select
                  value={assignedTeacherId}
                  onChange={(e) => setAssignedTeacherId(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">-- Seleccionar Docente --</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName} ({t.subjects.join(', ')})
                    </option>
                  ))}
                </select>
              </div>

              {/* Salón / Aula */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Ubicación / Salón de Clase
                </label>
                <input
                  type="text"
                  placeholder="Ej: Aula 204, Laboratorio de Ciencias..."
                  value={assignedClassroom}
                  onChange={(e) => setAssignedClassroom(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>

              {/* COLOMBIAN DOUBLE BLOCK TOGGLE */}
              {nextClassSlot && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDoubleBlock}
                      onChange={(e) => setIsDoubleBlock(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
                    />
                    <div>
                      <span className="text-xs font-black text-amber-950 dark:text-amber-200 flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-amber-600" />
                        Programar como Bloque Doble (2 Horas Seguidas)
                      </span>
                      <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5 leading-snug">
                        Asignará consecutivamente esta cátedra en <strong>{editingSlot.name}</strong> y en <strong>{nextClassSlot.name}</strong> ({editingSlot.startTime} a {nextClassSlot.endTime}).
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-zinc-800/50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleRemoveAssignment(editingSlot.id)}
                className="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 text-xs font-bold transition-all"
              >
                Quitar Materia
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingSlot(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveAssignment}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
                >
                  {isDoubleBlock && <Zap className="w-3.5 h-3.5 text-amber-300" />}
                  <span>{isDoubleBlock ? 'Guardar Bloque Doble' : 'Guardar Cátedra'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* VIEW 4: PLANTILLAS DE JORNADA + POLÍTICA (Ronda 4 F1/F2) */}
      {subView === 'templates' && (
        <div className="space-y-4">
          {/* Política de Horarios (F2): interruptor maestro de Rectoría */}
          <div className="p-4 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300">
                <Power className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">Solo plantillas oficiales</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
                  Al activarlo se deshabilita para <b>todas las cuentas</b> (docentes y estudiantes) la visualización y carga de
                  horarios personales opcionales. Las plantillas y bloques oficiales siguen mandando el escaneo igual.
                  Los horarios personales ya cargados no se borran: si lo apagas, reaparecen.
                </p>
              </div>
            </div>
            <ToggleSwitch
              checked={templatesOnlyMode}
              onChange={(v) => {
                setTemplatesOnlyMode(v);
                const s = AttendanceStorageService.getSettings();
                s.templatesOnlyMode = v;
                AttendanceStorageService.saveSettings(s);
                showToast(v ? 'Modo SOLO PLANTILLAS activado: horarios personales ocultos para todas las cuentas.' : 'Horarios personales opcionales habilitados.');
              }}
              label={templatesOnlyMode ? 'Activado' : 'Desactivado'}
              activeColor="indigo"
            />
          </div>

          {/* Lista de plantillas + editor */}
          <div className="p-4 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-sm font-black text-slate-900 dark:text-white">Plantillas de Jornada</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                  Oficiales: no se eliminan · Duplica para crear la tuya
                </span>
              </div>
              <button
                onClick={() => setEditingTemplate({
                  id: `tmpl-custom-${Date.now()}`,
                  type: 'CUSTOM',
                  name: 'Nueva Plantilla Personalizada',
                  badge: 'Personalizada',
                  description: 'Plantilla creada por Rectoría.',
                  shift: 'MANANA',
                  baseStartTime: '06:30',
                  blockDurationMinutes: 55,
                  trimMinutesPerBlock: 0,
                  recessDurationMinutes: 30,
                  totalBlocks: 6
                })}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Nueva plantilla
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {AttendanceStorageService.getDayTemplates().map(tpl => {
                const isActive = AttendanceStorageService.getActiveDayTemplate().id === tpl.id;
                const isCustom = tpl.type === 'CUSTOM';
                return (
                  <div key={tpl.id} className={`p-3 rounded-2xl border ${isActive ? 'border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-300 dark:ring-indigo-800' : 'border-slate-200 dark:border-zinc-800/50'} bg-white dark:bg-black space-y-2`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                          <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">{tpl.name}</h4>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{tpl.badge}</span>
                      </div>
                      {isCustom ? (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-fuchsia-100 dark:bg-fuchsia-950 text-fuchsia-700 dark:text-fuchsia-300">CUSTOM</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"><Lock className="w-2.5 h-2.5" /> OFICIAL</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug line-clamp-2">{tpl.description}</p>
                    <div className="flex flex-wrap gap-1 text-[9px] font-bold text-slate-600 dark:text-slate-300">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Inicio jornada: {tpl.dayStartTime || tpl.baseStartTime}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{tpl.totalBlocks} bloques × {tpl.blockDurationMinutes}m</span>
                      {(tpl.dayEndTime || tpl.dayStartTime) && <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">Fin: {tpl.dayEndTime || 'auto'}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <button
                        onClick={() => { AttendanceStorageService.applyDayTemplate(tpl.id); showToast(`Plantilla "${tpl.name}" aplicada: bloques regenerados.`); }}
                        className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold"
                      >Aplicar hoy</button>
                      {isCustom ? (
                        <button onClick={() => setEditingTemplate({ ...tpl })} className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center gap-1"><Edit3 className="w-2.5 h-2.5" /> Editar</button>
                      ) : (
                        <button onClick={() => setEditingTemplate({ ...tpl, id: `tmpl-custom-${Date.now()}`, type: 'CUSTOM', name: `${tpl.name} (copia)` })} className="px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold flex items-center gap-1"><Copy className="w-2.5 h-2.5" /> Duplicar</button>
                      )}
                      {isCustom && (
                        <button
                          onClick={() => {
                            // Ronda 8 (O2 + B4): confirmación con modal propio. El reset de
                            // plantilla activa y regeneración de slots lo garantiza ahora el
                            // servicio (deleteCustomTemplate), aquí solo se decide el aviso.
                            const wasActive = AttendanceStorageService.getSettings().activeDayTemplate === tpl.id;
                            setConfirmState({
                              title: 'Eliminar plantilla',
                              message: `¿Eliminar la plantilla "${tpl.name}"?${wasActive ? ' Está aplicada hoy: se aplicará la Plantilla A (Normal) y los bloques se regenerarán.' : ''}`,
                              action: () => {
                                AttendanceStorageService.deleteCustomTemplate(tpl.id);
                                if (wasActive) {
                                  showToast('Plantilla eliminada. Se aplicó la Plantilla A (Normal) y se regeneraron los bloques.');
                                } else { showToast('Plantilla eliminada.'); }
                              }
                            });
                          }}
                          className="px-2 py-1 rounded-lg bg-red-100 dark:bg-red-950 hover:bg-red-200 dark:hover:bg-red-900 text-red-600 dark:text-red-400 text-[10px] font-bold flex items-center gap-1"
                        ><Trash2 className="w-2.5 h-2.5" /> Eliminar</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* EDITOR PARAMÉTRICO + PREVISUALIZACIÓN */}
            {editingTemplate && (
              <div ref={templateEditorRef} className="mt-4 p-4 rounded-2xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/30 space-y-3 scroll-mt-24">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-indigo-900 dark:text-indigo-200">Editor de plantilla</h4>
                  <button onClick={() => setEditingTemplate(null)} className="p-1 hover:opacity-70"><X className="w-3.5 h-3.5 text-slate-500" /></button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Nombre</label>
                    <input type="text" value={editingTemplate.name} onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Etiqueta (badge)</label>
                    <input type="text" value={editingTemplate.badge} onChange={e => setEditingTemplate({ ...editingTemplate, badge: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Descripción</label>
                    <input type="text" value={editingTemplate.description} onChange={e => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:col-span-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Inicio jornada</label>
                      <input type="time" value={editingTemplate.dayStartTime || ''} onChange={e => setEditingTemplate({ ...editingTemplate, dayStartTime: e.target.value || undefined })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                      <span className="text-[9px] text-slate-400 block">Vacío = usa el inicio de bloques</span>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Fin jornada</label>
                      <input type="time" value={editingTemplate.dayEndTime || ''} onChange={e => setEditingTemplate({ ...editingTemplate, dayEndTime: e.target.value || undefined })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                      <span className="text-[9px] text-slate-400 block">Tras esta hora: jornada cerrada</span>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Inicio 1er bloque</label>
                      <input type="time" value={editingTemplate.baseStartTime} onChange={e => setEditingTemplate({ ...editingTemplate, baseStartTime: e.target.value })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Recreo (min)</label>
                      <input type="number" min={0} max={120} value={editingTemplate.recessDurationMinutes} onChange={e => setEditingTemplate({ ...editingTemplate, recessDurationMinutes: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Duración bloque (min)</label>
                      <input type="number" min={5} max={120} value={editingTemplate.blockDurationMinutes} onChange={e => setEditingTemplate({ ...editingTemplate, blockDurationMinutes: Math.max(5, Number(e.target.value) || 55) })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">Total bloques</label>
                      <input type="number" min={1} max={12} value={editingTemplate.totalBlocks} onChange={e => setEditingTemplate({ ...editingTemplate, totalBlocks: Math.max(1, Number(e.target.value) || 6) })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase">1er bloque especial</label>
                      <select value={editingTemplate.firstBlockSpecial || 'NORMAL'} onChange={e => setEditingTemplate({ ...editingTemplate, firstBlockSpecial: (e.target.value as DayTemplateConfig['firstBlockSpecial']) || undefined })}
                        className="w-full mt-1 px-2 py-1.5 rounded-xl bg-white dark:bg-black border border-slate-300 dark:border-zinc-800 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="NORMAL">Ninguno</option>
                        <option value="ACTO_CIVICO">Acto Cívico (no computable)</option>
                        <option value="ASESORIA_GRUPO">Asesoría de Grupo</option>
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={!!editingTemplate.isNonComputableAllDay} onChange={e => setEditingTemplate({ ...editingTemplate, isNonComputableAllDay: e.target.checked || undefined })}
                          className="w-3.5 h-3.5 rounded accent-indigo-600" />
                        Día completo sin ausencias (especial)
                      </label>
                    </div>
                  </div>
                </div>

                {/* Previsualización de bloques generados */}
                <div>
                  <h5 className="text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase mb-1">Previsualización de bloques</h5>
                  <div className="flex flex-wrap gap-1.5">
                    {AttendanceStorageService.generateSlotsFromTemplate(editingTemplate).map(s => (
                      <span key={s.id} className={`px-2 py-1 rounded-lg text-[10px] font-bold ${s.type === 'BREAK' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300' : s.isNonComputable ? 'bg-slate-200 dark:bg-slate-800 text-slate-500' : 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'}`}>
                        {s.name} · {s.startTime}–{s.endTime}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => setEditingTemplate(null)} className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold">Cancelar</button>
                  <button
                    onClick={() => {
                      const t = editingTemplate;
                      if (!t.name.trim()) { showToast('La plantilla necesita un nombre.'); return; }
                      const [bh, bm] = (t.baseStartTime || '06:30').split(':').map(Number);
                      const startTotal = (t.dayStartTime ? (() => { const [h, m] = t.dayStartTime.split(':').map(Number); return h * 60 + m; })() : bh * 60 + bm);
                      const endTotal = t.dayEndTime ? (() => { const [h, m] = t.dayEndTime.split(':').map(Number); return h * 60 + m; })() : 24 * 60;
                      if (endTotal <= startTotal) { showToast('La hora de fin de jornada debe ser posterior a la de inicio.'); return; }
                      AttendanceStorageService.upsertCustomTemplate(t);
                      setEditingTemplate(null);
                      showToast('Plantilla guardada. Usa "Aplicar hoy" para activarla.');
                    }}
                    className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center gap-1.5"
                  ><Save className="w-3.5 h-3.5" /> Guardar plantilla</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 5: QR DE CLASE (Ronda 19 — informe de testing, sección 5.3) */}
      {subView === 'class-qr' && (
        <div className="space-y-4">
          {/* Controls Bar: Curso + Día */}
          <div className="p-4 rounded-3xl bg-white/70 dark:bg-zinc-950/70 border border-slate-200/80 dark:border-zinc-800/50 backdrop-blur-xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">Curso / Grado:</label>
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                className="px-3 py-1.5 bg-white dark:bg-black border border-slate-200 dark:border-zinc-800/50 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400"
              >
                {grades.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DAYS_OF_WEEK.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDay(d.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                    selectedDay === d.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-black text-slate-600 dark:text-slate-300 border-slate-200 dark:border-zinc-800 hover:border-indigo-300'
                  }`}
                >
                  {d.short}
                </button>
              ))}
            </div>
          </div>

          {/* Cómo funciona (transparencia de la estrategia del informe) */}
          <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs text-slate-600 dark:text-slate-300 space-y-1.5 leading-relaxed">
            <p className="font-black text-indigo-700 dark:text-indigo-300 uppercase tracking-wide text-[11px]">Cómo funciona el QR de Clase</p>
            <p>1. Imprime (o proyecta) la tarjeta QR de cada cátedra y pégala en la pizarra del aula. La tarjeta sirve <b>todo el año escolar</b>: la materia no viaja en el QR — el sistema la resuelve de la asignación vigente al momento de activar, así que si la cátedra cambia no hay que reimprimir.</p>
            <p>2. Antes de pasar lista, el representante o el docente <b>escanea el QR de clase</b> con el escáner de asistencia: el dispositivo queda con la clase activa (chip visible, vence al fin del bloque).</p>
            <p>3. Todos los carnés escaneados después quedan vinculados a la <b>materia exacta</b> (contexto <b>QR de Clase (firmado)</b> en la planilla y el CSV). Sin escanear el QR, el sistema sigue funcionando por hora como siempre.</p>
          </div>

          {/* Tarjetas por bloque */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {slots.filter(s => s.type === 'CLASS').sort((a, b) => a.order - b.order).map(slot => {
              const asg = assignments.find(a => a.grade === selectedGrade && a.dayOfWeek === selectedDay && a.slotId === slot.id);
              return (
                <div key={slot.id} className={`p-4 rounded-2xl border space-y-2 ${asg ? 'bg-white dark:bg-zinc-950 border-slate-200 dark:border-zinc-800/60 shadow-sm' : 'bg-slate-50 dark:bg-zinc-950/50 border-slate-100 dark:border-zinc-900 opacity-70'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-900 dark:text-white">{slot.name}</span>
                    <span className="text-[10px] font-mono font-bold text-slate-400">{slot.startTime}–{slot.endTime}</span>
                  </div>
                  {asg ? (
                    <>
                      <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{asg.subject}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{asg.teacherName}{asg.classroom ? ` · ${asg.classroom}` : ''}</div>
                      <button
                        type="button"
                        onClick={async () => {
                          const settings = AttendanceStorageService.getSettings();
                          const payload = await generateClassQrPayload(selectedGrade, slot.id, selectedDay, schoolYearEndEpochMs(), settings.qrSecret);
                          const url = await QRCode.toDataURL(payload, { width: 512, margin: 2 });
                          setClassQrDataUrl(url);
                          setClassQrModal({
                            grade: selectedGrade, dayOfWeek: selectedDay, slotId: slot.id,
                            slotName: slot.name, slotStartTime: slot.startTime, slotEndTime: slot.endTime,
                            subject: asg.subject, teacherName: asg.teacherName, classroom: asg.classroom
                          });
                        }}
                        className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/25"
                        aria-label={`Generar tarjeta QR de ${asg.subject} en ${slot.name}`}
                      >
                        <QrCode className="w-3.5 h-3.5" /> Ver tarjeta QR
                      </button>
                    </>
                  ) : (
                    <div className="text-[11px] text-slate-400 font-bold">Sin cátedra asignada este día — el escaneo de este bloque queda como "Cátedra General"</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ronda 19 — Modal: tarjeta A6 del QR de Clase (descargable PNG para imprimir) */}
      {classQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Tarjeta QR de Clase">
          <div className="bg-white dark:bg-zinc-950 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-zinc-800/50 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <QrCode className="w-5 h-5 text-indigo-500" />
                <span>Tarjeta QR de Clase</span>
              </h3>
              <button
                type="button"
                onClick={() => setClassQrModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar tarjeta QR"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {classQrDataUrl && (
              <img src={classQrDataUrl} alt={`QR de Clase: ${classQrModal.subject}, ${classQrModal.grade}, ${classQrModal.slotName}`} className="w-full rounded-2xl border border-slate-200 dark:border-zinc-800" />
            )}

            <div className="text-center space-y-1">
              <p className="text-sm font-black text-slate-900 dark:text-white">{classQrModal.subject}</p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {classQrModal.grade} · {DAYS_OF_WEEK.find(d => d.id === classQrModal.dayOfWeek)?.name} · {classQrModal.slotName} ({classQrModal.slotStartTime}–{classQrModal.slotEndTime})
              </p>
              {classQrModal.classroom && <p className="text-[11px] text-slate-500">{classQrModal.classroom}</p>}
              <p className="text-[10px] text-slate-400 font-mono break-all">CLASE:v1 · Firmado HMAC-SHA256 · Vence el 19-dic</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setClassQrModal(null)}
                className="py-2 px-3 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400"
              >
                Cerrar
              </button>
              <a
                href={classQrDataUrl}
                download={`qr_clase_${classQrModal.grade}_${classQrModal.slotId}_${classQrModal.dayOfWeek}.png`}
                className="py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Descargar PNG
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Ronda 19 — Modal: Importación masiva de horarios (CSV delimitado, validación línea a línea) */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Importar horario masivo">
          <div className="bg-white dark:bg-zinc-950 rounded-3xl p-6 w-full max-w-2xl border border-slate-200 dark:border-zinc-800/50 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-500" />
                <span>Importar Horario del Término (CSV)</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar importación"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Una fila = una cátedra. Columnas: <b>día, grado, bloque, materia, docente (opcional), aula (opcional)</b>. El delimitador (coma, punto y coma o tabulación) se detecta solo y
              los encabezados son opcionales. Ejemplos de formatos aceptados: <span className="font-mono">lunes, 10-1, 1ª Hora de Clase, Matemáticas, Juan Pérez, 204</span> o <span className="font-mono">1;10°1;1;Matemáticas</span>.
            </p>

            {/* Carga de archivo o pegado manual */}
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-emerald-300 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all">
                <Upload className="w-4 h-4" />
                {importFileName ? importFileName : 'Seleccionar archivo .csv / .txt'}
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImportFileName(file.name);
                    const reader = new FileReader();
                    reader.onload = () => { setImportText(String(reader.result || '')); setImportPreview(null); };
                    reader.readAsText(file, 'utf-8');
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <textarea
              value={importText}
              onChange={(e) => { setImportText(e.target.value); setImportPreview(null); }}
              placeholder={"…o pega aquí el contenido:\ndía,grado,bloque,materia,docente,aula\nLunes,10°1,1,Matemáticas,Juan Pablo Pérez,Aula 204"}
              rows={6}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-black border border-slate-200 dark:border-zinc-800 rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-emerald-500/40"
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                type="button"
                disabled={!importText.trim()}
                onClick={() => setImportPreview(AttendanceStorageService.parseScheduleImport(importText))}
                className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold disabled:opacity-40"
              >
                Validar
              </button>
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importWipe}
                  onChange={(e) => setImportWipe(e.target.checked)}
                  className="w-4 h-4 accent-rose-600"
                />
                Reemplazar las asignaciones actuales de los cursos incluidos
              </label>
            </div>

            {/* Resultado de la validación */}
            {importPreview && (
              <div className="space-y-3">
                {importPreview.errors.length > 0 && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 space-y-1 max-h-36 overflow-y-auto">
                    <p className="text-[11px] font-black text-rose-700 dark:text-rose-300 uppercase">{importPreview.errors.length} línea(s) con errores</p>
                    {importPreview.errors.map((err, i) => (
                      <p key={i} className="text-[11px] text-rose-700 dark:text-rose-300">{err}</p>
                    ))}
                  </div>
                )}

                {importPreview.rows.length > 0 && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-[11px] font-black text-emerald-700 dark:text-emerald-300 uppercase mb-2">
                      {importPreview.rows.length} cátedra(s) válida(s) detectada(s) · delimitador "{importPreview.delimiter === '\t' ? 'tabulación' : importPreview.delimiter}"{importPreview.detectedHeader ? ' · encabezado detectado' : ''}
                    </p>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-emerald-200/60 dark:border-emerald-800/60">
                      <table className="w-full text-left text-[10px]">
                        <thead className="bg-emerald-100/60 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 font-black uppercase">
                          <tr>
                            <th className="py-1.5 px-2">Lín</th>
                            <th className="py-1.5 px-2">Día</th>
                            <th className="py-1.5 px-2">Curso</th>
                            <th className="py-1.5 px-2">Bloque</th>
                            <th className="py-1.5 px-2">Materia</th>
                            <th className="py-1.5 px-2">Docente</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/60">
                          {importPreview.rows.slice(0, 50).map((r) => (
                            <tr key={`${r.lineNo}-${r.grade}-${r.slotId}`}>
                              <td className="py-1 px-2 font-mono text-slate-400">{r.lineNo}</td>
                              <td className="py-1 px-2 font-bold">{DAYS_OF_WEEK.find(d => d.id === r.dayOfWeek)?.short}</td>
                              <td className="py-1 px-2 font-bold">{r.grade}</td>
                              <td className="py-1 px-2">{AttendanceStorageService.getScheduleSlots().find(s => s.id === r.slotId)?.name || r.slotId}</td>
                              <td className="py-1 px-2 font-bold text-indigo-700 dark:text-indigo-300">{r.subject}</td>
                              <td className="py-1 px-2">{r.teacherName}{r.teacherId ? ' ✓' : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="py-2 px-3 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={importPreview.rows.length === 0}
                    onClick={() => {
                      const res = AttendanceStorageService.applyScheduleImport(importPreview.rows, { wipeIncludedGrades: importWipe });
                      setAssignments(AttendanceStorageService.getScheduleAssignments());
                      setShowImportModal(false);
                      showToast(`Horario importado: ${res.applied} cátedra(s) aplicada(s)${res.removed > 0 ? `, ${res.removed} anterior(es) reemplazada(s)` : ''}.${importPreview.errors.length > 0 ? ` ${importPreview.errors.length} línea(s) con errores quedaron fuera.` : ''}`);
                    }}
                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/30"
                  >
                    Aplicar {importPreview.rows.length > 0 ? `(${importPreview.rows.length})` : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ronda 8 (O2): modal de confirmación propio (reemplaza window.confirm nativo) */}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        onConfirm={() => { const a = confirmState?.action; setConfirmState(null); a?.(); }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
};

