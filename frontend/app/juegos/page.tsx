'use client';
import { useState } from 'react';
import GameCard from '@/components/GameCard';

export default function JuegosPage() {
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

  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null,
    };
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold mb-6 tracking-wide">Juegos</h1>

        <form onSubmit={buscar} className="flex gap-2 mb-8 max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar un videojuego..."
            className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <button
            type="submit"
            disabled={buscando}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold px-4 rounded transition cursor-pointer"
          >
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {!buscadoYa ? (
          <p className="text-gray-500 text-sm">Busca un juego arriba para empezar.</p>
        ) : buscando ? (
          <p className="text-gray-500 text-sm">Buscando...</p>
        ) : resultados.length === 0 ? (
          <p className="text-gray-500 text-sm">No se encontraron juegos para "{query}".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
            {resultados.map((juego: any) => {
              const { dbId, customPoster } = getLocalData(juego.id);
              return (
                <GameCard key={juego.id} juego={juego} dbId={dbId} customPoster={customPoster} />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}