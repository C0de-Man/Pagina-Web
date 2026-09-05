'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import StarRating from '@/components/StarRating';
import { urlFicha } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

// Mismos valores/colores que ActionButtons.tsx. "WATCHED" no es un
// playStatus real en la base de datos (solo WATCHING/PAUSED/ABANDONED lo
// son) — se identifica por watched=true con playStatus vacío.
const ESTADOS_SERIE = [
  { valor: 'WATCHING', color: '#ec4899', label: 'Watching' },
  { valor: 'WATCHED', color: '#22c55e', label: 'Watched' },
  { valor: 'PAUSED', color: '#f97316', label: 'Paused' },
  { valor: 'ABANDONED', color: '#ef4444', label: 'Abandoned' },
];

function coincideEstado(item: any, valor: string) {
  return valor === 'WATCHED' ? !item.playStatus : item.playStatus === valor;
}

export default function SeriesDeUsuario() {
  const params = useParams();
  const username = params.username as string;

  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;

    fetch(`${API_URL}/users/${encodeURIComponent(username)}/watched?tipo=SERIE`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setItems)
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [username]);

  const itemsFiltrados = filtroEstado ? items.filter((i) => coincideEstado(i, filtroEstado)) : items;

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">User not found</main>;
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-1">Series</h1>
        <p className="text-sm text-gray-400 mb-6">
          <Link href={`/user/${username}`} className="hover:underline">{username}</Link>
        </p>

        {items.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {ESTADOS_SERIE.map((e) => {
              const total = items.filter((i) => coincideEstado(i, e.valor)).length;
              if (total === 0) return null;
              const activo = filtroEstado === e.valor;
              return (
                <button
                  key={e.valor}
                  onClick={() => setFiltroEstado(activo ? null : e.valor)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer border ${
                    activo ? 'border-white text-white' : 'border-transparent text-gray-300 hover:border-gray-600'
                  }`}
                  style={{ backgroundColor: activo ? e.color : `${e.color}22` }}
                >
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: e.color }} />
                  {e.label} <span className="opacity-70">{total}</span>
                </button>
              );
            })}
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-gray-500 text-sm">{username} hasn't marked any series as watched yet.</p>
        ) : itemsFiltrados.length === 0 ? (
          <p className="text-gray-500 text-sm">No series with that status.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {itemsFiltrados.map((item) => (
              <div key={item.id} className="flex flex-col gap-1.5">
                <Link href={urlFicha(item)} className="group relative block">
                  {item.portada ? (
                    <img
                      src={item.portada}
                      alt={item.titulo}
                      className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition shadow-lg"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2">
                      {item.titulo}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2">
                    <p className="text-sm font-bold text-white">
                      {item.titulo} <span className="font-normal text-gray-300">({item.anio})</span>
                    </p>
                  </div>
                </Link>

                {(item.rating > 0 || item.liked) && (
                  <div className="flex items-center gap-1.5 px-0.5">
                    {item.rating > 0 && <StarRating value={item.rating} readOnly size="sm" />}
                    {item.liked && <span className="text-sm">❤️</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}