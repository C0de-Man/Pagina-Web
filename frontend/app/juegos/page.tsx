import JuegosLobbyClient from '@/components/JuegosLobbyClient';

export default async function JuegosLobby() {
  const currentYear = new Date().getFullYear();

  const resYear = await fetch(`http://localhost:3001/igdb/year/${currentYear}`, { cache: 'no-store' });
  const yearGames = await resYear.json();

  const resPop = await fetch(`http://localhost:3001/igdb/popular`, { cache: 'no-store' });
  const popular = await resPop.json();

  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  const yearGamesConDatos = yearGames.map((juego: any) => ({
    juego,
    ...getLocalData(juego.id),
  }));

  const popularConDatos = popular.map((juego: any) => ({
    juego,
    ...getLocalData(juego.id),
  }));

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold mb-6 tracking-wide">Juegos</h1>
        <JuegosLobbyClient
          currentYear={currentYear}
          yearGamesConDatos={yearGamesConDatos}
          popularConDatos={popularConDatos}
        />
      </div>
    </main>
  );
}