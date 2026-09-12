'use client';
import { useState, useEffect } from 'react';

type Contador = {
  actual: number;
  total: number | null;
};

export default function ReadingProgress({ mediaId, tipo, className }: { mediaId: number; tipo?: string; className?: string }) {
  const [capitulo, setCapitulo] = useState<Contador | null>(null);
  const [volumen, setVolumen] = useState<Contador | null>(null);
  // Comic Vine no maneja volúmenes/capítulos como MAL — solo un total de
  // issues, así que para un cómic se oculta la fila "Volume" y se reetiqueta
  // "Chapter" como "Issue" (reutilizando el mismo campo progresoActual/
  // progresoTotal por debajo, sin necesidad de columnas nuevas en la BD).
  const [esComic, setEsComic] = useState(false);
  // Cuando el total lo gestiona una fuente automática (MAL/Comic Vine), el
  // "?" nunca se puede escribir a mano — se queda esperando a que esa
  // fuente lo rellene sola (típicamente al terminar la publicación). Solo
  // un libro sin ninguna fuente (Google Books) deja escribirlo.
  const [totalGestionadoPorFuente, setTotalGestionadoPorFuente] = useState<{ capitulo: boolean; volumen: boolean }>({ capitulo: false, volumen: false });
  const [editando, setEditando] = useState<'capitulo' | 'volumen' | null>(null);
  const [totalInput, setTotalInput] = useState('');
  const [editandoActual, setEditandoActual] = useState<'capitulo' | 'volumen' | null>(null);
  const [actualInput, setActualInput] = useState('');

  useEffect(() => {
    if (tipo !== 'LIBRO') return;
    const token = localStorage.getItem('token');
    if (!token) return;

    Promise.all([
      fetch(`http://localhost:3001/media/${mediaId}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((res) => res.json()),
      // Totales por defecto desde MAL (si este libro es un manga guardado
      // desde ahí).
      fetch(`http://localhost:3001/media/${mediaId}/manga-info`).then((res) => res.json()).catch(() => null),
      // Total por defecto desde Comic Vine (si este libro es un cómic
      // guardado desde ahí).
      fetch(`http://localhost:3001/media/${mediaId}/comic-info`).then((res) => res.json()).catch(() => null),
    ])
      .then(([status, mangaInfo, comicInfo]) => {
        // "estado" solo viene relleno si el libro tiene malMangaId/
        // comicVineId de verdad — presente incluso mientras el manga sigue
        // en publicación (Publishing) y su totalCapitulos aún es null. Se
        // usa como marca de "esto tiene una fuente automática", para saber
        // si el total lo debe dar siempre esa fuente (nunca a mano) o si,
        // al no tener ninguna fuente (ej. Google Books), sí se puede
        // escribir el total manualmente.
        const esMangaConFuente = !!mangaInfo?.estado;
        // "editorial" identifica que el libro TIENE fuente Comic Vine,
        // independientemente de si totalIssues está de momento oculto
        // (ongoing) o relleno (terminado) — así "esComicConFuente" no
        // depende del propio valor que estamos intentando decidir mostrar.
        const esComicConFuente = !!(comicInfo?.editorial || comicInfo?.estado);
        setEsComic(esComicConFuente && !esMangaConFuente);
        setTotalGestionadoPorFuente({ capitulo: esMangaConFuente || esComicConFuente, volumen: esMangaConFuente });
        setCapitulo({
          actual: status.progresoActual ?? 0,
          // El total de una fuente automática (MAL/Comic Vine) SIEMPRE
          // manda sobre lo que se hubiera guardado antes a mano en
          // progresoTotal — si Comic Vine dice que ahora mismo es null
          // (cómic en curso, número aún no fijo), no debe seguir mostrando
          // un total viejo guardado de una consulta anterior.
          total: esMangaConFuente
            ? (mangaInfo?.totalCapitulos ?? null)
            : esComicConFuente
              ? (comicInfo?.totalIssues ?? null)
              : (status.progresoTotal ?? null),
        });
        setVolumen({
          actual: status.progresoVolumenActual ?? 0,
          total: status.progresoVolumenTotal ?? mangaInfo?.totalVolumenes ?? null,
        });
      })
      .catch(() => {});
  }, [mediaId, tipo]);

  const guardar = async (campo: 'capitulo' | 'volumen', nuevoActual: number, nuevoTotal: number | null) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const anterior = campo === 'capitulo' ? capitulo : volumen;
    const setter = campo === 'capitulo' ? setCapitulo : setVolumen;
    setter({ actual: nuevoActual, total: nuevoTotal });

    const body = campo === 'capitulo'
      ? { progresoActual: nuevoActual, progresoTotal: nuevoTotal }
      : { progresoVolumenActual: nuevoActual, progresoVolumenTotal: nuevoTotal };

    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('fallo al guardar');
    } catch {
      setter(anterior);
    }
  };

  if (tipo !== 'LIBRO' || !capitulo || !volumen) return null;

  const confirmarTotal = (campo: 'capitulo' | 'volumen') => {
    const actual = campo === 'capitulo' ? capitulo : volumen;
    const n = parseInt(totalInput, 10);
    guardar(campo, actual.actual, Number.isNaN(n) || n <= 0 ? null : n);
    setEditando(null);
  };

  const confirmarActual = (campo: 'capitulo' | 'volumen') => {
    const contador = campo === 'capitulo' ? capitulo : volumen;
    if (!contador) return;
    const n = parseInt(actualInput, 10);
    let nuevo = Number.isNaN(n) || n < 0 ? 0 : n;
    if (contador.total !== null) nuevo = Math.min(nuevo, contador.total);
    guardar(campo, nuevo, contador.total);
    setEditandoActual(null);
  };

  const Fila = ({ campo, etiqueta, contador }: { campo: 'capitulo' | 'volumen'; etiqueta: string; contador: Contador }) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400 uppercase tracking-wide">{etiqueta}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => guardar(campo, Math.max(0, contador.actual - 1), contador.total)}
          disabled={contador.actual <= 0}
          className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
        >
          −
        </button>

        <div className="text-base font-extrabold text-white min-w-[56px] text-center">
          {editandoActual === campo ? (
            <input
              type="number"
              min={0}
              autoFocus
              value={actualInput}
              onChange={(e) => setActualInput(e.target.value)}
              onBlur={() => confirmarActual(campo)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarActual(campo)}
              className="w-10 bg-[#2c3440] border border-gray-600 rounded text-center text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          ) : (
            // Número actual: siempre editable a mano (escribir directamente
            // en vez de tener que pulsar +/- una a una para llegar, ej., al
            // issue 80).
            <button
              onClick={() => {
                setActualInput(String(contador.actual));
                setEditandoActual(campo);
              }}
              className="hover:text-blue-400 transition cursor-pointer"
            >
              {contador.actual}
            </button>
          )}
          <span className="text-gray-500"> / </span>
          {contador.total !== null ? (
            // Total ya conocido (viene de MAL/Comic Vine): solo texto, no
            // editable — no tiene sentido dejar tocar un dato que ya
            // sabemos con certeza de la fuente original.
            <span className="text-gray-400">{contador.total}</span>
          ) : totalGestionadoPorFuente[campo] ? (
            // Total desconocido TODAVÍA, pero gestionado por una fuente
            // automática (manga en publicación, cómic sin fecha de fin) —
            // no se deja escribir a mano: se queda en "?" hasta que esa
            // fuente lo rellene sola (típicamente al terminar la serie).
            <span className="text-gray-500">?</span>
          ) : editando === campo ? (
            <input
              type="number"
              min={1}
              autoFocus
              value={totalInput}
              onChange={(e) => setTotalInput(e.target.value)}
              onBlur={() => confirmarTotal(campo)}
              onKeyDown={(e) => e.key === 'Enter' && confirmarTotal(campo)}
              className="w-10 bg-[#2c3440] border border-gray-600 rounded text-center text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          ) : (
            // Total desconocido y SIN ninguna fuente automática (libro de
            // Google Books, que nunca da un total): se deja editable a
            // mano, como hasta ahora.
            <button
              onClick={() => {
                setTotalInput('');
                setEditando(campo);
              }}
              className="text-gray-400 hover:text-white transition cursor-pointer"
            >
              ?
            </button>
          )}
        </div>

        <button
          onClick={() => guardar(campo, contador.total !== null ? Math.min(contador.total, contador.actual + 1) : contador.actual + 1, contador.total)}
          disabled={contador.total !== null && contador.actual >= contador.total}
          className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
        >
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className={className ?? 'bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl mt-4'}>
      <h3 className="text-sm font-bold text-white mb-3">Reading progress</h3>
      <div className="space-y-2">
        <Fila campo="capitulo" etiqueta={esComic ? 'Issue' : 'Chapter'} contador={capitulo} />
        {!esComic && <Fila campo="volumen" etiqueta="Volume" contador={volumen} />}
      </div>
    </div>
  );
}