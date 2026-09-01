import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Logos oficiales de proveedores de IA, inline con fill="currentColor"
 * (se adaptan al modo claro/oscuro y a los colores de la interfaz).
 *
 * Fuente de los vectores (verificado 01/09/2026):
 * - Google Gemini / OpenAI / Mistral AI / OpenRouter: Simple Icons (licencia CC0)
 * - Groq: símbolo circular "G" del logo oficial (Wikimedia Commons, wordmark groq_logo.svg)
 *
 * Decisión estética aprobada por el propietario (01/09/2026): el logo se muestra a
 * todo color solo cuando hay proveedor con API key configurada; en gris tenue si no.
 */

type BrandMark = {
  title: string;
  activeClass: string;
  viewBox: string;
  body: React.ReactNode;
};

const BRAND_MARKS: Record<string, BrandMark> = {
  groq: {
    title: 'Groq',
    activeClass: 'text-[#F55036]',
    viewBox: '67.079 34.137 35.54 35.54',
    body: (
      <path d="M84.848,34.137c-9.798,0-17.769,7.971-17.769,17.77s7.971,17.769,17.769,17.769s17.77-7.971,17.77-17.769 S94.645,34.137,84.848,34.137z M84.848,63.013c-6.124,0-11.106-4.983-11.106-11.106s4.982-11.106,11.106-11.106 c6.124,0,11.106,4.982,11.106,11.106S90.973,63.013,84.848,63.013z" />
    )
  },
  gemini: {
    title: 'Google Gemini',
    activeClass: 'text-[#8E75B2]',
    viewBox: '0 0 24 24',
    body: (
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    )
  },
  openai: {
    title: 'OpenAI',
    activeClass: 'text-slate-900 dark:text-white',
    viewBox: '0 0 24 24',
    body: (
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    )
  },
  mistral: {
    title: 'Mistral AI',
    activeClass: 'text-[#FF7000]',
    viewBox: '0 0 24 24',
    body: (
      <path d="M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z" />
    )
  },
  openrouter: {
    title: 'OpenRouter',
    activeClass: 'text-[#6366F1]',
    viewBox: '0 0 24 24',
    body: (
      <path d="M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z" />
    )
  }
};

export type AiProviderMarkProps = {
  /** Proveedor activo: groq | gemini | openai | mistral | openrouter */
  provider?: string | null;
  /** true si hay proveedor con clave API configurada/validada (logo a color de marca) */
  active?: boolean;
  /** Clases de tamaño Tailwind, ej. "w-4 h-4" */
  className?: string;
};

export const AiProviderMark: React.FC<AiProviderMarkProps> = ({ provider, active = true, className = 'w-4 h-4' }) => {
  const key = (provider || '').toLowerCase();
  const brand = BRAND_MARKS[key];

  if (!brand) {
    return <Sparkles className={`${className} shrink-0 ${active ? 'text-indigo-500' : 'text-slate-400'}`} />;
  }

  return (
    <svg
      viewBox={brand.viewBox}
      role="img"
      aria-label={brand.title}
      className={`${className} shrink-0 ${active ? brand.activeClass : 'text-slate-400 dark:text-slate-600 opacity-60'}`}
      fill="currentColor"
    >
      <title>{brand.title}</title>
      {brand.body}
    </svg>
  );
};

export default AiProviderMark;
