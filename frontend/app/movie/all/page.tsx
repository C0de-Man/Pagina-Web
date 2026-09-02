import { cookies } from 'next/headers';
import MovieCard from '@/components/MovieCard';
import MovieFiltersSidebar from '@/components/MovieFiltersSidebar';
import Link from 'next/link';

export default async function TodasLasPeliculas({ searchParams }: { searchParams: Promise<{ page?: string; tipo?: string; anio?: string; ratingMin?: string; ratingMax?: string; duracion?: string; orden?: string }> }) {
  const currentYear = new Date().getFullYear();

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');
  const esPopulares = resolvedParams.tipo === 'popular';
  const anioFiltro = resolvedParams.anio || String(currentYear);

  // Querystring con TODOS los filtros activos: se reenvía al backend y también
  // se usa para no perderlos al cambiar de página
  const filtros = new URLSearchParams();
  if (resolvedParams.tipo) filtros.set('tipo', resolvedParams.tipo);
  if (resolvedParams.anio) filtros.set('anio', resolvedParams.anio);
  if (resolvedParams.ratingMin) filtros.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtros.set('ratingMax', resolvedParams.ratingMax);
  if (resolvedParams.duracion) filtros.set('duracion', resolvedParams.duracion);
  if (resolvedParams.orden) filtros.set('orden', resolvedParams.orden);

  // Los filtros que le importan al BACKEND (idioma/región/año/rating/duración/orden).
  // idioma/región faltaban antes: sin ellos, getLang()/getRegion() en el backend
  // caían siempre a su valor por defecto ('es-ES'/'ES'), así que esta página
  // ignoraba por completo el idioma configurado en Ajustes. El año también se
  // manda aquí (aunque en modo "Movies {año}" ya va implícito en la propia URL
  // de la ruta) porque en modo Popular es la ÚNICA forma de que el backend sepa
  // que hay que filtrar por año.
  const filtrosBackend = new URLSearchParams();
  filtrosBackend.set('language', idioma);
  filtrosBackend.set('region', region);
  if (resolvedParams.anio) filtrosBackend.set('anio', resolvedParams.anio);
  if (resolvedParams.ratingMin) filtrosBackend.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtrosBackend.set('ratingMax', resolvedParams.ratingMax);
  if (resolvedParams.duracion) filtrosBackend.set('duracion', resolvedParams.duracion);
  if (resolvedParams.orden) filtrosBackend.set('orden', resolvedParams.orden);
  const sufijoBackend = `?${filtrosBackend.toString()}`;

  // Según de dónde vengamos, pedimos el catálogo del año (el elegido en el
  // filtro, o el actual por defecto) o el histórico de populares
  const url = esPopulares
    ? `http://localhost:3001/tmdb/popular-historico/page/${currentPage}${sufijoBackend}`
    : `http://localhost:3001/tmdb/year/${anioFiltro}/page/${currentPage}${sufijoBackend}`;

  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json();
  const peliculas = data.results || [];

  // Obtenemos TU base de datos local
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  // Igual que en peliculas/page.tsx: aquí solo miramos si ya está guardada
  // (dbId). El portada de /media es el compartido, no tu personalización —
  // MovieCard comprueba tu portada real por su cuenta, en el navegador.
  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null
    };
  };

  // Mantenemos todos los filtros activos al pasar de página
  const sufijoTipo = filtros.toString() ? `&${filtros.toString()}` : '';

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10 relative">

      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        
        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            {esPopulares ? 'Popular' : `Movies ${anioFiltro}`}
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Page {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Showing {peliculas.length} titles</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <MovieFiltersSidebar currentYear={currentYear} />

          <div className="flex-grow">
            {/* CUADRÍCULA */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-2">
              {peliculas.map((pelicula: any) => {
                const { dbId, customPoster } = getLocalData(pelicula.id);
                return (
                  <div key={`all-${pelicula.id}`} className="w-full">
                     <MovieCard 
                       pelicula={pelicula} 
                       dbId={dbId} 
                       customPoster={customPoster} 
                     />
                  </div>
                );
              })}
            </div>

            {/* BARRA DE PAGINACIÓN NUMERADA (no conocemos el total real de
                páginas que da TMDB, así que mostramos una ventana de 7 números
                centrada en la página actual, igual que en juegos/cómics) */}
            <div className="border-t border-gray-800 mt-8 pt-6 flex items-center justify-between">
              {currentPage > 1 ? (
                <Link
                  href={`/movie/all?page=${currentPage - 1}${sufijoTipo}`}
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
                    href={`/movie/all?page=${n}${sufijoTipo}`}
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
                href={`/movie/all?page=${currentPage + 1}${sufijoTipo}`}
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