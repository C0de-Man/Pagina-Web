import SearchResultItem from '@/components/SearchResultItem';
import Link from 'next/link';

const FILTROS = [
  { label: 'All', value: 'all' },
  { label: 'Movies', value: 'movie' },
  { label: 'Series', value: 'tv' },
  { label: 'Books', value: 'libro' },
  { label: 'Games', value: 'juego' },
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q: string; tipo?: string }> }) {
  const resolvedParams = await searchParams;
  const query = resolvedParams.q;
  const tipoActivo = resolvedParams.tipo || 'all';

  // 1. Buscamos en la API de TMDB (películas/series) y en IGDB (juegos) a la vez
  const [resTmdb, resIgdb, resDb] = await Promise.all([
    fetch(`http://localhost:3001/tmdb/buscar?q=${query}`, { cache: 'no-store' }),
    fetch(`http://localhost:3001/igdb/search?q=${query}`, { cache: 'no-store' }),
    fetch('http://localhost:3001/media', { cache: 'no-store' }),
  ]);

  const resultsTmdb = await resTmdb.json();
  const resultsIgdb = await resIgdb.json();
  const myDb = await resDb.json();

  // /tmdb/buscar usa TMDB search/multi: además de películas y series trae
  // personas (actores, directores...) mezcladas — esas sí se descartan aquí,
  // películas y series se quedan las dos.
  const resultsTmdbFiltrados = (Array.isArray(resultsTmdb) ? resultsTmdb : [])
    .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv');

  const resultsJuegos = (Array.isArray(resultsIgdb) ? resultsIgdb : []).map((j: any) => ({
    ...j,
    media_type: 'juego',
  }));

  const results = [...resultsTmdbFiltrados, ...resultsJuegos];

  // /media no lleva token (página de servidor, sin acceso a localStorage) y
  // su "portada" es la compartida, no tu personalización — aquí solo
  // comprobamos si el título ya está guardado (dbId). SearchResultItem
  // comprueba tu portada real por su cuenta, en el navegador.
  const getLocalData = (item: any) => {
    const esJuego = item.media_type === 'juego';
    // OJO: TMDB numera películas y series en espacios de IDs independientes,
    // así que una película guardada puede tener el MISMO tmdbId numérico que
    // una serie distinta que aparece en los resultados (y viceversa). Sin
    // comprobar también el tipo, esto podía devolver el dbId de una película
    // al buscar una serie con ese mismo número — y el enlace acababa
    // abriendo la ficha equivocada.
    const tipoEsperado = item.media_type === 'tv' ? 'SERIE' : 'PELICULA';
    const local = esJuego
      ? myDb.find((m: any) => m.igdbId === item.id)
      : myDb.find((m: any) => m.tmdbId === item.id && m.tipo === tipoEsperado);
    return {
      dbId: local ? local.id : null,
      customPoster: local?.portada || null
    };
  };
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

          <div className="flex-1 space-y-6 max-w-2xl">
            {resultadosFiltrados.length === 0 ? (
              <p className="text-gray-400">No se encontraron resultados.</p>
            ) : (
              resultadosFiltrados.map((item: any) => {
                const { dbId, customPoster } = getLocalData(item);
                return (
                  <SearchResultItem
                    key={`${item.media_type}-${item.id}`}
                    item={item}
                    dbId={dbId}
                    customPoster={customPoster}
                  />
                );
              })
            )}
          </div>

          <aside className="w-full lg:w-56 flex-shrink-0">
            <div className="bg-gray-900/60 border border-gray-800 rounded-lg overflow-hidden">
              {FILTROS.map((filtro) => (
                <Link
                  key={filtro.value}
                  href={`/search?q=${encodeURIComponent(query)}${filtro.value === 'all' ? '' : `&tipo=${filtro.value}`}`}
                  className={`block px-4 py-3 text-sm font-semibold border-b border-gray-800 last:border-b-0 transition ${tipoActivo === filtro.value
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