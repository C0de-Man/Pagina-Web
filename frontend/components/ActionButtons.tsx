'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ESTADOS_JUEGO = [
  { valor: 'PLAYING', color: '#ec4899', label: 'Playing', desc: 'Nothing specific' },
  { valor: 'COMPLETED', color: '#22c55e', label: 'Completed', desc: 'Beat your main objective' },
  { valor: 'RETIRED', color: '#3b82f6', label: 'Retired', desc: 'Finished with a game that lacks an ending' },
  { valor: 'SHELVED', color: '#f97316', label: 'Shelved', desc: 'Unfinished but may pick up again later' },
  { valor: 'ABANDONED', color: '#ef4444', label: 'Abandoned', desc: 'Unfinished and staying that way' },
];

// "WATCHED" aquí no es un playStatus real en la base de datos (solo
// WATCHING/PAUSED/ABANDONED lo son) — al elegirlo se guarda como
// watched=true con playStatus=null, ver guardarEstado() más abajo.
const ESTADOS_SERIE = [
  { valor: 'WATCHING', color: '#ec4899', label: 'Watching', desc: 'Currently watching' },
  { valor: 'WATCHED', color: '#22c55e', label: 'Watched', desc: "You've finished the show" },
  { valor: 'PAUSED', color: '#f97316', label: 'Paused', desc: 'On hold, may continue later' },
  { valor: 'ABANDONED', color: '#ef4444', label: 'Abandoned', desc: 'Stopped watching for good' },
];

// Mismo icono de mando que el botón principal, en miniatura para el botón
// "Mark as unplayed" del modal.
function IconoMando({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 10.5h1.5m-1.5 1.5h1.5m3-3v3m3-1.5h1.5m-1.5-1.5v3M6.75 6.75h10.5a3.75 3.75 0 013.712 3.213l.674 4.5A3.375 3.375 0 0117.663 18a3.363 3.363 0 01-2.68-1.333l-.645-.86a1.875 1.875 0 00-1.5-.75H10.66a1.875 1.875 0 00-1.5.75l-.645.86A3.363 3.363 0 015.837 18a3.375 3.375 0 01-3.473-3.537l.674-4.5A3.75 3.75 0 016.75 6.75z" />
    </svg>
  );
}

