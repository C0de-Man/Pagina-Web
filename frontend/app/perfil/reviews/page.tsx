'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';
import ReviewDetailModal from '@/components/ReviewDetailModal';

function Estrellas({ rating }: { rating: number }) {
  const sobreCinco = rating / 2;
  const llenas = Math.floor(sobreCinco);
  const media = sobreCinco - llenas >= 0.5;
  return (
    <span className="text-yellow-400 text-sm tracking-tight">
      {'★'.repeat(llenas)}
      {media && '½'}
    </span>
  );
}

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ETIQUETA_TIPO: Record<string, string> = {
  PELICULA: 'Film',
  SERIE: 'Series',
  VIDEOJUEGO: 'Game',
};

export default function MisResenas() {
  const [resenas, setResenas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [logueado, setLogueado] = useState(false);
  const [resenaAbierta, setResenaAbierta] = useState<any>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCargando(false);
      return;
    }
    setLogueado(true);

    fetch('http://localhost:3001/media/reviews', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => setResenas(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">Reviews</h1>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Sign in</Link> to see your reviews.
          </p>
        ) : cargando ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : resenas.length === 0 ? (
          <p className="text-gray-500 text-sm">
            You haven't written any reviews yet. Use "Review or log..." on a film/series or game page to write one.
          </p>
        ) : (
          <div className="space-y-6">
            {resenas.map((r) => (
              <div
                key={r.logId}
                onClick={() => setResenaAbierta(r)}
                className="flex gap-4 bg-[#1c2228] border border-gray-800 rounded-lg p-4 cursor-pointer hover:border-gray-600 transition"
              >
                <Link href={urlFicha(r)} onClick={(e) => e.stopPropagation()} className="flex-shrink-0 w-20">
                  {r.portada ? (
                    <img
                      src={r.portada}
                      alt={r.titulo}
                      className="w-20 aspect-[2/3] object-cover rounded border border-gray-700"
                    />
                  ) : (
                    <div className="w-20 aspect-[2/3] bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-[10px] text-center p-1">
                      {r.titulo}
                    </div>
                  )}
                </Link>

                <div className="flex-grow min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <Link href={urlFicha(r)} onClick={(e) => e.stopPropagation()} className="font-bold text-white hover:underline">
                      {r.titulo}
                    </Link>
                    <span className="text-gray-500 text-sm">{r.anio}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                      {ETIQUETA_TIPO[r.tipo] || r.tipo}
                    </span>
                    {r.rewatch && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">
                        Rewatch
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    {r.rating != null && <Estrellas rating={r.rating} />}
                    {r.liked && <span className="text-pink-500 text-sm">♥</span>}
                    <span className="text-gray-500 text-xs">{formatFecha(r.fecha)}</span>
                    {r.logNombre && <span className="text-gray-600 text-xs">· {r.logNombre}</span>}
                  </div>

                  <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{r.review}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReviewDetailModal resena={resenaAbierta} onClose={() => setResenaAbierta(null)} />
    </main>
  );
}