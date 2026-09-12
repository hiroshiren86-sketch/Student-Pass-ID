import JsBarcode from 'jsbarcode';

/**
 * Genera un código de barras 1D estándar Code 128 en formato DataURL (PNG)
 * Compatible con pistolas lectoras USB láser y CCD.
 *
 * Ronda 60-g (nitidez visual): el canvas se renderiza a 3x escala (devicePixelRatio
 * simulado) y luego se incrusta en el PDF al tamaño físico objetivo. Antes el canvas
 * se generaba a 1x y al escalarlo dentro del PDF lucia pixelado/borroso en lectores
 * láser reales. Ahora el Code128 se dibuja con barras nítidas a ~3x densidad.
 */
export function generateBarcodeDataUrl(code: string, options?: { height?: number; displayValue?: boolean; scale?: number }): string {
  if (typeof document === 'undefined') return '';

  // Ronda 60-g: factor de escala 3x por defecto para nitidez en PDF/impresión.
  const scale = options?.scale || 3;
  const baseHeight = options?.height || 28;

  // Canvas temporal de alta resolución: JsBarcode dibuja en coordenadas lógicas,
  // pero el bitmap resultante se multiplica por `scale` para mayor densidad.
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, code, {
      format: 'CODE128',
      width: 1.6 * scale,
      height: baseHeight * scale,
      displayValue: options?.displayValue ?? true,
      font: 'monospace',
      fontSize: 9 * scale,
      fontOptions: 'bold',
      textMargin: 1 * scale,
      margin: 4 * scale,
      background: '#ffffff',
      lineColor: '#0f172a'
    });
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Barcode generation warning for code:', code, err);
    // Fallback: draw placeholder barcode lines (también a alta resolución)
    const ctx = canvas.getContext('2d');
    if (ctx) {
      canvas.width = 160 * scale;
      canvas.height = 36 * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f172a';
      for (let i = 8 * scale; i < 152 * scale; i += 4 * scale) {
        ctx.fillRect(i, 4 * scale, 2 * scale, 22 * scale);
      }
      ctx.font = `bold ${9 * scale}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(code, 80 * scale, 33 * scale);
      return canvas.toDataURL('image/png');
    }
    return '';
  }
}
