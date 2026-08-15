import Link from 'next/link';
import YearMoviesCarousel from '@/components/YearMoviesCarousel';
import MovieCard from '@/components/MovieCard';

export default async function PeliculasLobby() {
  const currentYear = new Date().getFullYear();

  // 1. Obtenemos las películas EXACTAS de este año, ordenadas por popularidad
  const resYear = await fetch(`http://localhost:3001/tmdb/year/${currentYear}`, { cache: 'no-store' });
  const yearMovies = await resYear.json();

  // 2. Obtenemos las más populares de SIEMPRE (no solo la tendencia actual)
  const resPop = await fetch('http://localhost:3001/tmdb/popular-historico', { cache: 'no-store' });
  const popular = await resPop.json();

  // 3. Obtenemos TU base de datos
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  const yearMoviesConDatos = yearMovies.map((pelicula: any) => ({
    pelicula,
    ...getLocalData(pelicula.id),
  }));

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* PELICULAS DEL AÑO ACTUAL: carrusel de 4 en 4 */}
        <div className="mb-12">
          <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
            <h2 className="text-xl font-bold text-white tracking-wide">Peliculas {currentYear}</h2>
            <Link href="/peliculas/todas" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
              Ver todo <span className="text-lg leading-none">›</span>
            </Link>
          </div>

          <YearMoviesCarousel items={yearMoviesConDatos} />
        </div>

        {/* POPULARES DE SIEMPRE */}
        <div className="mb-12">
          <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
            <h2 className="text-xl font-bold text-white tracking-wide">Populares</h2>
            <Link href="/peliculas/todas?tipo=popular" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
              Ver todo <span className="text-lg leading-none">›</span>
            </Link>
          </div>
          
          <div className="flex gap-4 overflow-x-auto pb-4 pt-2" style={{ scrollbarWidth: 'none' }}>
            {popular.map((pelicula: any) => {
              const { dbId, customPoster } = getLocalData(pelicula.id);
              return (
                <MovieCard 
                  key={`pop-${pelicula.id}`} 
                  pelicula={pelicula} 
                  dbId={dbId} 
                  customPoster={customPoster} 
                />
              );
            })}
          </div>
        </div>

      </div>
    </main>
  );
}