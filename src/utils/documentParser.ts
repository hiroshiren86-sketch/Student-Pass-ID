import { Student, DocumentType } from '../types/attendance';
import { normalizeDocumentOrCode } from './searchHelper';
import { compressImageFile } from './imageCompressor';

export interface ExtractedStudentDraft {
  id: string;
  fileName: string;
  documentType: DocumentType;
  documentId: string;
  firstName: string;
  lastName: string;
  grade: string;
  photoUrl?: string;
  confidence: number;
  status: 'valid' | 'warning' | 'error';
  errorMessage?: string;
}

/**
 * Valida si un texto corresponde a un formato de grado escolar válido y no a texto corrupto
 * Ejemplos válidos: "6°1", "10°4", "11°2", "TRANSICIÓN", "JARDÍN", "PARVULOS", "ACELERACIÓN"
 * Inválidos: "JERONIMO,11°1", "13°9", "PRUEBA FANTASMA"
 */
export function isValidGrade(grade: string): boolean {
  if (!grade) return false;
  const clean = grade.trim().toUpperCase();
  if (/^(?:[1-9]|1[0-1])[°\s-][1-9]$/.test(clean)) return true;
  if (/^(?:TRANSICI[OÓ]N|JARD[IÍ]N|P[AÁ]RVULOS|ACELERACI[OÓ]N|BRICOL)$/.test(clean)) return true;
  return false;
}

/**
 * Normaliza nombres de cursos/grados comunes en colegios colombianos
 * Ej: "605" -> "6°5", "10-4" -> "10°4", "11 2" -> "11°2", "DECIMO CUATRO" -> "10°4", "JERONIMO,11°1" -> "11°1"
 */
export function normalizeGradeName(input: string): string {
  if (!input) return '6°1';
  const chunk = input.trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/GRADO\s*/i, '')
    .replace(/CURSO\s*/i, '')
    .replace(/GRUPO\s*/i, '');

  // Si viene contaminado con nombres o comas (ej: "JERONIMO,11°1" o "LOPEZ 10-2")
  const embeddedGradeMatch = chunk.match(/\b(1[0-1]|[1-9])\s*[°\s-]\s*([1-9])\b/);
  if (embeddedGradeMatch) {
    return `${embeddedGradeMatch[1]}°${embeddedGradeMatch[2]}`;
  }

  // Reemplazo textual de grados
  let clean = chunk
    .replace(/PRIMERO/i, '1')
    .replace(/SEGUNDO/i, '2')
    .replace(/TERCERO/i, '3')
    .replace(/CUARTO/i, '4')
    .replace(/QUINTO/i, '5')
    .replace(/SEXTO/i, '6')
    .replace(/SÉPTIMO|SEPTIMO/i, '7')
    .replace(/OCTAVO/i, '8')
    .replace(/NOVENO/i, '9')
    .replace(/DÉCIMO|DECIMO/i, '10')
    .replace(/ONCE/i, '11');

  // Si viene como "605", "1004", "1102"
  const match3Digits = clean.match(/^([1]?[0-9])0?([1-9])$/);
  if (match3Digits) {
    const g = parseInt(match3Digits[1], 10);
    if (g >= 1 && g <= 11) {
      return `${g}°${match3Digits[2]}`;
    }
  }

  // Si viene con guión ej "6-5", "10-4"
  const matchHyphen = clean.match(/^([1]?[0-9])\s*[-–—/.]\s*([0-9A-Za-z]+)$/);
  if (matchHyphen) {
    const g = parseInt(matchHyphen[1], 10);
    if (g >= 1 && g <= 11) {
      return `${g}°${matchHyphen[2]}`;
    }
  }

  // Si ya tiene el símbolo °
  if (clean.includes('°')) {
    const parts = clean.split('°');
    const g = parseInt(parts[0].trim(), 10);
    const s = parts[1]?.trim();
    if (g >= 1 && g <= 11 && s) {
      return `${g}°${s}`;
    }
  }

  // Si viene "10 4"
  const matchSpace = clean.match(/^([1]?[0-9])\s+([0-9A-Za-z]+)$/);
  if (matchSpace) {
    const g = parseInt(matchSpace[1], 10);
    if (g >= 1 && g <= 11) {
      return `${g}°${matchSpace[2]}`;
    }
  }

  return isValidGrade(clean) ? clean : '6°1';
}

