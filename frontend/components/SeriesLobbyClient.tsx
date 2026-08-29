'use client';
import { useState } from 'react';
import Link from 'next/link';
import SeriesCard from '@/components/SeriesCard';
import YearSeriesCarousel from '@/components/YearSeriesCarousel';

export default function SeriesLobbyClient({
  currentYear,
  yearSeriesConDatos,
  popularConDatos,
}: {
  currentYear: number;
  yearSeriesConDatos: { serie: any; dbId: number | null; customPoster: string | null }[];
  popularConDatos: { serie: any; dbId: number | null; customPoster: string | null }[];
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscadoYa, setBuscadoYa] = useState(false);

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || buscando) return;
    setBuscando(true);
    setBuscadoYa(true);
    try {
      const [resSeries, resDb] = await Promise.all([
        fetch(`http://localhost:3001/tmdb/buscar?q=${encodeURIComponent(query)}`),
        fetch('http://localhost:3001/media'),
      ]);
      const series = await resSeries.json();
      const db = await resDb.json();
      // /tmdb/buscar usa TMDB search/multi: viene mezclado con películas y
      // personas, nos quedamos solo con series (media_type === 'tv')
      const soloSeries = Array.isArray(series)
        ? series.filter((item: any) => item.media_type === 'tv')
        : [];
      setResultados(soloSeries);
      setMyDb(db);
    } catch (error) {
      console.error('Error al buscar series:', error);
      setResultados([]);
    }
    setBuscando(false);
  };

  const limpiarBusqueda = () => {
    setQuery('');
    setResultados([]);
    setBuscadoYa(false);
  };

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null,
    };
  };

  return (
    <>
      <form onSubmit={buscar} className="flex gap-2 mb-6 max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a series..."
          className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />
        <button
          type="submit"
          disabled={buscando}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold px-4 rounded transition cursor-pointer"
        >
          {buscando ? 'Searching...' : 'Search'}
        </button>
        {buscadoYa && (
          <button
            type="button"
            onClick={limpiarBusqueda}
            className="text-sm text-gray-400 hover:text-white px-3 rounded border border-gray-700 transition cursor-pointer"
          >
            Back
          </button>
        )}
      </form>

      {buscadoYa ? (
        buscando ? (
          <p className="text-gray-500 text-sm">Searching...</p>
        ) : resultados.length === 0 ? (
          <p className="text-gray-500 text-sm">No series found for "{query}".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
            {resultados.map((serie: any) => {
              const { dbId, customPoster } = getLocalData(serie.id);
              return (
                <SeriesCard key={serie.id} serie={serie} dbId={dbId} customPoster={customPoster} />
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Series {currentYear}</h2>
              <Link href="/series/all" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <YearSeriesCarousel items={yearSeriesConDatos} />
          </div>

          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Popular</h2>
              <Link href="/series/all?tipo=popular" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 pt-2" style={{ scrollbarWidth: 'none' }}>
              {popularConDatos.map(({ serie, dbId, customPoster }) => (
                <SeriesCard key={`pop-${serie.id}`} serie={serie} dbId={dbId} customPoster={customPoster} />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}