function IconoOjoCerrado({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

function IconoOjoAbierto({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

export default function ActionButtons({ mediaId, tipo }: { mediaId: number; tipo?: string }) {
  const [watched, setWatched] = useState(false);
  const [liked, setLiked] = useState(false);
  const [watchlist, setWatchlist] = useState(false);
  const [playStatus, setPlayStatus] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const router = useRouter();

  const esJuego = tipo === 'VIDEOJUEGO';
  const esSerie = tipo === 'SERIE';
  const tieneModalEstado = esJuego || esSerie;
  const estados = esJuego ? ESTADOS_JUEGO : ESTADOS_SERIE;

  const estadoActual = esJuego
    ? ESTADOS_JUEGO.find((e) => e.valor === playStatus) || null
    : esSerie
    ? ESTADOS_SERIE.find((e) => e.valor === playStatus) ||
      (watched ? ESTADOS_SERIE.find((e) => e.valor === 'WATCHED') : null) ||
      null
    : null;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setWatched(!!data.watched);
        setLiked(!!data.liked);
        setWatchlist(!!data.watchlist);
        setPlayStatus(data.playStatus || null);
      })
      .catch(() => {});
  }, [mediaId]);

  // Escucha el aviso de RatingWidget: si se puntúa esta película, el ojo se abre sin recargar
  useEffect(() => {
    const handleWatchedChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mediaId === mediaId) {
        setWatched(detail.watched);
      }
    };
    window.addEventListener('mediaWatchedChanged', handleWatchedChange);
    return () => window.removeEventListener('mediaWatchedChanged', handleWatchedChange);
  }, [mediaId]);

  const actualizarEstado = async (campo: 'watched' | 'liked' | 'watchlist', valorActual: boolean, setter: (v: boolean) => void) => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const nuevoValor = !valorActual;
    setter(nuevoValor); // actualización optimista

    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [campo]: nuevoValor }),
      });
      if (!res.ok) throw new Error('fallo al guardar');
    } catch {
      setter(valorActual); // si falla, revertimos
    }
  };

  // Unificado para juegos y series: en juegos "nuevoValor" es siempre un
  // playStatus real (o null para "Mark as unplayed"). En series, "WATCHED"
  // es un caso especial (no existe como playStatus en la base de datos —
  // se guarda como watched=true + playStatus=null), y null es "Mark as
  // unwatched" (watched=false + playStatus=null).
  const guardarEstado = async (nuevoValor: string | null) => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }

    const playStatusAnterior = playStatus;
    const watchedAnterior = watched;
    setModalAbierto(false);

    let body: Record<string, unknown>;
    if (esSerie && nuevoValor === 'WATCHED') {
      body = { watched: true, playStatus: null };
      setPlayStatus(null);
      setWatched(true);
    } else if (nuevoValor === null) {
      body = esSerie ? { watched: false, playStatus: null } : { playStatus: null };
      setPlayStatus(null);
      setWatched(false);
    } else {
      body = { playStatus: nuevoValor };
      setPlayStatus(nuevoValor);
      setWatched(true);
    }

    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('fallo al guardar');
    } catch {
      setPlayStatus(playStatusAnterior);
      setWatched(watchedAnterior);
    }
  };

  return (
    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-4">
      <button
        onClick={() => (tieneModalEstado ? setModalAbierto(true) : actualizarEstado('watched', watched, setWatched))}
        className={`flex flex-col items-center transition cursor-pointer ${
          tieneModalEstado
            ? estadoActual
              ? ''
              : 'text-gray-400 hover:text-gray-200'
            : watched
            ? 'text-green-400'
            : 'text-gray-400 hover:text-green-400'
        }`}
        style={tieneModalEstado && estadoActual ? { color: estadoActual.color } : undefined}
      >
        <span className="mb-1">
          {esJuego ? (
            // MANDO DE VIDEOJUEGO (para VIDEOJUEGO, sustituye al ojo de "Watched")
            <IconoMando className="h-6 w-6" />
          ) : watched ? (
            <IconoOjoAbierto className="h-6 w-6" />
          ) : (
            <IconoOjoCerrado className="h-6 w-6" />
          )}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider">
          {esJuego ? estadoActual?.label || 'Played' : esSerie ? estadoActual?.label || 'Watched' : 'Watched'}
        </span>
      </button>
      <button
        onClick={() => actualizarEstado('liked', liked, setLiked)}
        className={`flex flex-col items-center transition cursor-pointer ${
          liked ? 'text-red-400' : 'text-gray-400 hover:text-red-400'
        }`}
      >
        <span className="text-2xl mb-1">{liked ? '❤️' : '🤍'}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">Liked</span>
      </button>
      <button
        onClick={() => actualizarEstado('watchlist', watchlist, setWatchlist)}
        className={`flex flex-col items-center transition cursor-pointer ${
          watchlist ? 'text-blue-400' : 'text-gray-400 hover:text-blue-400'
        }`}
      >
        <span className="text-2xl mb-1">{watchlist ? '⏱️✅' : '⏱️'}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">Watchlist</span>
      </button>

      {/* MODAL DE ESTADO (VIDEOJUEGO o SERIE) */}
      {tieneModalEstado && modalAbierto && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setModalAbierto(false)}
        >
          <div
            className="bg-[#1c2228] rounded-lg border border-gray-700 w-full max-w-sm overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3">
              <h3 className="text-blue-300 font-bold text-lg">
                {esJuego ? 'Set your played status' : 'Set your watch status'}
              </h3>
            </div>

            <div>
              {estados.map((e) => (
                <button
                  key={e.valor}
                  onClick={() => guardarEstado(e.valor)}
                  className={`w-full text-left px-4 py-3 border-t border-gray-800 flex items-start gap-3 transition cursor-pointer ${
                    (esSerie ? estadoActual?.valor === e.valor : playStatus === e.valor) ? 'bg-[#3d4a6b]' : 'hover:bg-gray-800'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full mt-2 flex-shrink-0"
                    style={{ backgroundColor: e.color }}
                  />
                  <span>
                    <div className="font-extrabold text-lg text-white leading-tight">{e.label}</div>
                    <div className="text-gray-400 text-sm">{e.desc}</div>
                  </span>
                </button>
              ))}
            </div>

            <div className="p-3 border-t border-gray-800">
              <button
                onClick={() => guardarEstado(null)}
                className="w-full bg-[#3d4a6b] hover:bg-[#4a5980] text-white font-bold py-2.5 rounded flex items-center justify-center gap-2 transition cursor-pointer"
              >
                {esJuego ? <IconoMando className="h-5 w-5" /> : <IconoOjoCerrado className="h-5 w-5" />}
                {esJuego ? 'Mark as unplayed' : 'Mark as unwatched'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}