import Link from 'next/link';

export default async function DeveloperPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;

  const res = await fetch(`http://localhost:3001/igdb/company/${companyId}`, { cache: 'no-store' });

  if (!res.ok) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        Company not found
      </main>
    );
  }

  const data = await res.json();

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans py-10">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">
        <div className="flex items-center gap-4 border-b border-gray-800 pb-6 mb-8">
          {data.logo && (
            <div className="bg-white rounded p-3 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.logo} alt={data.nombre} className="h-12 object-contain" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{data.nombre}</h1>
            {data.pais && <p className="text-sm text-gray-500">{data.pais}</p>}
          </div>
        </div>

        {data.juegos.length === 0 ? (
          <p className="text-gray-500">No games found for this company.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {data.juegos.map((juego: any) => (
              <Link key={juego.igdbId} href={`/game/igdb/${juego.igdbId}`} className="group relative block">
                {juego.portada ? (
                  <img
                    src={juego.portada}
                    alt={juego.titulo}
                    className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition shadow-lg"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2">
                    {juego.titulo}
                  </div>
                )}
                <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
                  <p className="text-sm font-bold text-white">
                    {juego.titulo} <span className="font-normal text-gray-300">({juego.anio})</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}