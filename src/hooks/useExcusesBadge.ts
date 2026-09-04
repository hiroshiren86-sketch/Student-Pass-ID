/**
 * ==============================================================================
 * HOOK: badge de excusas pendientes para Rectoría — Ronda 24 (petición propietario)
 * "cuando llegue una excusa o esté pendiente, que aparezca un punto rojo en la
 *  sección de excusas/justificaciones, para verlo cada vez que uno navega el menú".
 *
 * Ronda 25 (petición propietario): campanita — "el punto sí aparece y se
 * actualiza… pero no hace ningún sonido; lo mejor sería que sonara algo, una
 * campanita como un Teams". Al detectar que el conteo SUBE con la app abierta
 * (poll de 30 s o al volver a primer plano) suena SoundService.playExcuseChime:
 * doble "din-din" suave, NADA de popups ni alerts. Reglas:
 *  - La carga inicial NUNCA suena (abrir la app con excusas ya pendientes es
 *    trabajo visible del punto rojo, no una novedad que interrumpa).
 *  - Si la preferencia está silenciada (ExcuseChimePref) no suena; el punto rojo
 *    sigue mostrando el número correspondiente.
 *  - Solo rol ADMIN (Rectoría) — el portal del estudiante tiene su propio aviso
 *    de veredicto en PortalExcusesSection.
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
import { SoundService, ExcuseChimePref } from '../utils/sound';
import type { UserRole } from '../types/attendance';

const POLL_MS = 30_000;

export function useExcusesBadge(role: UserRole, activeTab?: string) {
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  const inFlight = useRef(false);
  // Ronda 25: memoria del conteo anterior para detectar "llegó una excusa nueva"
  const prevCount = useRef<number | null>(null);
  const everLoaded = useRef(false);

  const refresh = useCallback(async () => {
    if (role !== 'ADMIN') { setPendingCount(0); setLoaded(true); prevCount.current = null; return; }
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await ExcuseService.listFromWorker({ status: 'PENDIENTE' });
      if (res.ok) {
        const next = res.excuses.length;
        const prev = prevCount.current;
        setPendingCount(next);
        setLoaded(true);
        prevCount.current = next;
        // Campanita SOLO si el conteo sube con la app ya cargada (llegó algo
        // nuevo). Jamás en la primera carga ni cuando baja (se revisó).
        if (everLoaded.current && prev !== null && next > prev && ExcuseChimePref.isEnabled()) {
          SoundService.playExcuseChime();
        }
        everLoaded.current = true;
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