/**
 * Detecta el tipo de documento SIMAT a partir del texto o longitud
 */
export function detectDocumentType(text: string, documentNumber: string): DocumentType {
  const upper = text.toUpperCase();
  if (/\b(RC|REGISTRO\s+CIVIL)\b/.test(upper)) return 'RC';
  if (/\b(TI|TARJETA\s+DE\s+IDENTIDAD|T\.I\.)\b/.test(upper)) return 'TI';
  if (/\b(CC|CEDULA\s+DE\s+CIUDADANIA|C\.C\.)\b/.test(upper)) return 'CC';
  if (/\b(CE|CEDULA\s+DE\s+EXTRANJERIA|C\.E\.)\b/.test(upper)) return 'CE';
  if (/\b(PPT|PERMISO\s+POR\s+PROTECCION\s+TEMPORAL)\b/.test(upper)) return 'PPT';
  if (/\b(PEP|PERMISO\s+ESPECIAL)\b/.test(upper)) return 'PEP';
  if (/\b(NES|NUMERO\s+ESTABLECIDO)\b/.test(upper)) return 'NES';

  // Por defecto según la longitud típica en Colombia
  if (documentNumber.length >= 10 && documentNumber.startsWith('1')) return 'TI';
  if (documentNumber.length <= 8) return 'CC';
  return 'TI';
}

/**
 * Procesa un archivo de texto, CSV, JSON, o imagen de carné/ficha de matrícula
 */
export async function parseDocumentFile(file: File): Promise<ExtractedStudentDraft[]> {
  const fileName = file.name;
  const fileExt = fileName.split('.').pop()?.toLowerCase() || '';

  // 1. Archivos de Texto / CSV / SIMAT export
  if (fileExt === 'csv' || fileExt === 'txt') {
    const content = await file.text();
    return parseTextOrCsvContent(content, fileName);
  }

  // 2. Archivos JSON
  if (fileExt === 'json') {
    try {
      const content = await file.text();
      const parsed不易 = JSON.parse(content);
      const items = Array.isArray(parsed不易) ? parsed不易 : (parsed不易.students || parsed不易.estudiantes || [parsed不易]);
      return items.map((item: any, idx: number) => {
        const rawDoc = String(
          item.documentId ?? item.documento ?? item.identificacion ?? item.numeroDocumento ?? item.doc ?? item.ti ?? item.cc ?? `1000${idx}`
        ).trim();
        const doc = normalizeDocumentOrCode(rawDoc);

        const rawGrade = String(item.grade ?? item.grado ?? item.curso ?? item.grupo ?? item.seccion ?? '6°1');
        const grade = normalizeGradeName(rawGrade);

        const fName = String(
          item.firstName ?? item.nombres ?? item.nombre ?? item.primerNombre ?? item.primer_nombre ?? 'ESTUDIANTE'
        ).toUpperCase().trim();

        const lName = String(
          item.lastName ?? item.apellidos ?? item.apellido ?? item.primerApellido ?? item.primer_apellido ?? ''
        ).toUpperCase().trim();

        const isValidDoc = /^\d{6,12}$/.test(doc);
        const isValidGr = isValidGrade(grade);
        const isFullyValid迁移 = isValidDoc && isValidGr;

        return {
          id: `draft_${Date.now()}_${idx}`,
          fileName,
          documentType: (item.documentType || detectDocumentType(item.tipoDoc || item.tipoDocumento || '', doc)) as DocumentType,
          documentId: doc,
          firstName: fName,
          lastName: lName,
          grade,
          photoUrl: item.photoUrl || item.foto || item.photo,
          confidence: isFullyValid迁移 ? 0.98 : 0.7,
          status: isFullyValid迁移 ? 'valid' : 'warning',
          errorMessage: !isValidDoc ? 'Documento debe tener entre 6 y 12 dígitos' : (!isValidGr ? `Grado "${grade}" inválido` : undefined)
        };
      });
    } catch (e: any) {
      console.warn('Error parsing JSON students:', e);
    }
  }

  // 3. Imágenes de Matrícula o Foto Carné (JPG, PNG, WEBP)
  if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExt)) {
    const photoDataUrl = await compressImageFile(file);
    // Intentar inferir datos a partir del nombre del archivo si viene estructurado
    // Ej: "1025883921_Gomez_Restrepo_Carlos_10-4.jpg" o "TI 1025883921 Carlos Gomez 6-5.png"
    const parsedFromName = parseDataFromFileName(fileName, photoDataUrl);
    return [parsedFromName];
  }

  // 4. Documentos PDF (Extraer texto de cabeceras comunes o generar borrador)
  if (fileExt === 'pdf') {
    // Si es PDF, se procesa el nombre del archivo o metadatos de ficha
    const parsed = parseDataFromFileName(fileName);
    parsed.errorMessage = 'Ficha de matrícula PDF cargada. Verifique y ajuste los campos extraídos.';
    return [parsed];
  }

  // Fallback general
  const fallback = parseDataFromFileName(fileName);
  return [fallback];
}

