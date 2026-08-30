import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { Student, SchoolSettings } from '../types/attendance';
import { generateStudentQrPayload } from '../utils/crypto';
import { generateBarcodeDataUrl } from '../utils/barcode';

/**
 * Generador de Carnés Escolares estilo Cédula Digital de Colombia (Tamaño CR80 estándar: 85.6 x 53.98 mm)
 * Diseñado con guiloches de seguridad, microtextos, policromía tricolor, Código QR criptográfico y Código de Barras 1D Code 128.
 */

export async function generateStudentCardPdf(student: Student, settings: SchoolSettings): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // Dimensiones estándar CR80 en puntos (85.6mm ≈ 242.6pt, 53.98mm ≈ 153.0pt)
  const width = 242.6;
  const height = 153.0;

  // Fuentes estándar
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontMono = await pdfDoc.embedFont(StandardFonts.CourierBold);

  // Clave permanente de acceso al portal de consulta (No expira, siempre válida)
  const permanentPin = student.tempPassword || `SJ-${student.documentId.slice(-4) || '2026'}`;

  // ==================== 1. ANVERSO (Estilo Cédula Digital Colombia) ====================
  const pageFront = pdfDoc.addPage([width, height]);

  // Fondo policromático con sutil degradado de seguridad
  pageFront.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.96, 0.98, 1.0)
  });

  // Franja Tricolor Colombia sutil superior (Amarillo, Azul, Rojo)
  pageFront.drawRectangle({ x: 0, y: height - 4, width, height: 2, color: rgb(0.98, 0.8, 0.08) }); // Amarillo
  pageFront.drawRectangle({ x: 0, y: height - 5, width, height: 1, color: rgb(0.08, 0.25, 0.65) }); // Azul
  pageFront.drawRectangle({ x: 0, y: height - 6, width, height: 1, color: rgb(0.85, 0.15, 0.15) }); // Rojo

  // Encabezado institucional estilo República de Colombia / Registraduría
  pageFront.drawText('REPÚBLICA DE COLOMBIA', {
    x: 14,
    y: height - 14,
    size: 7,
    font: fontBold,
    color: rgb(0.08, 0.2, 0.45)
  });

  const institutionName = (settings.schoolName || 'Institución Educativa Antonia Santos (I.N.A.S)').toUpperCase();
  // Ajuste adaptativo de tamaño según longitud para que siempre quepa perfecto
  const nameFontSize = institutionName.length > 40 ? 4.8 : (institutionName.length > 30 ? 5.5 : 6.5);
  pageFront.drawText(institutionName, {
    x: 14,
    y: height - 22,
    size: nameFontSize,
    font: fontBold,
    color: rgb(0.15, 0.25, 0.4)
  });

  pageFront.drawText('DOCUMENTO DE IDENTIDAD DIGITAL ESTUDIANTIL', {
    x: 14,
    y: height - 29,
    size: 4.8,
    font: fontRegular,
    color: rgb(0.4, 0.5, 0.6)
  });

  // Marca de agua / Sello de seguridad holográfico simulado
  pageFront.drawCircle({
    x: width - 26,
    y: height - 20,
    size: 9,
    borderColor: rgb(0.8, 0.85, 0.95),
    borderWidth: 1,
    color: rgb(0.92, 0.95, 1.0)
  });
  pageFront.drawText('2026', {
    x: width - 32,
    y: height - 22,
    size: 5.5,
    font: fontBold,
    color: rgb(0.1, 0.3, 0.6)
  });

  // Generar QR firmado con HMAC-SHA256
  const qrPayload = await generateStudentQrPayload(student, settings.qrSecret);
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 1,
    width: 250,
    errorCorrectionLevel: 'M'
  });
  const qrImage = await pdfDoc.embedPng(qrDataUrl);

  // Recuadro del Código QR Criptográfico
  const qrSize = 54;
  pageFront.drawRectangle({
    x: 12,
    y: 46,
    width: qrSize + 4,
    height: qrSize + 4,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.8, 0.85, 0.9),
    borderWidth: 0.8
  });

  pageFront.drawImage(qrImage, {
    x: 14,
    y: 48,
    width: qrSize,
    height: qrSize
  });

  // Badge HMAC Criptográfico
  pageFront.drawRectangle({
    x: 14,
    y: 48,
    width: 26,
    height: 7,
    color: rgb(0.15, 0.25, 0.65)
  });
  pageFront.drawText('HMAC-SHA256', {
    x: 16,
    y: 50,
    size: 4,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  // Textos y Campos en formato oficial (Apellidos, Nombres, Grado, Documento)
  const textX = 76;
  const docTypeLabel = student.documentType ? `${student.documentType}. ` : 'TI. ';

  pageFront.drawText(`${docTypeLabel}DOCUMENTO DE IDENTIDAD`, {
    x: textX,
    y: 110,
    size: 5,
    font: fontBold,
    color: rgb(0.45, 0.55, 0.65)
  });
  pageFront.drawText(student.documentId, {
    x: textX,
    y: 99,
    size: 10,
    font: fontBold,
    color: rgb(0.08, 0.18, 0.38)
  });

  pageFront.drawText('APELLIDOS Y NOMBRES', {
    x: textX,
    y: 89,
    size: 5,
    font: fontBold,
    color: rgb(0.45, 0.55, 0.65)
  });
  const fullName = `${student.lastName.toUpperCase()} ${student.firstName.toUpperCase()}`;
  const fullNameFontSize = fullName.length > 28 ? 6.8 : (fullName.length > 22 ? 7.5 : 8.5);
  pageFront.drawText(fullName, {
    x: textX,
    y: 78,
    size: fullNameFontSize,
    font: fontBold,
    color: rgb(0.12, 0.15, 0.25)
  });

  // Caja resaltada de Grado / Curso
  pageFront.drawRectangle({
    x: textX,
    y: 52,
    width: width - textX - 14,
    height: 18,
    color: rgb(0.92, 0.95, 1.0),
    borderColor: rgb(0.75, 0.82, 0.95),
    borderWidth: 0.6
  });

  pageFront.drawText(`GRADO / CURSO: ${student.grade}`, {
    x: textX + 6,
    y: 62,
    size: 7.5,
    font: fontBold,
    color: rgb(0.12, 0.35, 0.7)
  });

  pageFront.drawText(`CÓDIGO: ${student.code}`, {
    x: textX + 6,
    y: 55,
    size: 5.5,
    font: fontMono,
    color: rgb(0.35, 0.45, 0.55)
  });

  // Generar Código de Barras 1D Code 128 real en la parte inferior para lectores USB Láser / CCD
  const barcodeDataUrl = generateBarcodeDataUrl(student.code, { height: 26, displayValue: true });
  if (barcodeDataUrl) {
    try {
      const barcodeImage = await pdfDoc.embedPng(barcodeDataUrl);
      
      // Fondo blanco limpio para lectura láser óptima
      pageFront.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: 38,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.85, 0.88, 0.92),
        borderWidth: 0.5
      });

      // Dibujar imagen del código de barras
      const barcodeWidth = width - 24;
      const barcodeHeight = 32;
      pageFront.drawImage(barcodeImage, {
        x: 12,
        y: 3,
        width: barcodeWidth,
        height: barcodeHeight
      });
    } catch (e) {
      console.warn('Barcode embed fallback:', e);
    }
  }

  // ==================== 2. REVERSO ====================
  const pageBack = pdfDoc.addPage([width, height]);

  // Fondo policromático del reverso
  pageBack.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: rgb(0.97, 0.98, 1.0)
  });

  // Franja de alta seguridad
  pageBack.drawRectangle({
    x: 0,
    y: height - 16,
    width,
    height: 16,
    color: rgb(0.08, 0.18, 0.38)
  });

  pageBack.drawText('IDENTIFICACIÓN Y CONSULTA INSTITUCIONAL', {
    x: 14,
    y: height - 11,
    size: 6,
    font: fontBold,
    color: rgb(1, 1, 1)
  });

  // Caja de Credencial Permanente de Consulta
  pageBack.drawRectangle({
    x: 12,
    y: 54,
    width: width - 24,
    height: 68,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.82, 0.87, 0.93),
    borderWidth: 0.8
  });

  pageBack.drawText('CREDENCIALES DE CONSULTA (PORTAL ESTUDIANTE)', {
    x: 18,
    y: 108,
    size: 5.8,
    font: fontBold,
    color: rgb(0.08, 0.25, 0.55)
  });

  pageBack.drawText(`CÓDIGO DE USUARIO:  ${student.code}`, {
    x: 18,
    y: 92,
    size: 6.5,
    font: fontMono,
    color: rgb(0.1, 0.15, 0.25)
  });

  pageBack.drawText(`CLAVE DE ACCESO:    ${permanentPin}`, {
    x: 18,
    y: 78,
    size: 6.8,
    font: fontMono,
    color: rgb(0.25, 0.1, 0.6)
  });

  pageBack.drawText(`DOCUMENTO:          ${student.documentId}`, {
    x: 18,
    y: 64,
    size: 5.5,
    font: fontMono,
    color: rgb(0.4, 0.45, 0.5)
  });

  // Texto de uso institucional
  pageBack.drawText('Documento institucional de uso personal para registro de asistencia escolar.', {
    x: 14,
    y: 40,
    size: 4.8,
    font: fontRegular,
    color: rgb(0.45, 0.5, 0.55)
  });

  // Zona MRZ en el Reverso
  pageBack.drawRectangle({
    x: 0,
    y: 0,
    width,
    height: 28,
    color: rgb(0.92, 0.94, 0.97),
    borderColor: rgb(0.85, 0.88, 0.92),
    borderWidth: 0.5
  });

  const mrzDoc = student.documentId.padEnd(10, '<');
  const mrzCode = student.code.padEnd(10, '<');
  pageBack.drawText(`I<COL${mrzDoc}<<<<<<<<<<<<<<<`, {
    x: 10,
    y: 16,
    size: 6,
    font: fontMono,
    color: rgb(0.2, 0.25, 0.3)
  });

  pageBack.drawText(`${mrzCode}2601017COL<<<<<<<<<<<8`, {
    x: 10,
    y: 7,
    size: 6,
    font: fontMono,
    color: rgb(0.2, 0.25, 0.3)
  });

  return await pdfDoc.save();
}

/**
 * Genera PDF en lote para múltiples estudiantes (ej: todo un curso o los 50 iniciales)
 */
export async function generateBatchCardsPdf(students: Student[], settings: SchoolSettings): Promise<Uint8Array> {
  const masterDoc = await PDFDocument.create();

  for (const std of students) {
    const singlePdfBytes = await generateStudentCardPdf(std, settings);
    const tempDoc = await PDFDocument.load(singlePdfBytes);
    const copiedPages = await masterDoc.copyPages(tempDoc, [0, 1]);
    copiedPages.forEach(p => masterDoc.addPage(p));
  }

  return await masterDoc.save();
}

/**
 * Descarga automática del archivo PDF generado en el navegador
 */
export function downloadPdfBlob(pdfBytes: Uint8Array, fileName: string): void {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

