'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ActionButtons({ mediaId, tipo }: { mediaId: number; tipo?: string }) {
  const [watched, setWatched] = useState(false);
  const [liked, setLiked] = useState(false);
  const [watchlist, setWatchlist] = useState(false);
  const router = useRouter();

  const esJuego = tipo === 'VIDEOJUEGO';

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

  return (
    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-4">
      <button
        onClick={() => actualizarEstado('watched', watched, setWatched)}
        className={`flex flex-col items-center transition cursor-pointer ${
          watched ? 'text-green-400' : 'text-gray-400 hover:text-green-400'
        }`}
      >
        <span className="mb-1">
          {esJuego ? (
            // MANDO DE VIDEOJUEGO (para VIDEOJUEGO, sustituye al ojo de "Watched")
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 10.5h1.5m-1.5 1.5h1.5m3-3v3m3-1.5h1.5m-1.5-1.5v3M6.75 6.75h10.5a3.75 3.75 0 013.712 3.213l.674 4.5A3.375 3.375 0 0117.663 18a3.363 3.363 0 01-2.68-1.333l-.645-.86a1.875 1.875 0 00-1.5-.75H10.66a1.875 1.875 0 00-1.5.75l-.645.86A3.363 3.363 0 015.837 18a3.375 3.375 0 01-3.473-3.537l.674-4.5A3.75 3.75 0 016.75 6.75z" />
            </svg>
          ) : watched ? (
            // OJO ABIERTO
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          ) : (
            // OJO CERRADO
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          )}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider">
          {esJuego ? 'Played' : 'Watched'}
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
    </div>
  );
}