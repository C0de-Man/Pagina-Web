import { cookies } from 'next/headers';
import SeriesLobbyClient from '@/components/SeriesLobbyClient';
import FriendsActivityOnMedia from '@/components/FriendsActivityOnMedia';

export default async function SeriesLobby() {
  const currentYear = new Date().getFullYear();

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  // 1. Series EXACTAS de este año, ordenadas por popularidad
  const resYear = await fetch(`http://localhost:3001/tmdb/tv/year/${currentYear}?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const yearSeries = await resYear.json();

  // 2. Más populares de SIEMPRE (no solo tendencia actual)
  const resPop = await fetch(`http://localhost:3001/tmdb/tv/popular-historico?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const popular = await resPop.json();

  // 3. TU base de datos
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  // Igual que en el lobby de películas: sin token aquí (página de
  // servidor), solo comprobamos si ya está guardada. La personalización
  // real (customPoster) la resuelve SeriesCard en el navegador.
  const getLocalData = (tmdbId: number) => {
    const local = myDb.find((m: any) => m.tmdbId === tmdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null
    };
  };

  const yearSeriesConDatos = yearSeries.map((serie: any) => ({
    serie,
    ...getLocalData(serie.id),
  }));

  const popularConDatos = popular.map((serie: any) => ({
    serie,
    ...getLocalData(serie.id),
  }));

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <SeriesLobbyClient
          currentYear={currentYear}
          yearSeriesConDatos={yearSeriesConDatos}
          popularConDatos={popularConDatos}
        />
      </div>
    </main>
  );
}