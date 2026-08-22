import MovieCard from '@/components/MovieCard';
import Link from 'next/link';

export default async function TodasLasPeliculas({ searchParams }: { searchParams: Promise<{ page?: string; tipo?: string }> }) {
  const currentYear = new Date().getFullYear();

  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');
  const esPopulares = resolvedParams.tipo === 'popular';

  // Según de dónde vengamos, pedimos el catálogo del año o el histórico de populares
  const url = esPopulares
    ? `http://localhost:3001/tmdb/popular-historico/page/${currentPage}`
    : `http://localhost:3001/tmdb/year/${currentYear}/page/${currentPage}`;

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

  // Mantenemos el filtro (?tipo=popular) al pasar de página
  const sufijoTipo = esPopulares ? '&tipo=popular' : '';

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10 relative">

      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        
        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            {esPopulares ? 'Populares' : `Películas ${currentYear}`}
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Pág. {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Mostrando 42 títulos</span>
        </div>

        {/* CUADRÍCULA DE 7 COLUMNAS */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4 pt-2">
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
              href={`/peliculas/todas?page=${currentPage - 1}${sufijoTipo}`}
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
                href={`/peliculas/todas?page=${n}${sufijoTipo}`}
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
            href={`/peliculas/todas?page=${currentPage + 1}${sufijoTipo}`}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            Next ›
          </Link>
        </div>

      </div>
    </main>
  );
}