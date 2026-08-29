import SeriesCard from '@/components/SeriesCard';
import SeriesFiltersSidebar from '@/components/SeriesFiltersSidebar';
import Link from 'next/link';

export default async function TodasLasSeries({ searchParams }: { searchParams: Promise<{ page?: string; tipo?: string; anio?: string; ratingMin?: string; ratingMax?: string; duracion?: string; orden?: string }> }) {
  const currentYear = new Date().getFullYear();

  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');
  const esPopulares = resolvedParams.tipo === 'popular';
  const anioFiltro = resolvedParams.anio || String(currentYear);

  const filtros = new URLSearchParams();
  if (resolvedParams.tipo) filtros.set('tipo', resolvedParams.tipo);
  if (resolvedParams.anio) filtros.set('anio', resolvedParams.anio);
  if (resolvedParams.ratingMin) filtros.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtros.set('ratingMax', resolvedParams.ratingMax);
  if (resolvedParams.duracion) filtros.set('duracion', resolvedParams.duracion);
  if (resolvedParams.orden) filtros.set('orden', resolvedParams.orden);

  const filtrosBackend = new URLSearchParams();
  if (resolvedParams.anio) filtrosBackend.set('anio', resolvedParams.anio);
  if (resolvedParams.ratingMin) filtrosBackend.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtrosBackend.set('ratingMax', resolvedParams.ratingMax);
  if (resolvedParams.duracion) filtrosBackend.set('duracion', resolvedParams.duracion);
  if (resolvedParams.orden) filtrosBackend.set('orden', resolvedParams.orden);
  const sufijoBackend = filtrosBackend.toString() ? `?${filtrosBackend.toString()}` : '';

  const url = esPopulares
    ? `http://localhost:3001/tmdb/tv/popular-historico/page/${currentPage}${sufijoBackend}`
    : `http://localhost:3001/tmdb/tv/year/${anioFiltro}/page/${currentPage}${sufijoBackend}`;

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  const series = data.results || [];

  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null
    };
  };

  const sufijoTipo = filtros.toString() ? `&${filtros.toString()}` : '';

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10 relative">

      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">

        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            {esPopulares ? 'Popular' : `Series ${anioFiltro}`}
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Page {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Showing {series.length} titles</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <SeriesFiltersSidebar currentYear={currentYear} />

          <div className="flex-grow">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-2">
              {series.map((serie: any) => {
                const { dbId, customPoster } = getLocalData(serie.id);
                return (
                  <div key={`all-${serie.id}`} className="w-full">
                     <SeriesCard
                       serie={serie}
                       dbId={dbId}
                       customPoster={customPoster}
                     />
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-800 mt-8 pt-6 flex items-center justify-between">
              {currentPage > 1 ? (
                <Link
                  href={`/series/all?page=${currentPage - 1}${sufijoTipo}`}
                  className="text-sm text-gray-400 hover:text-white transition"
                >
                  ‹ Prev
                </Link>
              ) : (
                <span className="text-sm text-gray-700">‹ Prev</span>
              )}

              <div className="flex gap-2">
                {Array.from({ length: 7 }, (_, i) => Math.max(1, currentPage - 3) + i).map((n) => (
                  <Link
                    key={n}
                    href={`/series/all?page=${n}${sufijoTipo}`}
                    className={`w-9 h-9 flex items-center justify-center rounded text-sm font-bold transition ${
                      n === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {n}
                  </Link>
                ))}
              </div>

              <Link
                href={`/series/all?page=${currentPage + 1}${sufijoTipo}`}
                className="text-sm text-gray-400 hover:text-white transition"
              >
                Next ›
              </Link>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}