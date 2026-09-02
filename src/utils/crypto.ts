import { Student } from '../types/attendance';

/**
 * Criptografía nativa WebCrypto (HMAC-SHA256 y PBKDF2)
 * Compatible con Cloudflare Workers (<1ms de CPU) y navegadores modernos.
 */

const DEFAULT_QR_SECRET = 'PROTOTYPE-HMAC-QR-SECRET-COL-2026';

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Genera firma HMAC-SHA256 sobre un string
 */
export async function generateHmacSignature(data: string, secret: string = DEFAULT_QR_SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await window.crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(data)
  );
  return bufferToHex(signatureBuffer).substring(0, 16);
}

/**
 * Genera el payload firmado para el QR del carné
 * Formato canónico: "IEDSJ:v1:<code>:<doc>:<grade>:<sec>:<exp>:<sig16>"
 */
export async function generateStudentQrPayload(student: Student, secret: string = DEFAULT_QR_SECRET): Promise<string> {
  // Vigencia por defecto: 1 año
  const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const baseData = `${student.code}|${student.documentId}|${student.grade}|${student.section}|${expiresAt}`;
  const sig = await generateHmacSignature(baseData, secret);
  return `IEDSJ:v1:${student.code}:${student.documentId}:${student.grade}:${student.section}:${expiresAt}:${sig}`;
}

export interface ParsedQrResult {
  isValidFormat: boolean;
  studentCode: string;
  documentId?: string;
  grade?: string;
  section?: string;
  expiresAt?: number;
  isExpired?: boolean;
  signature?: string;
  isSigned: boolean;
  isSignatureValid?: boolean;
  rawInput: string;
}

/**
 * Analiza y valida una cadena de entrada (QR firmado, código de barras o código directo)
 */
export async function parseAndVerifyScan(rawInput: string, secret: string = DEFAULT_QR_SECRET): Promise<ParsedQrResult> {
  const trimmed = rawInput.trim();

  // 1. Protocolo de carné firmado IEDSJ:v1
  if (trimmed.startsWith('IEDSJ:v1:')) {
    const parts = trimmed.split(':');
    if (parts.length >= 7) {
      const code = parts[2];
      const doc = parts[3];
      const grade = parts[4];
      const sec = parts[5];
      const expiresAt = parseInt(parts[6], 10);
      const sig = parts[7];

      const baseData = `${code}|${doc}|${grade}|${sec}|${expiresAt}`;
      const expectedSig = await generateHmacSignature(baseData, secret);
      const isSignatureValid = (sig === expectedSig);
      const isExpired = Date.now() > expiresAt;

      return {
        isValidFormat: true,
        studentCode: code,
        documentId: doc,
        grade,
        section: sec,
        expiresAt,
        isExpired,
        signature: sig,
        isSigned: true,
        isSignatureValid: isSignatureValid && !isExpired,
        rawInput: trimmed
      };
    }
  }

  // 2. Soporte retrocompatible con COL_ASIS
  if (trimmed.startsWith('COL_ASIS:v1:')) {
    const parts = trimmed.split(':');
    if (parts.length >= 4) {
      const code = parts[2];
      return {
        isValidFormat: true,
        studentCode: code,
        isSigned: true,
        isSignatureValid: true,
        rawInput: trimmed
      };
    }
  }

  // 3. Fallback: Código de barras 1D estándar o código escrito
  const cleanCode = trimmed.replace(/[^a-zA-Z0-9-]/g, '');
  return {
    isValidFormat: cleanCode.length >= 4,
    studentCode: cleanCode,
    isSigned: false,
    rawInput: trimmed
  };
}

// ====================================================================
// Ronda 19 — QR DE CLASE (protocolo CLASE:v1)
// Espejo del carné IEDSJ:v1: el contexto de la clase lo aporta el medio
// físico (QR firmado en la pizarra), no la inferencia temporal.
// Formato canónico: "CLASE:v1:<grade>:<slotId>:<dayOfWeek>:<expMs>:<sig16>"
// ====================================================================

export interface ParsedClassQrResult {
  isClassToken: boolean;      // empieza por CLASE:v1: (el llamador debe rutear aquí ANTES de parseAndVerifyScan)
  isValidFormat: boolean;
  grade?: string;
  slotId?: string;
  dayOfWeek?: number;         // 1=Lunes ... 6=Sábado
  expiresAt?: number;
  isExpired?: boolean;
  signature?: string;
  isSignatureValid?: boolean; // firma válida Y no expirado (semántica IEDSJ)
  rawInput: string;
}

/**
 * Genera el payload firmado del QR de Clase.
 * expiresAtMs = fin del bloque (anti-replay: tras terminar la hora el QR muere).
 * NOTA: la materia NO viaja en el token a propósito — el sistema resuelve la
 * asignación vigente (grade+day+slot) al activar; así una reasignación de cátedra
 * no invalida las tarjetas impresas.
 */
export async function generateClassQrPayload(
  grade: string,
  slotId: string,
  dayOfWeek: number,
  expiresAtMs: number,
  secret: string = DEFAULT_QR_SECRET
): Promise<string> {
  const baseData = `${grade}|${slotId}|${dayOfWeek}|${expiresAtMs}`;
  const sig = await generateHmacSignature(baseData, secret);
  return `CLASE:v1:${grade}:${slotId}:${dayOfWeek}:${expiresAtMs}:${sig}`;
}

/**
 * Analiza y valida un token de QR de Clase.
 * La comparación con el día actual y la resolución de materia viven en el servicio
 * (attendanceStorage.setActiveClassFromToken) para mantener crypto.ts puro.
 */
export async function parseAndVerifyClassScan(rawInput: string, secret: string = DEFAULT_QR_SECRET): Promise<ParsedClassQrResult> {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('CLASE:v1:')) {
    return { isClassToken: false, isValidFormat: false, rawInput: trimmed };
  }
  const parts = trimmed.split(':');
  // CLASE : v1 : grade : slotId : day : exp : sig  → 7 partes
  if (parts.length < 7) {
    return { isClassToken: true, isValidFormat: false, rawInput: trimmed };
  }
  const grade = parts[2];
  const slotId = parts[3];
  const dayOfWeek = parseInt(parts[4], 10);
  const expiresAt = parseInt(parts[5], 10);
  const sig = parts[6];

  if (!grade || !slotId || Number.isNaN(dayOfWeek) || Number.isNaN(expiresAt)) {
    return { isClassToken: true, isValidFormat: false, rawInput: trimmed };
  }

  const baseData = `${grade}|${slotId}|${dayOfWeek}|${expiresAt}`;
  const expectedSig = await generateHmacSignature(baseData, secret);
  const isSignatureValid = sig === expectedSig;
  const isExpired = Date.now() > expiresAt;

  return {
    isClassToken: true,
    isValidFormat: true,
    grade,
    slotId,
    dayOfWeek,
    expiresAt,
    isExpired,
    signature: sig,
    isSignatureValid: isSignatureValid && !isExpired,
    rawInput: trimmed
  };
}

/**
 * Función PBKDF2 nativa con WebCrypto para autenticación local
 */
export async function hashPasswordPbkdf2(password: string, salt: string = 'COL_IED_SALT_2026'): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const key = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 10000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );

  const exported = await window.crypto.subtle.exportKey('raw', key);
  return bufferToHex(exported);
}

export const generateSignedQRPayload = generateStudentQrPayload;

