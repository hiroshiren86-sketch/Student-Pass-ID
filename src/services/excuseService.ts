import {
  StudentExcuse,
  ExcuseStatus,
  ExcuseReason,
  AttendanceRecord
} from '../types/attendance';
// Ciclo runtime-only con attendanceStorage (ambos se referencian SOLO dentro de
// métodos estáticos, nunca en evaluación de módulo) — patrón ESM seguro.
import { AttendanceStorageService } from './attendanceStorage';

/**
 * ==============================================================================
 * SERVICIO DE EXCUSAS JUSTIFICADAS — Ronda 21 (P1/P2 de spec-excusas-2026)
 *
 * Única puerta del frontend hacia el módulo de excusas del Worker (/api/excuses).
 * El Worker es la ÚNICA autoridad (reglas R1–R10 validadas en servidor); este
 * servicio: (a) mantiene un CACHE local de excusas para que el auto-cierre
 * consulte la protección SIN red por cada bloque (§4.1), (b) aplica/limpia el
 * OVERLAY excuse_id sobre los registros locales (§1.2) y (c) expone radicación
 * y decisión para la UI (portal / planilla 1 toque / buzón Rectoría).
 *
 * Notas de arquitectura:
 * - El overlay local (excuseId + excuseStatus snapshot) es una COPIA para pintar
 *   etiquetas; la verdad vive en D1. La propagación a otros dispositivos es la
 *   sincronización existente (eventual, ≤ intervalo de auto-sync) — decisión
 *   documentada: no se toca la mecánica del snapshot (Ronda 16).
 * - Falta injustificada = status 'AUSENTE' AND excuseId ausente. La etiqueta
 *   derivada NUNCA revela reason/notes/foto en planillas docentes (§5):
 *   esos datos solo se muestran en el buzón de Rectoría y el portal propio.
 * ==============================================================================
 */

const EXCUSES_CACHE_KEY = 'inas_excuses_cache_v1';

/** Etiquetas derivadas del overlay — §1.2/§4.2. '' = ausencia injustificada. */
export function justificationLabelOf(rec: Pick<AttendanceRecord, 'status' | 'excuseId' | 'excuseStatus'>): '' | 'Excusada (bajo revisión)' | 'Excusada (verificada)' {
  if (rec.status !== 'AUSENTE' || !rec.excuseId) return '';
  return rec.excuseStatus === 'APROBADA' ? 'Excusada (verificada)' : 'Excusada (bajo revisión)';
}

/** ¿Está protegida esta ausencia? (excusa no rechazada — §1.1 protección provisional) */
export function isRecordProtected(rec: Pick<AttendanceRecord, 'status' | 'excuseId' | 'excuseStatus'>): boolean {
  return rec.status === 'AUSENTE' && !!rec.excuseId && rec.excuseStatus !== 'RECHAZADA';
}

export interface ExcuseApiError { rule: string; message_es: string }

export interface ExcuseApiResult {
  ok: boolean;
  status?: number;
  excuse?: StudentExcuse;
  message?: string;
  error?: string;
  errors?: ExcuseApiError[];
}

export class ExcuseService {
  // ============================ CONEXIÓN (patrón sync) ============================

