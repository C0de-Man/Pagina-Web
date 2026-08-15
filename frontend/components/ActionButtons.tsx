'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ActionButtons({ mediaId }: { mediaId: number }) {
  const [watched, setWatched] = useState(false);
  const [watchlist, setWatchlist] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(`http://localhost:3001/media/${mediaId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setWatched(!!data.watched);
        setWatchlist(!!data.watchlist);
      })
      .catch(() => {});
  }, [mediaId]);

  const actualizarEstado = async (campo: 'watched' | 'watchlist', valorActual: boolean, setter: (v: boolean) => void) => {
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
        <span className="text-2xl mb-1">{watched ? '✅' : '👁️'}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider">Watched</span>
      </button>
      <button className="flex flex-col items-center text-gray-400 hover:text-orange-400 transition cursor-pointer">
        <span className="text-2xl mb-1">❤️</span>
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