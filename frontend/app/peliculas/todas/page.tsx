import MovieCard from '@/components/MovieCard';
import Link from 'next/link';

export default async function TodasLasPeliculas({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const currentYear = new Date().getFullYear();
  
  // Leemos en qué página estamos según la URL (por defecto la 1)
  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');

  // Pedimos nuestras 42 películas al backend
  const res = await fetch(`http://localhost:3001/tmdb/year/${currentYear}/page/${currentPage}`, { cache: 'no-store' });
  const data = await res.json();
  const peliculasDelAno = data.results || [];

  // Obtenemos TU base de datos local
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10 relative">
      
      {/* BOTÓN LATERAL IZQUIERDO */}
      {currentPage > 1 && (
        <Link 
          href={`/peliculas/todas?page=${currentPage - 1}`}
          className="fixed left-4 top-1/2 -translate-y-1/2 bg-gray-900/80 hover:bg-gray-700 text-white w-14 h-14 rounded-full border border-gray-600 z-50 transition hidden lg:flex items-center justify-center shadow-2xl cursor-pointer"
        >
          <span className="text-4xl leading-none pb-1 pr-1">‹</span>
        </Link>
      )}

      {/* BOTÓN LATERAL DERECHO */}
      <Link 
        href={`/peliculas/todas?page=${currentPage + 1}`}
        className="fixed right-4 top-1/2 -translate-y-1/2 bg-gray-900/80 hover:bg-gray-700 text-white w-14 h-14 rounded-full border border-gray-600 z-50 transition hidden lg:flex items-center justify-center shadow-2xl cursor-pointer"
      >
        <span className="text-4xl leading-none pb-1 pl-1">›</span>
      </Link>

      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        
        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            Películas {currentYear} 
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Pág. {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Mostrando 42 títulos</span>
        </div>

        {/* CUADRÍCULA DE 7 COLUMNAS */}
        {/* Usamos xl:grid-cols-7 explícitamente para asegurar tu 7x6 */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4 pt-2">
          {peliculasDelAno.map((pelicula: any) => {
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

      </div>
    </main>
  );
}