'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import StarRating from '@/components/StarRating';
import { urlFicha } from '@/lib/slug';
import SortDropdown from '@/components/SortDropdown';
import { useSortPreference } from '@/hooks/useSortPreference';
import { OPCIONES_ORDEN_WATCHED_DISPONIBLE, ordenarItems, type Selectores } from '@/lib/ordenamiento';

const selectoresSeries: Selectores<any> = {
  nombre: (i) => i.titulo,
  fechaEstreno: (i) => i.anio,
  miNota: (i) => i.rating,
};

// Mismos valores/colores que el modal "Set your watch status" de
// ActionButtons.tsx — "WATCHED" no es un playStatus real en la base de
// datos (null + watched=true), así que se deriva aparte más abajo.
const ESTADOS_SERIE = [
  { valor: 'WATCHING', color: '#ec4899', label: 'Watching' },
  { valor: 'WATCHED', color: '#22c55e', label: 'Watched' },
  { valor: 'PAUSED', color: '#f97316', label: 'Paused' },
  { valor: 'ABANDONED', color: '#ef4444', label: 'Abandoned' },
];

function estadoDeSerie(item: any): string {
  if (item.playStatus === 'WATCHING' || item.playStatus === 'PAUSED' || item.playStatus === 'ABANDONED') {
    return item.playStatus;
  }
  return 'WATCHED'; // watched=true sin playStatus (o playStatus null) = terminada
}

export default function MisSeries() {
  const [series, setSeries] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);

    fetch('http://localhost:3001/media/watched', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        const soloSeries = data.filter((m: any) => m.tipo === 'SERIE');
        setSeries(soloSeries);
      })
      .catch(() => {});
  }, []);

  const { valor: orden, setValor: setOrden, cargado: ordenCargado } = useSortPreference('watched-series', {
    campo: 'fechaEstreno',
    direccion: 'DESC',
  });

  const seriesFiltradas = filtroEstado ? series.filter((s) => estadoDeSerie(s) === filtroEstado) : series;
  const seriesOrdenadas = ordenCargado
    ? ordenarItems(seriesFiltradas, orden, selectoresSeries)
    : seriesFiltradas;

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-extrabold">Watched</h1>
          {logueado && series.length > 0 && (
            <SortDropdown opciones={OPCIONES_ORDEN_WATCHED_DISPONIBLE} valor={orden} onChange={setOrden} />
          )}
        </div>

        {logueado && series.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {ESTADOS_SERIE.map((e) => {
              const total = series.filter((s) => estadoDeSerie(s) === e.valor).length;
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

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Sign in</Link> to see your series.
          </p>
        ) : series.length === 0 ? (
          <p className="text-gray-500 text-sm">You haven't marked any series as watched yet.</p>
        ) : seriesOrdenadas.length === 0 ? (
          <p className="text-gray-500 text-sm">No series with that status.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {seriesOrdenadas.map((item) => (
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