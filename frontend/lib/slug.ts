export interface MediaParaSlug {
  id: number;
  tipo?: string | null;
  tituloOriginal?: string | null;
  original_title?: string | null;
  original_name?: string | null;
  titulo?: string | null;
  title?: string | null;
  name?: string | null;
  anio?: number | string | null;
  release_date?: string | null;
  first_air_date?: string | null;
}

function limpiarParaSlug(texto: string | undefined | null): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function obtenerTituloOriginal(media: MediaParaSlug): string {
  return (
    media.tituloOriginal ||
    media.original_title ||
    media.original_name ||
    media.titulo ||
    media.title ||
    media.name ||
    'sin-titulo'
  );
}

// Título alternativo (localizado, normalmente en inglés/español) para
// cuando el original no sirve de nada en un slug — típicamente porque está
// en japonés/coreano/chino y no le queda ningún carácter tras limpiarlo.
function obtenerTituloAlternativo(media: MediaParaSlug): string {
  return media.titulo || media.title || media.name || 'sin-titulo';
}

function obtenerAnio(media: MediaParaSlug): number | string | null {
  if (media.anio) return media.anio;
  if (media.release_date) return media.release_date.split('-')[0];
  if (media.first_air_date) return media.first_air_date.split('-')[0];
  return null;
}

export function generarSlug(media: MediaParaSlug): string {
  let textoLimpio = limpiarParaSlug(obtenerTituloOriginal(media));
  // El original puede estar en un alfabeto que la limpieza deja en blanco
  // (japonés, coreano, chino...) — en ese caso usamos el título localizado
  // (normalmente en inglés) en su lugar, y solo si ESE también queda vacío
  // caemos al "sin-titulo" de siempre.
  if (!textoLimpio) {
    textoLimpio = limpiarParaSlug(obtenerTituloAlternativo(media)) || 'sin-titulo';
  }
  const anio = obtenerAnio(media);

  const partes = [textoLimpio];
  if (anio) partes.push(String(anio));
  partes.push(String(media.id));

  return partes.join('-');
}

export function extraerIdDeSlug(slug: string): number | null {
  const partes = slug.split('-');
  const ultimo = partes[partes.length - 1];
  const id = parseInt(ultimo, 10);
  return Number.isNaN(id) ? null : id;
}

export function urlFicha(media: MediaParaSlug): string {
  const base = media.tipo === 'VIDEOJUEGO' ? '/game' : media.tipo === 'SERIE' ? '/series' : '/movie';
  return `${base}/${generarSlug(media)}`;
}

// --- ESTUDIOS Y PERSONAS: no tienen "tipo"/año como Media, solo nombre + id.
// Mismo criterio de limpieza que generarSlug, pero más simple: nombre-en-inglés + id al final.
function generarSlugSimple(nombre: string | undefined | null, id: number): string {
  const limpio = limpiarParaSlug(nombre) || 'sin-nombre';
  return [limpio, String(id)].join('-');
}

export function urlEstudio(id: number, nombre?: string | null): string {
  return `/studio/${generarSlugSimple(nombre, id)}`;
}

export function urlPersona(id: number, nombre?: string | null): string {
  return `/person/${generarSlugSimple(nombre, id)}`;
}