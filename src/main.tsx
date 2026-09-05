import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import './index.css';

// Ronda 19 (hallazgo #7 del informe de testing): mensajes de validación nativa del
// navegador en ESPAÑOL para toda la app ("Please fill out this field." → español).
// 'invalid' NO burbujea → se escucha en captura a nivel documento; cada edición del
// usuario limpia el mensaje previo para que el navegador reevalúe el estado real.
// Un solo handler global cubre todos los formularios presentes y futuros.
const setSpanishValidationMessage = (target: EventTarget | null): void => {
  const el = target as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) | null;
  if (!el || !el.validity || typeof el.setCustomValidity !== 'function') return;
  const v = el.validity;
  const input = el as HTMLInputElement; // minLength/maxLength/min/max viven en input/textarea
  if (v.valueMissing) {
    el.setCustomValidity(el.type === 'email' ? 'Escribe un correo electrónico.' : 'Este campo es obligatorio.');
  } else if (v.typeMismatch) {
    el.setCustomValidity(el.type === 'email' ? 'Escribe un correo electrónico válido.' : 'El formato no es válido.');
  } else if (v.tooShort) {
    el.setCustomValidity(`Escribe al menos ${input.minLength} caracteres.`);
  } else if (v.tooLong) {
    el.setCustomValidity(`Escribe como máximo ${input.maxLength} caracteres.`);
  } else if (v.rangeUnderflow) {
    el.setCustomValidity(`El valor mínimo es ${input.min}.`);
  } else if (v.rangeOverflow) {
    el.setCustomValidity(`El valor máximo es ${input.max}.`);
  } else if (v.patternMismatch) {
    el.setCustomValidity('El formato no coincide con lo esperado.');
  } else if (v.stepMismatch) {
    el.setCustomValidity('El valor no corresponde a los incrementos permitidos.');
  } else {
    el.setCustomValidity('');
  }
};
const clearValidationMessage = (e: Event): void => {
  const el = e.target as (HTMLInputElement & { setCustomValidity?: (msg: string) => void }) | null;
  if (el && typeof el.setCustomValidity === 'function') el.setCustomValidity('');
};
document.addEventListener('invalid', (e) => setSpanishValidationMessage(e.target), true);
document.addEventListener('input', clearValidationMessage, true);
document.addEventListener('change', clearValidationMessage, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// PWA — Ronda 32: el service worker de alcance raíz (/push-sw.js) lleva el app-shell
// offline Y las notificaciones push (un único SW por alcance para no romper las
// suscripciones VAPID). Se registra SIEMPRE al arranque — no solo cuando el usuario
// activa notificaciones — para que el modo instalado/offline esté disponible desde
// la primera visita. pushService reutiliza este mismo registro (idempotente).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/push-sw.js').catch((err) => {
      console.warn('[PWA] No se pudo registrar el service worker:', err);
    });
  });
}