  private static getWorkerBaseUrl(): string {
    try {
      const raw = localStorage.getItem('inas_settings_v5');
      const settings = raw ? JSON.parse(raw) : {};
      return (settings.cloudflareWorkerUrl || '').trim().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  private static workerHeaders(): Record<string, string> {
    let token = '';
    try {
      const raw = localStorage.getItem('inas_settings_v5');
      token = (raw ? (JSON.parse(raw).cloudflareApiToken || '') : '').trim();
    } catch { /* sin token */ }
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  // ============================ CACHE LOCAL ============================

  static getCachedExcuses(): StudentExcuse[] {
    try {
      const raw = localStorage.getItem(EXCUSES_CACHE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  private static saveCache(list: StudentExcuse[]): void {
    try {
      localStorage.setItem(EXCUSES_CACHE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch { /* cuota llena: el cache es prescindible */ }
  }

  /**
   * Descarga las excusas del Worker y refresca el cache. Best-effort: si el Worker
   * no está configurado o falla, el cache vigente se conserva (degradación graceful —
   * el auto-cierre NUNCA se bloquea por red). Devuelve el número de excusas vigentes.
   */
  static async syncFromWorker(): Promise<{ ok: boolean; count: number; error?: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, count: 0, error: 'URL del Worker no configurada.' };
    try {
      const res = await fetch(`${baseUrl}/api/excuses`, { method: 'GET', headers: this.workerHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { ok: false, count: 0, error: data?.error || `HTTP ${res.status}` };
      }
      const excuses: StudentExcuse[] = Array.isArray(data.excuses) ? data.excuses : [];
      this.saveCache(excuses);
      return { ok: true, count: excuses.length };
    } catch (err: any) {
      return { ok: false, count: 0, error: err?.message || 'Fallo de red al consultar excusas.' };
    }
  }

  /**
   * R7: la excusa NO rechazada más antigua (created_at) que cubra studentCode+date.
   * Solo cache — síncrono, pensado para el auto-cierre (§4.1).
   */
  static findCoveringExcuse(studentCode: string, date: string): StudentExcuse | null {
    const candidates = this.getCachedExcuses()
      .filter(e =>
        e.studentCode === studentCode &&
        e.status !== 'RECHAZADA' &&
        e.startDate <= date && date <= e.endDate
      )
      .sort((a, b) => (a.createdAt || a.id).localeCompare(b.createdAt || b.id));
    return candidates[0] || null;
  }

  /** Mapa studentCode → excusa que cubre `date` (una pasada, para el auto-cierre). */
  static getProtectionMapForDate(date: string): Map<string, StudentExcuse> {
    const map = new Map<string, StudentExcuse>();
    for (const e of this.getCachedExcuses()) {
      if (e.status === 'RECHAZADA') continue;
      if (!(e.startDate <= date && date <= e.endDate)) continue;
      const prev = map.get(e.studentCode);
      if (!prev || (e.createdAt || e.id).localeCompare(prev.createdAt || prev.id) < 0) {
        map.set(e.studentCode, e); // R7: la más antigua gana
      }
    }
    return map;
  }

  // ============================ OVERLAY LOCAL (§1.2) ============================

  /**
   * Vincula la excusa a los registros locales AUSENTE del rango (o a los recordIds
   * dados, flujo post-hoc 1 toque). Devuelve cuántos registros quedaron enlazados.
   * Idempotente: no toca registros ya enlazados a OTRA excusa (R2) ni no-AUSENTE (R9).
   */
  static applyOverlayToRecords(opts: {
    excuse: StudentExcuse;
    recordIds?: string[];
    studentCode?: string;
    startDate?: string;
    endDate?: string;
  }): number {
    const records = AttendanceStorageService.getAllAttendance();
    const byId = new Set(opts.recordIds || []);
    const stamp = new Date().toISOString();
    let linked = 0;
    const next = records.map(r => {
      const matchesId = byId.size > 0
        ? byId.has(r.id)
        : r.studentCode === (opts.studentCode || opts.excuse.studentCode)
          && r.status === 'AUSENTE'
          && !r.excuseId
          && !!opts.startDate && !!opts.endDate
          && opts.startDate <= r.date && r.date <= opts.endDate!;
      if (!matchesId) return r;
      linked++;
      return { ...r, excuseId: opts.excuse.id, excuseStatus: opts.excuse.status, excuseUpdatedAt: stamp };
    });
    if (linked > 0) {
      AttendanceStorageService.saveAttendance(next);
    }
    return linked;
  }

  /**
   * Desvincula (rechazo / eliminación): los registros vuelven a AUSENTE puro y el %
   * se recalcula con el conteo estándar (§3 — reversión limpia, sin migrar estados).
   */
  static clearOverlayFromRecords(excuseId: string): number {
    const records = AttendanceStorageService.getAllAttendance();
    const stamp = new Date().toISOString();
    let cleared = 0;
    const next = records.map(r => {
      if (r.excuseId !== excuseId) return r;
      cleared++;
      // excuseUpdatedAt SE CONSERVA (con el nuevo stamp): es la evidencia de que el
      // overlay cambió — el pull de otros dispositivos la usa para converger al clear.
      const { excuseId: _e, excuseStatus: _s, ...rest } = r;
      return { ...(rest as AttendanceRecord), excuseUpdatedAt: stamp };
    });
    if (cleared > 0) {
      AttendanceStorageService.saveAttendance(next);
    }
    return cleared;
  }

  /** Refresca SOLO el snapshot de estado (aprobación: la vinculación ya existe). */
  static refreshOverlayStatus(excuseId: string, status: ExcuseStatus): number {
    const records = AttendanceStorageService.getAllAttendance();
    const stamp = new Date().toISOString();
    let touched = 0;
    const next = records.map(r => {
      if (r.excuseId !== excuseId) return r;
      touched++;
      return { ...r, excuseStatus: status, excuseUpdatedAt: stamp };
    });
    if (touched > 0) {
      AttendanceStorageService.saveAttendance(next);
    }
    return touched;
  }

  // ============================ API (worker = autoridad) ============================

  /**
   * POST /api/excuses — radicar (anticipada desde portal o post-hoc 1 toque).
   * Las reglas R1/R2/R3/R9/R10 se validan en el Worker; aquí solo se traduce la
   * respuesta y se refleja el overlay local para feedback inmediato (§7.2).
   */
  static async createExcuse(payload: {
    studentCode: string;
    startDate: string;
    endDate: string;
    reason: ExcuseReason;
    notes?: string;
    sourceAttendanceId?: string;
    submittedBy: string;
  }): Promise<ExcuseApiResult> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: 'URL del Cloudflare Worker no configurada (Ajustes → Sincronización en la Nube).' };
    try {
      const res = await fetch(`${baseUrl}/api/excuses`, {
        method: 'POST',
        headers: this.workerHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}`, errors: data?.errors };
      }
      const excuse = data.excuse as StudentExcuse;
      // Cache + overlay local inmediato (el badge aparece al instante en ESTE dispositivo;
      // los demás lo reciben por sync ≤ intervalo de auto-sync).
      const cache = this.getCachedExcuses();
      this.saveCache([excuse, ...cache]);
      if (payload.sourceAttendanceId) {
        this.applyOverlayToRecords({ excuse, recordIds: [payload.sourceAttendanceId] });
      } else if (payload.startDate <= new Date().toISOString().slice(0, 10)) {
        // Post-hoc por rango: el worker enlazó todos los AUSENTE sin excusa del rango
        this.applyOverlayToRecords({ excuse, studentCode: payload.studentCode, startDate: payload.startDate, endDate: payload.endDate });
      }
      return { ok: true, status: 201, excuse, message: data.message };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Fallo de red al radicar la excusa.' };
    }
  }

  /**
   * PATCH /api/excuses/:id — Rectoría decide (R5: el Worker rechaza otros roles con 403).
   * APROBADA → refresca snapshot local; RECHAZADA → desvincula (reversión limpia §3).
   */
  static async decideExcuse(id: string, decision: {
    status: 'APROBADA' | 'RECHAZADA';
    rejectReason?: string;
    reviewedBy: string;
    reviewedByRole: string; // debe ser 'RECTORIA' — R5 se enforcea en el Worker
    physicalDocumentVerified?: boolean;
  }): Promise<ExcuseApiResult & { recordsAffected?: number }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: 'URL del Cloudflare Worker no configurada.' };
    try {
      const res = await fetch(`${baseUrl}/api/excuses/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: this.workerHeaders(),
        body: JSON.stringify(decision)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { ok: false, status: res.status, error: data?.error || `HTTP ${res.status}`, errors: data?.errors };
      }
      const excuse = data.excuse as StudentExcuse;
      const cache = this.getCachedExcuses();
      this.saveCache(cache.map(e => (e.id === id ? { ...e, ...excuse } : e)));
      if (decision.status === 'APROBADA') {
        this.refreshOverlayStatus(id, 'APROBADA');
      } else {
        this.clearOverlayFromRecords(id);
      }
      return { ok: true, status: 200, excuse, recordsAffected: data.recordsAffected, message: data.message };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Fallo de red al registrar la decisión.' };
    }
  }

  /**
   * GET /api/excuses con filtros (buzón Rectoría / portal "Mis justificaciones").
   * No toca el cache: el buzón siempre muestra la verdad del Worker (con sweep 72h lazy).
   */
  static async listFromWorker(filters?: {
    studentCode?: string;
    status?: ExcuseStatus;
    from?: string;
    to?: string;
  }): Promise<{ ok: boolean; excuses: StudentExcuse[]; error?: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, excuses: [], error: 'URL del Cloudflare Worker no configurada.' };
    try {
      const qs = new URLSearchParams();
      if (filters?.studentCode) qs.set('studentCode', filters.studentCode);
      if (filters?.status) qs.set('status', filters.status);
      if (filters?.from) qs.set('from', filters.from);
      if (filters?.to) qs.set('to', filters.to);
      const res = await fetch(`${baseUrl}/api/excuses${qs.toString() ? `?${qs.toString()}` : ''}`, {
        method: 'GET',
        headers: this.workerHeaders()
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        return { ok: false, excuses: [], error: data?.error || `HTTP ${res.status}` };
      }
      return { ok: true, excuses: Array.isArray(data.excuses) ? data.excuses : [] };
    } catch (err: any) {
      return { ok: false, excuses: [], error: err?.message || 'Fallo de red al consultar excusas.' };
    }
  }

  /**
   * GET /api/excuses/verify-chain — expediente forense (§6.2). Rectoría puede verificar
   * en segundos que la cadena HMAC de decisiones no fue alterada.
   */
  static async verifyChain(): Promise<{ ok: boolean; intact?: boolean; signed?: boolean; checked?: number; firstBroken?: string; error?: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: 'URL del Cloudflare Worker no configurada.' };
    try {
      const res = await fetch(`${baseUrl}/api/excuses/verify-chain`, { method: 'GET', headers: this.workerHeaders() });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      return { ok: true, intact: data.intact, signed: data.signed, checked: data.checked, firstBroken: data.firstBroken };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Fallo de red al verificar la cadena.' };
    }
  }

  // ==================== Ronda 22 — FASE P3: EVIDENCIA (foto cifrada) ====================

  /**
   * POST /api/excuses/:id/attachment — sube el soporte fotográfico del documento físico.
   * El Worker lo cifra AES-GCM-256 antes de persistir (la foto jamás queda en claro).
   * El caller debe pasar la foto YA COMPRIMIDA en base64 (imageCompressor, ~30-90 KB).
   */
  static async uploadAttachment(id: string, payload: {
    studentCode: string;         // dueño de la excusa (o role:'RECTORIA' desde el buzón)
    dataBase64: string;
    mime?: 'image/jpeg' | 'image/png' | 'image/webp';
  }): Promise<{ ok: boolean; error?: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: 'URL del Cloudflare Worker no configurada.' };
    try {
      const res = await fetch(`${baseUrl}/api/excuses/${encodeURIComponent(id)}/attachment`, {
        method: 'POST',
        headers: this.workerHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Fallo de red al subir el soporte.' };
    }
  }

  /**
   * GET /api/excuses/:id/attachment — descifra y devuelve el soporte. El Worker solo
   * responde a RECTORÍA o al estudiante dueño (Ley 1581 dato especial); la planilla
   * JAMÁS llama este método (minimización §5).
   */
  static async fetchAttachment(id: string, viewer: {
    role?: string;               // 'RECTORIA' desde el buzón
    studentCode?: string;        // dueño, desde su portal
  }): Promise<{ ok: boolean; dataBase64?: string; mime?: string; error?: string }> {
    const baseUrl = this.getWorkerBaseUrl();
    if (!baseUrl) return { ok: false, error: 'URL del Cloudflare Worker no configurada.' };
    try {
      const qs = new URLSearchParams();
      if (viewer.role) qs.set('role', viewer.role);
      if (viewer.studentCode) qs.set('requestBy', viewer.studentCode);
      const res = await fetch(`${baseUrl}/api/excuses/${encodeURIComponent(id)}/attachment${qs.toString() ? `?${qs}` : ''}`, {
        method: 'GET', headers: this.workerHeaders()
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) return { ok: false, error: data?.error || `HTTP ${res.status}` };
      return { ok: true, dataBase64: data.dataBase64, mime: data.mime || 'image/jpeg' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Fallo de red al descargar el soporte.' };
    }
  }
}
