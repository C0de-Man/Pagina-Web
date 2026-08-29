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
  return (texto || 'sin-titulo')
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

function obtenerAnio(media: MediaParaSlug): number | string | null {
  if (media.anio) return media.anio;
  if (media.release_date) return media.release_date.split('-')[0];
  if (media.first_air_date) return media.first_air_date.split('-')[0];
  return null;
}

export function generarSlug(media: MediaParaSlug): string {
  const textoLimpio = limpiarParaSlug(obtenerTituloOriginal(media));
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