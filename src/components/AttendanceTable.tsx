import React, { useState } from 'react';
import { 
  Download, 
  Search, 
  Filter, 
  Trash2, 
  QrCode, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Scan, 
  Camera, 
  Edit3, 
  Check, 
  X,
  Phone,
  ShieldCheck,
  UserCheck
} from 'lucide-react';
import { AttendanceRecord, Student, AttendanceStatus, AttendanceMethod } from '../types/attendance';
import { AttendanceStorageService, getTodayDateString } from '../services/attendanceStorage';

interface AttendanceTableProps {
  records: AttendanceRecord[];
  onOpenCardModal: (student: Student) => void;
  onRefresh: () => void;
}

export const AttendanceTable: React.FC<AttendanceTableProps> = ({ 
  records, 
  onOpenCardModal,
  onRefresh 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedMethod, setSelectedMethod] = useState('ALL');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<AttendanceStatus>('punctual');
  const [editNotes, setEditNotes] = useState<string>('');

  // Filter logic
  const filteredRecords = records.filter(r => {
    const matchesSearch = 
      r.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.studentDocument.includes(searchTerm) ||
      r.studentGrade.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesGrade = selectedGrade === 'ALL' || r.studentGrade === selectedGrade;
    const matchesStatus = selectedStatus === 'ALL' || r.status === selectedStatus;
    const matchesMethod = selectedMethod === 'ALL' || r.method === selectedMethod;

    return matchesSearch && matchesGrade && matchesStatus && matchesMethod;
  });

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`¿Estás seguro de eliminar el registro de asistencia de ${name}?`)) {
      AttendanceStorageService.deleteRecord(id);
      onRefresh();
    }
  };

  const startEditing = (record: AttendanceRecord) => {
    setEditingRecordId(record.id);
    setEditStatus(record.status);
    setEditNotes(record.notes || '');
  };

  const saveEdit = (recordId: string) => {
    AttendanceStorageService.updateRecord(recordId, {
      status: editStatus,
      notes: editNotes
    });
    setEditingRecordId(null);
    onRefresh();
  };

  const handleExportCsv = () => {
    AttendanceStorageService.exportAttendanceCsv(getTodayDateString());
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xl space-y-5" id="attendance-table-container">
      {/* Header & Export Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-white tracking-tight">
              Registro de Asistencia en Tiempo Real
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {filteredRecords.length} Registros
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Jornada de hoy • {getTodayDateString()}
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          id="btn-export-csv"
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition-all flex items-center gap-2 shadow-sm self-start sm:self-auto"
        >
          <Download className="w-4 h-4 text-indigo-400" />
          <span>Exportar Reporte (CSV)</span>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre o documento..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-white text-xs pl-9 pr-3 py-2 rounded-xl outline-none"
          />
        </div>

        {/* Grade Filter */}
        <div>
          <select
            value={selectedGrade}
            onChange={(e) => setSelectedGrade(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-xs px-3 py-2 rounded-xl outline-none focus:border-indigo-500"
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

        {/* Status Filter */}
        <div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-xs px-3 py-2 rounded-xl outline-none focus:border-indigo-500"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="punctual">Puntuales</option>
            <option value="tardy">Tardanzas</option>
            <option value="justified">Justificados</option>
          </select>
        </div>

        {/* Method Filter */}
        <div>
          <select
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-300 text-xs px-3 py-2 rounded-xl outline-none focus:border-indigo-500"
          >
            <option value="ALL">Todos los Métodos</option>
            <option value="usb_scanner">Lector USB HID</option>
            <option value="camera_qr">Cámara QR</option>
            <option value="manual_entry">Registro Manual</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/90 text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-800 text-[11px]">
            <tr>
              <th className="py-3 px-4">Estudiante</th>
              <th className="py-3 px-4">Documento</th>
              <th className="py-3 px-4">Grado / Sec.</th>
              <th className="py-3 px-4">Hora de Ingreso</th>
              <th className="py-3 px-4">Estado</th>
              <th className="py-3 px-4">Método</th>
              <th className="py-3 px-4">Acudiente</th>
              <th className="py-3 px-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-normal">
            {filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <UserCheck className="w-8 h-8 text-slate-600" />
                    <p className="text-sm font-medium">No se encontraron registros con los filtros seleccionados</p>
                    <p className="text-xs text-slate-600">Escanea un carné o realiza una búsqueda diferente</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRecords.map((rec) => {
                const isEditing = editingRecordId === rec.id;
                const student = AttendanceStorageService.getStudentById(rec.studentId);

                return (
                  <tr key={rec.id} className="hover:bg-slate-900/60 transition-colors group">
                    {/* Student Avatar & Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {rec.studentAvatar ? (
                          <img
                            src={rec.studentAvatar}
                            alt=""
                            className="w-8 h-8 rounded-lg object-cover border border-white/10 shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0">
                            {rec.studentName.substring(0, 2)}
                          </div>
                        )}
                        <span className="font-semibold text-white truncate max-w-[160px]">
                          {rec.studentName}
                        </span>
                      </div>
                    </td>

                    {/* Document */}
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {rec.studentDocument}
                    </td>

                    {/* Grade */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 font-semibold text-slate-200 border border-slate-700">
                        {rec.studentGrade} - {rec.studentSection}
                      </span>
                    </td>

                    {/* Time */}
                    <td className="py-3 px-4 font-mono text-white font-medium">
                      {rec.time}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      {isEditing ? (
                        <select
                          value={editStatus}
                          onChange={(e) => setEditStatus(e.target.value as AttendanceStatus)}
                          className="bg-slate-900 border border-indigo-500 text-white rounded px-2 py-1 text-xs"
                        >
                          <option value="punctual">Puntual</option>
                          <option value="tardy">Tarde</option>
                          <option value="justified">Justificado</option>
                        </select>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                          rec.status === 'punctual'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : rec.status === 'tardy'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                        }`}>
                          {rec.status === 'punctual' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          {rec.status === 'tardy' && <Clock className="w-3 h-3 text-amber-400" />}
                          {rec.status === 'justified' && <ShieldCheck className="w-3 h-3 text-indigo-400" />}
                          <span>{rec.status === 'punctual' ? 'Puntual' : rec.status === 'tardy' ? 'Tardanza' : 'Justificado'}</span>
                        </span>
                      )}
                    </td>

                    {/* Method */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1 text-[11px] text-slate-400">
                        {rec.method === 'usb_scanner' && (
                          <>
                            <Scan className="w-3.5 h-3.5 text-emerald-400" />
                            <span>USB HID</span>
                          </>
                        )}
                        {rec.method === 'camera_qr' && (
                          <>
                            <Camera className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Cámara QR</span>
                          </>
                        )}
                        {rec.method === 'manual_entry' && (
                          <>
                            <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Manual</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Guardian info */}
                    <td className="py-3 px-4 text-[11px] text-slate-400">
                      <div className="truncate max-w-[140px]" title={rec.guardianName}>
                        {rec.guardianName}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {rec.guardianPhone}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => saveEdit(rec.id)}
                              className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                              title="Guardar Cambios"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setEditingRecordId(null)}
                              className="p-1 rounded bg-slate-800 text-slate-300 hover:text-white"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            {student && (
                              <button
                                onClick={() => onOpenCardModal(student)}
                                className="p-1.5 text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 rounded-lg transition-colors"
                                title="Ver Carné Digital"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                            )}

                            <button
                              onClick={() => startEditing(rec)}
                              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors"
                              title="Editar Estado o Nota"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleDelete(rec.id, rec.studentName)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                              title="Eliminar Registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
