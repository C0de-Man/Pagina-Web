// lib/fecha.ts

// TMDB da release_date como "YYYY-MM-DD" (fecha sin hora). Parseamos a mano
// en vez de `new Date("YYYY-MM-DD")` porque ese constructor interpreta la
// cadena como UTC medianoche, y en negativo respecto a UTC eso puede mostrar
// el día anterior — con year/month/day explícitos se construye en hora local.
export function formatFechaEstrenoTmdb(fechaISO: string | null | undefined, idioma: string = 'es-ES') {
  if (!fechaISO) return null;
  const [y, m, d] = fechaISO.split('-').map(Number);
  if (!y || !m || !d) return null;
  const fecha = new Date(y, m - 1, d);
  return fecha.toLocaleDateString(idioma, { day: '2-digit', month: 'long', year: 'numeric' });
}

// IGDB da first_release_date como timestamp Unix. El backend ya lo devuelve
// convertido a milisegundos (fechaLanzamiento), así que aquí solo se formatea.
export function formatFechaLanzamientoIgdb(timestampMs: number | null | undefined, idioma: string = 'es-ES') {
  if (!timestampMs) return null;
  return new Date(timestampMs).toLocaleDateString(idioma, { day: '2-digit', month: 'long', year: 'numeric' });
}