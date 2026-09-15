/**
 * R69 — Montaje de la app completa en jsdom, igual que `src/main.tsx`
 * (ThemeProvider + App). Sin `StrictMode`: en desarrollo re-ejecuta los efectos dos
 * veces y duplicaría suscripciones/pulls, falseando los conteos de las pruebas.
 */
import type React from 'react';

export async function mountApp(host: HTMLElement): Promise<{ root: any; React: any }> {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { ThemeProvider } = await import('../../src/context/ThemeContext');
  const App = (await import('../../src/App')).default;
  const root = createRoot(host);
  await React.act(async () => {
    root.render(React.createElement(ThemeProvider, null, React.createElement(App)));
  });
  await React.act(async () => { await new Promise(r => setTimeout(r, 50)); });
  return { root, React };
}

/** Cierra los modales de primer ingreso (guía de bienvenida / ajustes / onboarding). */
/**
 * Cierra los modales de primer ingreso (guía de bienvenida / ajustes / onboarding).
 *
 * La guía de bienvenida (FirstWelcomeTour) tiene animación de salida: `finish()` marca
 * `leaving` y llama `onClose` a los 180 ms, así que el overlay SIGUE en el DOM unos
 * instantes después del clic. Por eso se espera 260 ms por intento y se reintenta hasta
 * que no quede ningún `div.fixed.inset-0.z-50` (patrón `ensureNoOverlay` de los scripts
 * de QA históricos, aquí con la espera correcta).
 */
export async function dismissInitialModals(host: HTMLElement, React: any, maxRounds = 8): Promise<string[]> {
  const closed: string[] = [];
  const labels = ['Cerrar guía', '¡Empezar!', '¡Listo, empecemos!', 'Entendido', 'Ahora no', 'Cerrar'];
  const overlay = () => host.querySelector('div.fixed.inset-0.z-50') as HTMLElement | null;
  const fire = async (el: HTMLElement) => {
    await React.act(async () => {
      el.dispatchEvent(new (globalThis as any).window.MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 260)); // espera la animación de salida
    });
  };

  for (let round = 0; round < maxRounds; round++) {
    const layer = overlay();
    if (!layer) break;
    let acted = false;
    for (const label of labels) {
      const btn = Array.from(layer.querySelectorAll('button'))
        .find(b => ((b.textContent || '').includes(label)) || (b.getAttribute('aria-label') || '') === label) as HTMLElement | undefined;
      if (btn) { await fire(btn); closed.push(label); acted = true; break; }
    }
    if (acted) continue;
    const x = layer.querySelector('#btn-close-settings') as HTMLElement | null;
    if (x) { await fire(x); closed.push('#btn-close-settings'); continue; }
    await React.act(async () => {
      (globalThis as any).window.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 260));
    });
    closed.push('Escape');
  }
  return closed;
}
