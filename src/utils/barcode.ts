import JsBarcode from 'jsbarcode';

/**
 * Genera un código de barras 1D estándar Code 128 en formato DataURL (PNG)
 * Compatible con pistolas lectoras USB láser y CCD.
 */
export function generateBarcodeDataUrl(code: string, options?: { height?: number; displayValue?: boolean }): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, {
      format: 'CODE128',
      width: 1.6,
      height: options?.height || 28,
      displayValue: options?.displayValue ?? true,
      font: 'monospace',
      fontSize: 9,
      fontOptions: 'bold',
      textMargin: 1,
      margin: 4,
      background: '#ffffff',
      lineColor: '#0f172a'
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Barcode generation warning for code:', code, err);
    // Fallback: draw placeholder barcode lines
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = 160;
      canvas.height = 36;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 160, 36);
      ctx.fillStyle = '#0f172a';
      for (let i = 8; i < 152; i += 4) {
        ctx.fillRect(i, 4, 2, 22);
      }
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(code, 80, 33);
      return canvas.toDataURL('image/png');
    }
    return '';
  }
}
