import React, { useState, useEffect, useMemo } from 'react';
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
  LayoutGrid
} from 'lucide-react';
import { 
  ScheduleSlot, 
  ScheduleSlotType, 
  ClassScheduleAssignment, 
  Teacher 
} from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';

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
    border: 'border-slate-300 dark:border-slate-700',
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

  // Mode: 'grid' (Timetable matrix) vs 'weekly-matrix' (Full 5-day week) vs 'slots-editor' (Design structure of hours)
  const [subView, setSubView] = useState<'grid' | 'weekly-matrix' | 'slots-editor'>('grid');

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
    if (window.confirm('¿Eliminar este bloque del horario escolar?')) {
      const updated = slots.filter(s => s.id !== id).map((s, idx) => ({ ...s, order: idx + 1 }));
      AttendanceStorageService.saveScheduleSlots(updated);
      showToast('Bloque eliminado.');
    }
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
      <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
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
        <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl border border-slate-200 dark:border-slate-700 self-stretch md:self-auto overflow-x-auto">
          <button
            onClick={() => setSubView('grid')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              subView === 'grid'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
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
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
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
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Estructura ({slots.length})</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: TIMETABLE GRID MATRIX (SINGLE DAY) */}
      {subView === 'grid' && (
        <div className="space-y-4">
          {/* Controls Bar: Grade Selector & Days Selector */}
          <div className="p-4 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Grade Selector & Stats */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">
                  Curso / Grado:
                </label>
                <select
                  value={selectedGrade}
                  onChange={(e) => setSelectedGrade(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

            {/* Day of Week Tabs */}
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
                    className="p-2.5 rounded-2xl bg-slate-100/70 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
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
                      <div className={`p-2.5 rounded-2xl bg-white dark:bg-slate-900 ${cfg.text} shadow-xs`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className={`text-sm font-black ${cfg.text}`}>
                            {slot.name}
                          </h4>
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300">
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
                        : 'bg-white/80 dark:bg-slate-900/80 border-slate-200/80 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 hover:shadow-md' 
                      : 'bg-slate-50/50 dark:bg-slate-950/40 border-dashed border-slate-300 dark:border-slate-800 hover:bg-indigo-50/30'
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
        <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
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
                className="px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-black text-indigo-600 dark:text-indigo-400"
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
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-400">
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
                      <tr key={slot.id} className="bg-slate-50/60 dark:bg-slate-950/40 text-[10px] text-slate-400">
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
                    <tr key={slot.id} className="hover:bg-slate-50/40 dark:hover:bg-slate-800/40">
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
                                    <Zap className="w-2.5 h-2.5 text-amber-600 shrink-0" title="Bloque Doble 2h" />
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                  {asgn.teacherName?.split(' ')[0]} {asgn.teacherName?.split(' ')[1] || ''}
                                </div>
                              </div>
                            ) : (
                              <div className="p-2 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 text-center hover:border-indigo-400">
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
          <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-4 lg:col-span-1">
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
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500 font-semibold"
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
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:border-indigo-500 font-semibold"
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
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none"
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
                    className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white outline-none"
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
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 flex items-center justify-center gap-1.5 transition-all"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{editingSlotId ? 'Guardar Cambios' : 'Agregar Bloque'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Right: Current Schedule Structure Timeline */}
          <div className="p-6 rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 backdrop-blur-xl shadow-sm space-y-3 lg:col-span-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
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
                      <div className={`p-2 rounded-xl bg-white dark:bg-slate-900 ${cfg.text}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900 dark:text-white">
                            {slot.order}. {slot.name}
                          </span>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300">
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
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:text-indigo-600 transition-colors"
                        title="Editar bloque"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 text-rose-500 hover:text-rose-700 transition-colors"
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
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl max-w-md w-full space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
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
                    El docente ya está asignado a <strong>{teacherConflict.grade}</strong> ({teacherConflict.subject}) a esta misma hora ({editingSlot.startTime}).
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
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
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
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
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
                  className="w-full px-3 py-2 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
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

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
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
    </div>
  );
};

