const STORAGE_KEY = 'preferencias';
const API_URL = 'http://localhost:3001';

export interface Preferencias {
  idioma: string; // formato TMDB, ej "es-ES"
  region: string; // formato TMDB, ej "ES"
}

const DEFAULT_PREFERENCIAS: Preferencias = { idioma: 'es-ES', region: 'ES' };

export const IDIOMAS_DISPONIBLES = [
  { codigo: 'es-ES', nombre: 'Español' },
  { codigo: 'en-US', nombre: 'English' },
  { codigo: 'fr-FR', nombre: 'Français' },
  { codigo: 'de-DE', nombre: 'Deutsch' },
  { codigo: 'it-IT', nombre: 'Italiano' },
  { codigo: 'pt-PT', nombre: 'Português' },
  { codigo: 'ja-JP', nombre: '日本語' },
];

export const REGIONES_DISPONIBLES = [
  { codigo: 'ES', nombre: 'España' },
  { codigo: 'US', nombre: 'Estados Unidos' },
  { codigo: 'MX', nombre: 'México' },
  { codigo: 'AR', nombre: 'Argentina' },
  { codigo: 'GB', nombre: 'Reino Unido' },
  { codigo: 'FR', nombre: 'Francia' },
  { codigo: 'DE', nombre: 'Alemania' },
  { codigo: 'JP', nombre: 'Japón' },
];

function leerPreferencias(): Preferencias {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCIAS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCIAS;
    const parsed = JSON.parse(raw);
    return {
      idioma: parsed.idioma || DEFAULT_PREFERENCIAS.idioma,
      region: parsed.region || DEFAULT_PREFERENCIAS.region,
    };
  } catch {
    return DEFAULT_PREFERENCIAS;
  }
}

export function getIdioma(): string {
  return leerPreferencias().idioma;
}

export function getRegion(): string {
  return leerPreferencias().region;
}

// Guarda en localStorage (para que funcione al instante, incluso sin login)
// y, si hay sesión, sincroniza también con el backend (User.idioma / User.region).
export async function setPreferences(nuevas: Partial<Preferencias>): Promise<void> {
  const combinadas = { ...leerPreferencias(), ...nuevas };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(combinadas));

  // También en cookies: localStorage no es accesible desde los server components
  // (como la ficha de película o el lobby), así que las páginas que hacen fetch
  // en el servidor leen el idioma/región de aquí.
  document.cookie = `idioma=${combinadas.idioma}; path=/; max-age=31536000`;
  document.cookie = `region=${combinadas.region}; path=/; max-age=31536000`;

  const token = localStorage.getItem('token');
  if (token) {
    try {
      await fetch(`${API_URL}/auth/me/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(nuevas),
      });
    } catch (error) {
      console.error('Error al sincronizar preferencias con el backend:', error);
    }
  }
}

// Añade ?language=&region= (o &language=&region= si ya hay query params)
// a cualquier URL de fetch al backend, para que herede idioma/región del usuario.
export function withLangRegion(url: string): string {
  const idioma = getIdioma();
  const region = getRegion();
  const separador = url.includes('?') ? '&' : '?';
  return `${url}${separador}language=${idioma}&region=${region}`;
}