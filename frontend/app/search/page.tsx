import SearchResultItem from '@/components/SearchResultItem';
import Link from 'next/link';

const FILTROS = [
  { label: 'All', value: 'all' },
  { label: 'Peliculas', value: 'movie' },
  { label: 'Series', value: 'tv' },
  { label: 'Libros', value: 'libro' },
  { label: 'Juegos', value: 'juego' },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q: string; tipo?: string }> }) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q;
  const tipoActivo = resolvedParams.tipo || 'all';

  // 1. Buscamos en la API de TMDB
  const res = await fetch(`http://localhost:3001/search?q=${query}`, { cache: 'no-store' });
  const results = await res.json();

  // 2. Obtenemos TU base de datos local para comparar
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  // 3. Filtramos los resultados según el tipo elegido en la barra lateral
  const resultadosFiltrados = tipoActivo === 'all'
    ? results
    : results.filter((item: any) => item.media_type === tipoActivo);

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        <div className="border-b border-gray-700 pb-2 mb-6">
          <h1 className="text-xs text-gray-400 font-bold uppercase tracking-wider">
            Showing matches for "{query}"
          </h1>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">

          {/* RESULTADOS */}
          <div className="flex-1 space-y-6 max-w-2xl">
            {resultadosFiltrados.length === 0 ? (
              <p className="text-gray-400">No se encontraron resultados.</p>
            ) : (
              resultadosFiltrados.map((item: any) => {
                const { dbId, customPoster } = getLocalData(item.id);
                return (
                  <SearchResultItem
                    key={item.id}
                    item={item}
                    dbId={dbId}
                    customPoster={customPoster}
                  />
                );
              })
            )}
          </div>

          {/* FILTRO POR TIPO DE CONTENIDO */}
          <aside className="w-full lg:w-56 flex-shrink-0">
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
              {FILTROS.map((filtro) => (
                <Link
                  key={filtro.value}
                  href={`/search?q=${encodeURIComponent(query)}${filtro.value === 'all' ? '' : `&tipo=${filtro.value}`}`}
                  className={`block px-4 py-3 text-sm font-semibold border-b border-gray-800 last:border-b-0 transition ${
                    tipoActivo === filtro.value
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  {filtro.label}
                </Link>
              ))}
            </div>
          </aside>

        </div>

      </div>
    </main>
  );
}