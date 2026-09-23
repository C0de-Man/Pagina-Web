'use client';
import YearBooksCarousel from './YearBooksCarousel';
import { useState } from 'react';
import BookCard from '@/components/BookCard';

const CATEGORIAS_FILTRO = [
  { valor: 'libro', label: 'Book' },
  { valor: 'comic', label: 'Comic' },
  { valor: 'Manga', label: 'Manga' },
  { valor: 'Novel', label: 'Novel' },
  { valor: 'Light Novel', label: 'Light Novel' },
  { valor: 'One-shot', label: 'One-shot' },
  { valor: 'Doujinshi', label: 'Doujinshi' },
  { valor: 'Manhwa', label: 'Manhwa' },
  { valor: 'Manhua', label: 'Manhua' },
  { valor: 'OEL', label: 'OEL' },
];

// Traduce cada resultado a la categoría de filtro a la que pertenece.
// "libro" y "comic" son la propia fuente (googlebooks/mangadex quedan
// contados como "libro" salvo que tengan tipoMedia real de MAL); el resto
// son los tipoMedia que ya manda MAL para manga/novelas/etc.
function categoriaDe(item: any): string {
  if (item.fuente === 'comicvine') return 'comic';
  if (item.fuente === 'mal' && item.tipoMedia) return item.tipoMedia;
  return 'libro';
}

export default function BookSearchBox({
  añoActual,
  librosDelAño,
}: {
  añoActual: number;
  librosDelAño: any[];
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscadoYa, setBuscadoYa] = useState(false);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [categoriasElegidas, setCategoriasElegidas] = useState<string[]>([]);

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

  const toggleCategoria = (valor: string) => {
    setCategoriasElegidas((prev) =>
      prev.includes(valor) ? prev.filter((c) => c !== valor) : [...prev, valor]
    );
  };

  const getLocalData = (libro: any) => {
    const campo =
      libro.fuente === 'mal' ? 'malMangaId' :
      libro.fuente === 'mangadex' ? 'mangaDexId' :
      libro.fuente === 'anilist' ? 'anilistId' :
      libro.fuente === 'comicvine' ? 'comicVineId' :
      'googleBooksId';
    const local = myDb.find((m: any) => m[campo] === libro.origenId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null,
    };
  };

  // Nada marcado = todo (mismo criterio que el sidebar de Games).
  const resultadosFiltrados = categoriasElegidas.length === 0
    ? resultados
    : resultados.filter((libro) => categoriasElegidas.includes(categoriaDe(libro)));

  return (
    <div className="mb-12">
      <div className="flex gap-2 mb-6 max-w-2xl items-start">
        <form onSubmit={buscar} className="flex gap-2 flex-grow">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a book or manga..."
            className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <button
            type="submit"
            disabled={buscando}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold px-4 rounded transition cursor-pointer whitespace-nowrap"
          >
            {buscando ? 'Searching...' : 'Search'}
          </button>
        </form>

        <div className="relative">
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((prev) => !prev)}
            className="bg-[#2c3440] hover:bg-[#3a4552] text-white text-sm font-semibold px-4 py-2 rounded transition cursor-pointer whitespace-nowrap flex items-center gap-1"
          >
            Filters {categoriasElegidas.length > 0 ? `(${categoriasElegidas.length})` : ''} ▾
          </button>
          {filtrosAbiertos && (
            <div
              className="absolute right-0 mt-1 w-64 bg-[#1c2228] border border-gray-700 rounded-lg shadow-xl p-4 z-20"
              onMouseLeave={() => setFiltrosAbiertos(false)}
            >
              <p className="text-xs text-gray-400 mb-3">
                Nothing checked = everything. Check one or more to see ONLY those categories instead:
              </p>
              <div className="space-y-2">
                {CATEGORIAS_FILTRO.map((cat) => (
                  <label key={cat.valor} className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={categoriasElegidas.includes(cat.valor)}
                      onChange={() => toggleCategoria(cat.valor)}
                      className="cursor-pointer"
                    />
                    {cat.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {buscadoYa ? (
        buscando ? (
          <p className="text-gray-500 text-sm">Searching...</p>
        ) : resultadosFiltrados.length === 0 ? (
          <p className="text-gray-500 text-sm">No results found for "{query}".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {resultadosFiltrados.map((libro: any) => {
              const { dbId, customPoster } = getLocalData(libro);
              return (
                <BookCard key={`${libro.fuente}-${libro.origenId}`} libro={libro} dbId={dbId} customPoster={customPoster} />
              );
            })}
          </div>
        )
      ) : (
        librosDelAño.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xl font-bold mb-4">Books {añoActual}</h2>
            <YearBooksCarousel items={librosDelAño} />
          </div>
        )
      )}
    </div>
  );
}