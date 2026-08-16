// Convierte "Zona Cero", 2026, 6  →  "zona-cero-2026-6"
export function generarSlug(titulo: string | null | undefined, anio: number | string | null | undefined, id: number): string {
  const base = (titulo || 'titulo')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos (á, é, í, ó, ú, ñ conserva la ñ como n)
    .replace(/[^a-z0-9]+/g, '-')     // todo lo que no sea letra/número, a guión
    .replace(/^-+|-+$/g, '');        // quita guiones sobrantes al principio/final

  const anioParte = anio ? `-${anio}` : '';
  return `${base}${anioParte}-${id}`;
}

// De "zona-cero-2026-6" saca el 6 (el id siempre es el último trozo)
export function extraerIdDeSlug(slug: string): number {
  const partes = slug.split('-');
  const ultima = partes[partes.length - 1];
  return parseInt(ultima, 10);
}