/**
 * Ronda 16 (auditoría integral): compresión de imágenes client-side.
 *
 * Modernizado según estándares 2025-2026 (MDN):
 * - `createImageBitmap(blob, { imageOrientation: 'from-image' })` normaliza la
 *   orientación EXIF (fotos de celular giradas) ANTES de dibujar en canvas.
 * - `OffscreenCanvas` cuando está disponible (no bloquea el hilo principal).
 * - Fallback a `new Image()` para navegadores sin createImageBitmap.
 *
 * Referencias: MDN createImageBitmap (imageOrientation), Web Almanac image compression.
 */

const SUPPORTS_CREATE_IMAGE_BITMAP = typeof createImageBitmap === 'function';
const SUPPORTS_OFFSCREEN_CANVAS = typeof OffscreenCanvas !== 'undefined';

async function bitmapToJpegDataUrl(
  bitmap: ImageBitmap | HTMLImageElement,
  maxWidth: number,
  maxHeight: number,
  quality: number
): Promise<string> {
  let width = 'width' in bitmap ? bitmap.width : 0;
  let height = 'height' in bitmap ? bitmap.height : 0;
  if (!width || !height) throw new Error('Imagen sin dimensiones legibles');

  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  if (SUPPORTS_OFFSCREEN_CANVAS) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return await blobToDataUrl(blob);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el blob comprimido'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Comprime un File/Blob de imagen a JPEG (por defecto 300×400, calidad 0.7 → ~20-60 KB),
 * corrigiendo la orientación EXIF. Lanza si la imagen no se puede decodificar.
 */
export async function compressImageFile(
  file: File | Blob,
  maxWidth = 300,
  maxHeight = 400,
  quality = 0.7
): Promise<string> {
  if (SUPPORTS_CREATE_IMAGE_BITMAP) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      return await bitmapToJpegDataUrl(bitmap, maxWidth, maxHeight, quality);
    } finally {
      bitmap.close?.();
    }
  }

  // Fallback legacy: <img> + FileReader (sin corrección EXIF)
  const dataUrl = await blobToDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Imagen inválida o corrupta'));
    el.src = dataUrl;
  });
  return bitmapToJpegDataUrl(img, maxWidth, maxHeight, quality);
}

/**
 * Ronda 16: compresión de fotos LEGACY ya almacenadas como dataURL (localStorage),
 * usada por la sincronización para sanear fotos gigantes heredadas en lugar de
 * descartarlas en silencio. Devuelve null si no se puede comprimir.
 */
export async function compressDataUrl(
  dataUrl: string,
  maxWidth = 300,
  maxHeight = 400,
  quality = 0.7
): Promise<string | null> {
  try {
    if (SUPPORTS_CREATE_IMAGE_BITMAP) {
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        return await bitmapToJpegDataUrl(bitmap, maxWidth, maxHeight, quality);
      } finally {
        bitmap.close?.();
      }
    }
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Imagen inválida'));
      el.src = dataUrl;
    });
    return await bitmapToJpegDataUrl(img, maxWidth, maxHeight, quality);
  } catch (e) {
    console.warn('[imageCompressor] No se pudo comprimir una foto heredada:', e);
    return null;
  }
}

/**
 * Umbral de tamaño (caracteres de dataURL) a partir del cual una foto se considera
 * no apta para viajar en el snapshot (~500 KB ≈ riesgo de límite 1 MB de un doc Firestore
 * y payload del Worker). Las fotos nuevas ya nacen comprimidas (~20-60 KB).
 */
export const PHOTO_DATAURL_SOFT_LIMIT = 500_000;
