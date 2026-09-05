import { cookies } from 'next/headers';
import PeliculasLobbyClient from '@/components/PeliculasLobbyClient';
import FriendsActivityOnMedia from '@/components/FriendsActivityOnMedia';

export default async function PeliculasLobby() {
  const currentYear = new Date().getFullYear();

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  // 1. Obtenemos las películas EXACTAS de este año, ordenadas por popularidad
  const resYear = await fetch(`http://localhost:3001/tmdb/year/${currentYear}?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const yearMovies = await resYear.json();

  // 2. Obtenemos las más populares de SIEMPRE (no solo la tendencia actual)
  const resPop = await fetch(`http://localhost:3001/tmdb/popular-historico?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const popular = await resPop.json();

  // 3. Obtenemos TU base de datos
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  // Esta petición a /media no lleva token (es una página de servidor, no
  // tiene acceso a localStorage) y ADEMÁS /media devuelve el portada
  // COMPARTIDO, no tu personalización — así que aquí solo comprobamos si el
  // título ya está guardado (dbId), nunca inventamos un customPoster falso.
  // MovieCard, en el navegador y con tu token, comprueba tu portada real.
  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null
    };
  };

  const yearMoviesConDatos = yearMovies.map((pelicula: any) => ({
    pelicula,
    ...getLocalData(pelicula.id),
  }));

  const popularConDatos = popular.map((pelicula: any) => ({
    pelicula,
    ...getLocalData(pelicula.id),
  }));

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <PeliculasLobbyClient
          currentYear={currentYear}
          yearMoviesConDatos={yearMoviesConDatos}
          popularConDatos={popularConDatos}
        />
      </div>
    </main>
  );
}