/**
 * Lee un archivo como DataURL (para fotos de carné)
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Parsea el nombre del archivo buscando patrones comunes de secretaría:
 * Ejemplos:
 * - "TI 1025883921 Gomez Carlos 10-4.jpg"
 * - "1048829102-CAMILO_ANDRES_PEREZ-6-5.pdf"
 * - "6°4_1038291022_MARTINEZ_SOFIA.png"
 */
export function parseDataFromFileName(fileName: string, photoUrl?: string): ExtractedStudentDraft {
  const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[_|-]/g, ' ');
  const tokens = cleanName.split(/\s+/).filter(Boolean);

  // Buscar número de documento (cadena de 6 a 12 dígitos)
  const docMatch = cleanName.match(/\b\d{6,12}\b/);
  const documentId = docMatch ? docMatch[0] : `10${Math.floor(10000000 + Math.random() * 90000000)}`;

  // Buscar grado (ej: 6-5, 10 4, 11°2, 604, 7-1)
  let grade = '6°1';
  const gradeMatch = cleanName.match(/\b(1[0-1]|[6-9])\s*[°\s-]\s*([0-9A-Za-z]+)\b/i) ||
                     cleanName.match(/\b(100[1-9]|110[1-9]|60[1-9]|70[1-9]|80[1-9]|90[1-9])\b/);
  if (gradeMatch) {
    grade = normalizeGradeName(gradeMatch[0]);
  }

  // Detectar tipo de documento
  const documentType = detectDocumentType(cleanName, documentId);

  // Extraer palabras que son nombres
  const nonNameWords = new Set([
    'TI', 'CC', 'RC', 'CE', 'PPT', 'PEP', 'NES', 'GRADO', 'CURSO', 'GRUPO', 'FOTO', 'CARNE', 'MATRICULA', 'FICHA', 'DOC', 'ESTUDIANTE'
  ]);

  const nameParts = tokens.filter(t => {
    const upper = t.toUpperCase();
    return !nonNameWords.has(upper) && isNaN(Number(t)) && !t.includes('°') && t.length > 1;
  });

  let firstName = 'ESTUDIANTE';
  let lastName = 'SIN APELLIDO';

  if (nameParts.length >= 2) {
    if (nameParts.length === 2) {
      firstName = nameParts[1].toUpperCase();
      lastName = nameParts[0].toUpperCase();
    } else if (nameParts.length === 3) {
      firstName = nameParts[2].toUpperCase();
      lastName = `${nameParts[0]} ${nameParts[1]}`.toUpperCase();
    } else {
      // 4 o más palabras (ej: Gomez Restrepo Carlos Andres)
      lastName = `${nameParts[0]} ${nameParts[1]}`.toUpperCase();
      firstName = nameParts.slice(2).join(' ').toUpperCase();
    }
  } else if (nameParts.length === 1) {
    firstName = nameParts[0].toUpperCase();
    lastName = 'ESTUDIANTE';
  }

  return {
    id: `draft_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    fileName,
    documentType,
    documentId,
    firstName,
    lastName,
    grade,
    photoUrl,
    confidence: docMatch && nameParts.length >= 2 ? 0.9 : 0.6,
    status: docMatch ? 'valid' : 'warning'
  };
}

/**
 * Parsea contenido en formato texto plano o CSV estructurado
 */
export function parseTextOrCsvContent(content: string, fileName: string): ExtractedStudentDraft[] {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const results: ExtractedStudentDraft[] = [];

  // Verificar si la primera línea es un encabezado CSV
  const header = lines[0].toLowerCase();
  const isCsv = header.includes(',') || header.includes(';') || header.includes('\t');
  const separator = header.includes(';') ? ';' : (header.includes('\t') ? '\t' : ',');

  const startIndex = (header.includes('nombre') || header.includes('doc') || header.includes('identificacion') || header.includes('grado')) ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (isCsv) {
      const parts = line.split(separator).map(p => p.trim().replace(/^["']|["']$/g, ''));
      if (parts.length >= 3) {
        // Formatos típicos de SIMAT:
        // [TipoDoc, Documento, Apellidos, Nombres, Grado]
        // o [Documento, NombreCompleto, Grado]
        let doc = '';
        let docType: DocumentType = 'TI';
        let fName = '';
        let lName = '';
        let gr = '6°1';

        // Buscar qué columna tiene el documento numérico
        const docColIdx = parts.findIndex(p => /^\d{6,12}$/.test(p));
        if (docColIdx !== -1) {
          doc = parts[docColIdx];
          
          // Tipo doc suele estar antes
          if (docColIdx > 0 && ['TI', 'CC', 'RC', 'CE', 'PPT', 'PEP', 'NES'].includes(parts[docColIdx - 1].toUpperCase())) {
            docType = parts[docColIdx - 1].toUpperCase() as DocumentType;
          } else {
            docType = detectDocumentType('', doc);
          }

          // Grado suele estar al final
          const gradeCandidate = parts[parts.length - 1];
          gr = normalizeGradeName(gradeCandidate);

          // Nombres
          const nameCols = parts.filter((_, idx) => idx !== docColIdx && idx !== docColIdx - 1 && idx !== parts.length - 1);
          if (nameCols.length >= 2) {
            lName = nameCols[0].toUpperCase();
            fName = nameCols.slice(1).join(' ').toUpperCase();
          } else if (nameCols.length === 1) {
            const split = nameCols[0].split(/\s+/);
            if (split.length >= 2) {
              lName = split.slice(0, 2).join(' ').toUpperCase();
              fName = split.slice(2).join(' ').toUpperCase() || split[1].toUpperCase();
            } else {
              fName = nameCols[0].toUpperCase();
            }
          }
        } else {
          // Asignación secuencial
          doc = normalizeDocumentOrCode(parts[0]) || `1000${i}`;
          fName = parts[1] || 'ESTUDIANTE';
          lName = parts[2] || '';
          gr = normalizeGradeName(parts[3] || '6°1');
        }

        results.push({
          id: `draft_${Date.now()}_${i}`,
          fileName,
          documentType: docType,
          documentId: doc,
          firstName: fName || 'ESTUDIANTE',
          lastName: lName || '',
          grade: gr,
          confidence: 0.95,
          status: 'valid'
        });
      }
    } else {
      // Línea de texto libre
      const parsed = parseDataFromFileName(line);
      results.push(parsed);
    }
  }

  return results;
}
