// lib/ordenamiento.ts
// Definiciones compartidas de ordenación para Watched, Mi Watchlist y Played.
// Los "campo" son claves lógicas: quien llama decide a qué propiedad real del
// item corresponden (ver ordenarItems más abajo).

export type Direccion = 'ASC' | 'DESC';

export interface ValorOrden {
  campo: string;
  direccion: Direccion;
}

interface Subopcion {
  direccion: Direccion;
  etiqueta: string;
}

interface OpcionOrdenGrupo {
  tipo: 'grupo';
  campo: string;
  etiqueta: string;
  subopciones: [Subopcion, Subopcion];
}

interface OpcionOrdenSimple {
  tipo: 'simple';
  campo: string;
  etiqueta: string;
  direccion: Direccion; // una sola dirección posible (ej. Shuffle)
}

export type OpcionOrden = OpcionOrdenGrupo | OpcionOrdenSimple;

// ---------------------------------------------------------------------------
// Películas / series / books — usado en Watched
// ---------------------------------------------------------------------------
export const OPCIONES_ORDEN_WATCHED: OpcionOrden[] = [
  { tipo: 'simple', campo: 'nombre', etiqueta: 'Film Name', direccion: 'ASC' },
  { tipo: 'simple', campo: 'popularidad', etiqueta: 'Film Popularity', direccion: 'DESC' },
  { tipo: 'simple', campo: 'aleatorio', etiqueta: 'Shuffle', direccion: 'ASC' },
  {
    tipo: 'grupo',
    campo: 'fechaAgregado',
    etiqueta: 'When Added',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Newest First' },
      { direccion: 'ASC', etiqueta: 'Earliest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'fechaEstreno',
    etiqueta: 'Release Date',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Newest First' },
      { direccion: 'ASC', etiqueta: 'Earliest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'notaMedia',
    etiqueta: 'Average Rating',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Highest First' },
      { direccion: 'ASC', etiqueta: 'Lowest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'miNota',
    etiqueta: 'Your Rating',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Highest First' },
      { direccion: 'ASC', etiqueta: 'Lowest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'duracion',
    etiqueta: 'Film Length',
    subopciones: [
      { direccion: 'ASC', etiqueta: 'Shortest First' },
      { direccion: 'DESC', etiqueta: 'Longest First' },
    ],
  },
];

// Para Mi Watchlist: igual que Watched pero sin "Your Rating" (todavía no la has visto)
export const OPCIONES_ORDEN_WATCHLIST: OpcionOrden[] = OPCIONES_ORDEN_WATCHED.filter(
  (o) => o.campo !== 'miNota'
);

// ---------------------------------------------------------------------------
// Juegos — usado en Played
// ---------------------------------------------------------------------------
export const OPCIONES_ORDEN_JUEGOS: OpcionOrden[] = [
  {
    tipo: 'grupo',
    campo: 'fechaAgregado',
    etiqueta: 'When Added',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Newest First' },
      { direccion: 'ASC', etiqueta: 'Earliest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'ultimaJugada',
    etiqueta: 'Last Played',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Most Recent First' },
      { direccion: 'ASC', etiqueta: 'Oldest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'tiempoJugado',
    etiqueta: 'Time Played',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Most First' },
      { direccion: 'ASC', etiqueta: 'Least First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'miNota',
    etiqueta: 'User Rating',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Highest First' },
      { direccion: 'ASC', etiqueta: 'Lowest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'notaJuego',
    etiqueta: 'Game Rating',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Highest First' },
      { direccion: 'ASC', etiqueta: 'Lowest First' },
    ],
  },
  { tipo: 'simple', campo: 'nombre', etiqueta: 'Game Title', direccion: 'ASC' },
  {
    tipo: 'grupo',
    campo: 'popularidad',
    etiqueta: 'Popularity',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Most Popular First' },
      { direccion: 'ASC', etiqueta: 'Least Popular First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'tendencia',
    etiqueta: 'Trending',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Most Trending First' },
      { direccion: 'ASC', etiqueta: 'Least Trending First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'fechaLanzamiento',
    etiqueta: 'Release Date',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Newest First' },
      { direccion: 'ASC', etiqueta: 'Earliest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'tiempoMedioJuego',
    etiqueta: 'Avg Play Time',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Longest First' },
      { direccion: 'ASC', etiqueta: 'Shortest First' },
    ],
  },
  {
    tipo: 'grupo',
    campo: 'tiempoMedioCompletar',
    etiqueta: 'Avg Finish Time',
    subopciones: [
      { direccion: 'DESC', etiqueta: 'Longest First' },
      { direccion: 'ASC', etiqueta: 'Shortest First' },
    ],
  },
  { tipo: 'simple', campo: 'aleatorio', etiqueta: 'Random', direccion: 'ASC' },
];

// ---------------------------------------------------------------------------
// Subconjuntos que funcionan HOY con lo que ya devuelve GET /media/watched
// ({ id, titulo, anio, tipo, rating, liked, portada }). El resto de opciones
// de arriba (When Added, Average Rating, Film Length / Last Played, Time
// Played, Game Rating, Popularity, Trending, Avg Play/Finish Time) necesita
// que el backend añada esos campos a la respuesta antes de poder activarlas:
//   - fechaAgregado -> createdAt del WatchLog/GameLog
//   - notaMedia / notaJuego -> nota media de Media (TMDB/IGDB)
//   - duracion -> runtime de Media (TMDB)
//   - popularidad / tendencia -> popularity/trending de TMDB o IGDB
//   - ultimaJugada / tiempoJugado -> del GameLog
//   - tiempoMedioJuego / tiempoMedioCompletar -> de IGDB (time_to_beat)
export const OPCIONES_ORDEN_WATCHED_DISPONIBLE: OpcionOrden[] = OPCIONES_ORDEN_WATCHED.filter((o) =>
  ['nombre', 'fechaEstreno', 'miNota', 'aleatorio'].includes(o.campo)
);

export const OPCIONES_ORDEN_JUEGOS_DISPONIBLE: OpcionOrden[] = OPCIONES_ORDEN_JUEGOS.filter((o) =>
  ['nombre', 'fechaLanzamiento', 'miNota', 'aleatorio'].includes(o.campo)
);

// Watchlist: GET /media/watchlist devuelve { id, titulo, anio, portada } sin
// rating (todavía no lo has visto) y sin campo de fecha explícito, aunque el
// backend ya lo entrega pre-ordenado "primero añadido → último añadido". Por
// eso "fechaAgregado" aquí se resuelve con la posición en el array (ver
// selector en la página), no con un campo real del item.
export const OPCIONES_ORDEN_WATCHLIST_DISPONIBLE: OpcionOrden[] = OPCIONES_ORDEN_WATCHLIST.filter((o) =>
  ['nombre', 'fechaEstreno', 'fechaAgregado', 'aleatorio'].includes(o.campo)
);

// ---------------------------------------------------------------------------
// Ordenación genérica
// ---------------------------------------------------------------------------
// `selectores` mapea cada "campo" lógico a una función que extrae el valor
// comparable de un item real. Esto es lo que habrá que rellenar con los
// nombres de propiedad reales de Watched/Watchlist/Played (ver nota al pie).
export type Selectores<T> = Record<string, (item: T) => string | number | Date | null | undefined>;

export function ordenarItems<T>(
  items: T[],
  valor: ValorOrden,
  selectores: Selectores<T>
): T[] {
  if (valor.campo === 'aleatorio') {
    const copia = [...items];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  }

  const selector = selectores[valor.campo];
  if (!selector) return items; // campo sin selector definido: no reordena

  const factor = valor.direccion === 'ASC' ? 1 : -1;

  return [...items].sort((a, b) => {
    const va = selector(a);
    const vb = selector(b);

    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulos al final, siempre
    if (vb == null) return -1;

    if (va instanceof Date || vb instanceof Date) {
      return (new Date(va as any).getTime() - new Date(vb as any).getTime()) * factor;
    }
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * factor;
    }
    return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * factor;
  });
}