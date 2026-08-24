'use client';
import { useState } from 'react';
import Link from 'next/link';
import GameCard from '@/components/GameCard';
import YearGamesCarousel from '@/components/YearGamesCarousel';

export default function JuegosLobbyClient({
  currentYear,
  yearGamesConDatos,
  popularConDatos,
}: {
  currentYear: number;
  yearGamesConDatos: { juego: any; dbId: number | null; customPoster: string | null }[];
  popularConDatos: { juego: any; dbId: number | null; customPoster: string | null }[];
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
      const [resJuegos, resDb] = await Promise.all([
        fetch(`http://localhost:3001/igdb/search?q=${encodeURIComponent(query)}`),
        fetch('http://localhost:3001/media'),
      ]);
      const juegos = await resJuegos.json();
      const db = await resDb.json();
      setResultados(Array.isArray(juegos) ? juegos : []);
      setMyDb(db);
    } catch (error) {
      console.error('Error al buscar juegos:', error);
      setResultados([]);
    }
    setBuscando(false);
  };

  const limpiarBusqueda = () => {
    setQuery('');
    setResultados([]);
    setBuscadoYa(false);
  };

  // /media no lleva token (esta búsqueda va sin auth) y su "portada" es la
  // compartida, no tu personalización — solo usamos esto para saber si el
  // título ya está guardado (dbId). GameCard comprueba tu portada real por
  // su cuenta, en el navegador, con tu token.
  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
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
          placeholder="Search for a game..."
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
          <p className="text-gray-500 text-sm">No games found for "{query}".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
            {resultados.map((juego: any) => {
              const { dbId, customPoster } = getLocalData(juego.id);
              return (
                <GameCard key={juego.id} juego={juego} dbId={dbId} customPoster={customPoster} />
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Games {currentYear}</h2>
              <Link href="/game/all" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <YearGamesCarousel items={yearGamesConDatos} />
          </div>

          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Popular</h2>
              <Link href="/game/all?tipo=popular" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 pt-2" style={{ scrollbarWidth: 'none' }}>
              {popularConDatos.map(({ juego, dbId, customPoster }) => (
                <GameCard key={`pop-${juego.id}`} juego={juego} dbId={dbId} customPoster={customPoster} />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}