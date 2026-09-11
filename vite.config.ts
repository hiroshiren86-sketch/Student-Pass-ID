import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    // Ronda 58 (F-21): CODE SPLITTING. Antes: UN solo chunk de 2.64 MB (771 KB gzip)
    // — ítem abierto desde Ronda 19. Con manualChunks el navegador carga primero el
    // vendor crítico (react) y difiere pdf/qrcode/charts; un visitante de portería
    // no paga el PDF generator para escanear. Los nombres son estables para que el
    // service worker cache-first no invalide todo en cada deploy.
    build: {
      rollupOptions: {
        output: {
          // Forma funcional: 'firebase' es un meta-paquete (firebase/app, …) sin
          // entry raíz, así que el mapeo se hace por ruta de módulo.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('firebase') || id.includes('@firebase')) return 'vendor-firebase';
            if (id.includes('pdf-lib')) return 'vendor-pdf';
            if (id.includes('jsqr') || id.includes('qrcode') || id.includes('jsbarcode')) return 'vendor-qr';
            if (id.includes('recharts') || /node_modules\/d3-|node_modules\/victory-/.test(id)) return 'vendor-charts';
            if (id.includes('lucide-react')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
