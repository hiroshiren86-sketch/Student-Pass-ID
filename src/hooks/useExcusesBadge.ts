/**
 * ==============================================================================
 * HOOK: badge de excusas pendientes para Rectoría — Ronda 24 (petición propietario)
 * "cuando llegue una excusa o esté pendiente, que aparezca un punto rojo en la
 *  sección de excusas/justificaciones, para verlo cada vez que uno navega el menú".
 *
 * Diseño:
 *  - Sondea GET /api/excuses?status=PENDIENTE cada 30 s + visibilitychange
 *    (misma cadencia que el buzón — una sola verdad: el Worker).
 *  - Solo activo para rol ADMIN (Rectoría); otros roles → 0 sin red.
 *  - Fallos de red NO borran el conteo vigente (evita parpadeo engañoso); la vista
 *    del buzón ya muestra el aviso honesto de conexión.
 *  - refresh() force: se invoca al volver del buzón para que el punto muera rápido.
 * ==============================================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExcuseService } from '../services/excuseService';
import type { UserRole } from '../types/attendance';

const POLL_MS = 30_000;

export function useExcusesBadge(role: UserRole, activeTab?: string) {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (role !== 'ADMIN') { setPendingCount(0); setLoaded(true); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await ExcuseService.listFromWorker({ status: 'PENDIENTE' });
      if (res.ok) {
        setPendingCount(res.excuses.length);
        setLoaded(true);
      }
      // res.ok === false → se conserva el conteo anterior (ver nota de diseño)
    } catch {
      /* silencioso: el badge es cortesía, el buzón es la verdad */
    } finally {
      inFlight.current = false;
    }
  }, [role]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Al salir del buzón (o entrar), revalida de inmediato: el punto muere sin esperar 30 s
  useEffect(() => {
    if (activeTab) refresh();
  }, [activeTab, refresh]);

  return { pendingCount, loaded, refresh };
}
