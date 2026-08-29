import React, { useState } from 'react';
import { 
  X, 
  Search, 
  QrCode, 
  UserCheck, 
  UserX, 
  GraduationCap, 
  Phone, 
  Scan,
  Filter
} from 'lucide-react';
import { Student, AttendanceRecord } from '../types/attendance';
import { AttendanceStorageService } from '../services/attendanceStorage';

interface StudentDirectoryModalProps {
  onClose: () => void;
  onSelectStudentCard: (student: Student) => void;
  todayRecords: AttendanceRecord[];
}

export const StudentDirectoryModal: React.FC<StudentDirectoryModalProps> = ({ 
  onClose, 
  onSelectStudentCard,
  todayRecords 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('ALL');
  const students = AttendanceStorageService.getStudents();

  // Create lookup set for present student IDs
  const presentStudentIds = new Set(todayRecords.map(r => r.studentId));

  const filteredStudents = students.filter(s => {
    const matchesSearch = 
      s.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.documentId.includes(searchTerm);
    const matchesGrade = selectedGrade === 'ALL' || s.grade === selectedGrade;
    return matchesSearch && matchesGrade;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn" id="student-directory-modal">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-4xl w-full p-6 shadow-2xl relative space-y-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/20 text-indigo-400 rounded-2xl">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                Directorio Escolar & Generador de Carnés
              </h3>
              <p className="text-xs text-slate-400">
                {students.length} Estudiantes Matriculados • Ficticios (Ley 1581)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-close-directory"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 shrink-0">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, apellido o documento..."
              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 text-white text-xs pl-9 pr-3 py-2.5 rounded-xl outline-none"
            />
          </div>

          <div>
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-300 text-xs px-3 py-2.5 rounded-xl outline-none focus:border-indigo-500"
            >
              <option value="ALL">Todos los Grados</option>
              <option value="11°">11° Grado</option>
              <option value="10°">10° Grado</option>
              <option value="9°">9° Grado</option>
              <option value="8°">8° Grado</option>
              <option value="7°">7° Grado</option>
              <option value="6°">6° Grado</option>
            </select>
          </div>
        </div>

        {/* Student Grid */}
        <div className="overflow-y-auto flex-1 pr-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredStudents.map((std) => {
            const isPresent = presentStudentIds.has(std.id);
            return (
              <div
                key={std.id}
                className="bg-slate-950/70 border border-slate-800/80 hover:border-indigo-500/50 rounded-2xl p-3.5 transition-all flex flex-col justify-between gap-3 group"
              >
                <div className="flex items-start gap-3">
                  {std.avatarUrl ? (
                    <img
                      src={std.avatarUrl}
                      alt=""
                      className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                      {std.firstName[0]}{std.lastName[0]}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                        {std.grade} - {std.section}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isPresent
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {isPresent ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                        <span>{isPresent ? 'Presente' : 'Ausente'}</span>
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-white truncate">
                      {std.firstName} {std.lastName}
                    </h4>

                    <p className="text-[11px] font-mono text-slate-400">
                      Doc: {std.documentId}
                    </p>

                    <p className="text-[10px] text-slate-500 truncate mt-1">
                      Acudiente: {std.guardianName}
                    </p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-slate-500 truncate">
                    ID: {std.id}
                  </span>

                  <button
                    onClick={() => {
                      onSelectStudentCard(std);
                      onClose();
                    }}
                    id={`btn-view-card-${std.id}`}
                    className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-xl text-[11px] font-semibold transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Ver Carné & QR</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
