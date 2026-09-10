'use client';
import { useState } from 'react';
import BookCard from '@/components/BookCard';

export default function BookSearchBox() {
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
      const [resLibros, resDb] = await Promise.all([
        fetch(`http://localhost:3001/libros/buscar?q=${encodeURIComponent(query)}`, { cache: 'no-store' }),
        fetch('http://localhost:3001/media', { cache: 'no-store' }),
      ]);
      const libros = await resLibros.json();
      const db = await resDb.json();
      setResultados(Array.isArray(libros) ? libros : []);
      setMyDb(db);
    } catch (error) {
      console.error('Error al buscar libros:', error);
      setResultados([]);
    }
    setBuscando(false);
  };

  const getLocalData = (libro: any) => {
    const campo = libro.fuente === 'mangadex' ? 'mangaDexId' : 'googleBooksId';
    const local = myDb.find((m: any) => m[campo] === libro.origenId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null,
    };
  };

  return (
    <div className="mb-12">
      <form onSubmit={buscar} className="flex gap-2 mb-6 max-w-md">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar un libro o manga..."
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

      {buscadoYa && (
        buscando ? (
          <p className="text-gray-500 text-sm">Buscando...</p>
        ) : resultados.length === 0 ? (
          <p className="text-gray-500 text-sm">No se encontraron resultados para "{query}".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {resultados.map((libro: any) => {
              const { dbId, customPoster } = getLocalData(libro);
              return (
                <BookCard key={`${libro.fuente}-${libro.origenId}`} libro={libro} dbId={dbId} customPoster={customPoster} />
              );
            })}
          </div>
        )
      )}
    </div>
  );
}