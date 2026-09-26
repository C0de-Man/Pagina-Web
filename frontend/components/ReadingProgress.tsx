'use client';
import { useState, useEffect } from 'react';

type Contador = {
  actual: number;
  total: number | null;
};

export default function ReadingProgress({ mediaId, tipo, className }: { mediaId: number; tipo?: string; className?: string }) {
  const [capitulo, setCapitulo] = useState<Contador | null>(null);
  const [volumen, setVolumen] = useState<Contador | null>(null);
  const [esComic, setEsComic] = useState(false);
  const [totalGestionadoPorFuente, setTotalGestionadoPorFuente] = useState<{ capitulo: boolean; volumen: boolean }>({ capitulo: false, volumen: false });
  const [editando, setEditando] = useState<'capitulo' | 'volumen' | null>(null);
  const [totalInput, setTotalInput] = useState('');
  const [editandoActual, setEditandoActual] = useState<'capitulo' | 'volumen' | null>(null);
  const [actualInput, setActualInput] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (tipo !== 'LIBRO') return;

    const handleProgressChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mediaId === mediaId) cargar();
    };
    window.addEventListener('mediaProgressChanged', handleProgressChanged);

    function cargar() {
      const token = localStorage.getItem('token');
      setIsLoggedIn(!!token);

      Promise.all([
        // Si hay token pedimos el progreso personal; si no, devolvemos un objeto vacío para no bloquear los datos públicos
        token
          ? fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/status`, {
              headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.json()).catch(() => ({}))
          : Promise.resolve({}),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/manga-info`).then((res) => res.json()).catch(() => null),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/comic-info`).then((res) => res.json()).catch(() => null),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/mangadex-info`).then((res) => res.json()).catch(() => null),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/anilist-info`).then((res) => res.json()).catch(() => null),
      ])
        .then(([status, mangaInfo, comicInfo, mangadexInfo, anilistInfo]) => {
          const esComicConFuente = !!(comicInfo?.editorial || comicInfo?.estado);
          const esMangaConFuente = !esComicConFuente && !!(mangaInfo?.estado || mangadexInfo?.estado || anilistInfo?.estado);
          setEsComic(esComicConFuente);
          setTotalGestionadoPorFuente({ capitulo: esMangaConFuente || esComicConFuente, volumen: esMangaConFuente });
          setCapitulo({
            actual: status.progresoActual ?? 0,
            total: esMangaConFuente
              ? (mangaInfo?.totalCapitulos ?? mangadexInfo?.totalCapitulos ?? anilistInfo?.totalCapitulos ?? null)
              : esComicConFuente
                ? (comicInfo?.totalIssues ?? null)
                : (status.progresoTotal ?? null),
          });
          setVolumen({
            actual: status.progresoVolumenActual ?? 0,
            total: status.progresoVolumenTotal ?? mangaInfo?.totalVolumenes ?? mangadexInfo?.totalVolumenes ?? anilistInfo?.totalVolumenes ?? null,
          });
        })
        .catch(() => { });
    }

    cargar();
    return () => window.removeEventListener('mediaProgressChanged', handleProgressChanged);
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
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('fallo al guardar');

      if (campo === 'capitulo' && nuevoTotal !== null && nuevoActual >= nuevoTotal) {
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/media/${mediaId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ watched: true, playStatus: null }),
        }).then(() => {
          window.dispatchEvent(
            new CustomEvent('mediaWatchedChanged', { detail: { mediaId, watched: true } })
          );
        }).catch(() => { });
      }
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
        {isLoggedIn && (
          <button
            onClick={() => guardar(campo, Math.max(0, contador.actual - 1), contador.total)}
            disabled={contador.actual <= 0}
            className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
          >
            −
          </button>
        )}

        <div className="text-base font-extrabold text-white min-w-[56px] text-center">
          {editandoActual === campo && isLoggedIn ? (
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
            <button
              onClick={() => {
                if (!isLoggedIn) return;
                setActualInput(String(contador.actual));
                setEditandoActual(campo);
              }}
              className={isLoggedIn ? "hover:text-blue-400 transition cursor-pointer" : "cursor-default text-gray-500"}
            >
              {isLoggedIn ? contador.actual : '-'}
            </button>
          )}
          <span className="text-gray-500"> / </span>
          {contador.total !== null ? (
            <span className="text-gray-400">{contador.total}</span>
          ) : totalGestionadoPorFuente[campo] ? (
            <span className="text-gray-500">?</span>
          ) : editando === campo && isLoggedIn ? (
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
            <button
              onClick={() => {
                if (!isLoggedIn) return;
                setTotalInput('');
                setEditando(campo);
              }}
              className={isLoggedIn ? "text-gray-400 hover:text-white transition cursor-pointer" : "text-gray-400 cursor-default"}
            >
              ?
            </button>
          )}
        </div>

        {isLoggedIn && (
          <button
            onClick={() => guardar(campo, contador.total !== null ? Math.min(contador.total, contador.actual + 1) : contador.actual + 1, contador.total)}
            disabled={contador.total !== null && contador.actual >= contador.total}
            className="w-6 h-6 rounded bg-[#2c3440] hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold text-sm transition cursor-pointer"
          >
            +
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className={className ?? 'bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl mt-4'}>
      <h3 className="text-sm font-bold text-white mb-3">{isLoggedIn ? 'Reading progress' : 'Chapters / Volumes'}</h3>
      <div className="space-y-2">
        <Fila campo="capitulo" etiqueta={esComic ? 'Issue' : 'Chapter'} contador={capitulo} />
        {!esComic && !(totalGestionadoPorFuente.volumen && volumen.total === null) && (
          <Fila campo="volumen" etiqueta="Volume" contador={volumen} />
        )}
      </div>
    </div>
  );
}