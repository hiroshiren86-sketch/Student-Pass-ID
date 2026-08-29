import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { 
  X, 
  Download, 
  ShieldCheck, 
  Scan, 
  Camera, 
  Building2, 
  GraduationCap, 
  QrCode,
  Sparkles,
  Printer
} from 'lucide-react';
import { Student } from '../types/attendance';
import { generateStudentQrPayload } from '../utils/crypto';
import { AttendanceStorageService } from '../services/attendanceStorage';

interface StudentCardModalProps {
  student: Student | null;
  onClose: () => void;
  onSimulateScan: (payload: string, method: 'usb_scanner' | 'camera_qr') => void;
}

export const StudentCardModal: React.FC<StudentCardModalProps> = ({ 
  student, 
  onClose,
  onSimulateScan 
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrPayloadString, setQrPayloadString] = useState<string>('');
  const settings = AttendanceStorageService.getSettings();

  useEffect(() => {
    if (!student) return;

    let isMounted = true;
    (async () => {
      const payload = await generateStudentQrPayload(student, settings.secretHmacKey);
      if (!isMounted) return;
      setQrPayloadString(payload);

      try {
        const url = await QRCode.toDataURL(payload, {
          width: 320,
          margin: 1.5,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'M',
        });
        if (isMounted) setQrDataUrl(url);
      } catch (err) {
        console.error('Error generating QR code:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [student, settings.secretHmacKey]);

  if (!student) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn" id="student-card-modal">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden space-y-6">
        {/* Top Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Carné Escolar Digital</h3>
              <p className="text-xs text-slate-400">Validado criptográficamente con HMAC-SHA256</p>
            </div>
          </div>
          <button
            onClick={onClose}
            id="btn-close-student-card-modal"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* The Digital ID Card (Printable Layout) */}
        <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 border-2 border-indigo-500/40 rounded-2xl p-5 shadow-2xl relative overflow-hidden text-slate-100 space-y-4">
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-indigo-500/30 pb-3">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-6 h-6 text-indigo-400" />
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-indigo-200">
                  {settings.schoolName}
                </h4>
                <p className="text-[10px] text-slate-400 font-mono">
                  AÑO LECTIVO 2026 • CÓDIGO: {settings.schoolCode}
                </p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 uppercase">
              ACTIVO
            </span>
          </div>

          {/* Student Body Info */}
          <div className="flex items-center gap-4">
            {/* Student Photo */}
            <div className="relative shrink-0">
              {student.avatarUrl ? (
                <img
                  src={student.avatarUrl}
                  alt={student.firstName}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-2 border-indigo-400 shadow-md"
                />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-indigo-700/40 border-2 border-indigo-400 flex items-center justify-center text-2xl font-bold text-white">
                  {student.firstName[0]}{student.lastName[0]}
                </div>
              )}
              <span className="absolute -bottom-1.5 -right-1.5 p-1 bg-indigo-600 rounded-full text-white text-[10px]">
                <GraduationCap className="w-3.5 h-3.5" />
              </span>
            </div>

            {/* Details */}
            <div className="space-y-1 min-w-0 flex-1">
              <h5 className="text-base sm:text-lg font-extrabold text-white tracking-tight leading-tight truncate">
                {student.firstName} {student.lastName}
              </h5>
              <p className="text-xs text-indigo-300 font-mono">
                {student.documentType}: <strong className="text-white">{student.documentId}</strong>
              </p>
              <div className="flex items-center gap-2 pt-1">
                <span className="px-2 py-0.5 rounded-md bg-indigo-900/60 text-indigo-200 border border-indigo-700 text-xs font-bold">
                  Grado: {student.grade} - {student.section}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  ID: {student.id}
                </span>
              </div>
            </div>
          </div>

          {/* QR Code and Barcode Box */}
          <div className="bg-white rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-slate-900 shadow-inner">
            <div className="space-y-1 text-center sm:text-left">
              <div className="flex items-center gap-1 text-[11px] font-bold text-indigo-900">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>CÓDIGO QR SEGURO HMAC</span>
              </div>
              <p className="text-[10px] text-slate-600 font-mono break-all max-w-[200px] leading-tight">
                {qrPayloadString.substring(0, 32)}...
              </p>
              {/* Simulated 1D Barcode bars */}
              <div className="pt-1 flex items-center justify-center sm:justify-start gap-[2px] h-6 overflow-hidden">
                {student.documentId.split('').map((char, i) => (
                  <div 
                    key={i} 
                    className="bg-black h-full" 
                    style={{ width: `${(parseInt(char, 10) % 3) + 1.5}px` }} 
                  />
                ))}
              </div>
              <span className="text-[9px] font-mono text-slate-600 block">
                *{student.documentId}*
              </span>
            </div>

            {/* Rendered QR Code */}
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Código QR del estudiante"
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg shadow-sm border border-slate-200"
              />
            ) : (
              <div className="w-24 h-24 bg-slate-200 animate-pulse rounded-lg" />
            )}
          </div>

          {/* Acudiente footer */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Acudiente: <strong className="text-slate-200">{student.guardianName}</strong></span>
            <span className="font-mono">{student.guardianPhone}</span>
          </div>
        </div>

        {/* Live Simulator & Action Buttons */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Probar Escaneo Inmediato:
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                onSimulateScan(qrPayloadString, 'camera_qr');
                onClose();
              }}
              id="btn-simulate-qr-scan"
              className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all"
            >
              <Camera className="w-4 h-4" />
              <span>Simular Escáner QR</span>
            </button>

            <button
              onClick={() => {
                onSimulateScan(student.documentId, 'usb_scanner');
                onClose();
              }}
              id="btn-simulate-barcode-scan"
              className="px-3 py-2.5 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Scan className="w-4 h-4" />
              <span>Simular Lector USB</span>
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" /> Imprimir Carné
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
