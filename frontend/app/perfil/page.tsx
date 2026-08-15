'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Perfil() {
  const [favoritos, setFavoritos] = useState<any[]>([]);
  const [vistas, setVistas] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [logueado, setLogueado] = useState(false);

  useEffect(() => {
    // Catálogo público, para "Favoritos" (esto lo afinaremos más adelante)
    fetch('http://localhost:3001/media')
      .then((res) => res.json())
      .then(setFavoritos)
      .catch(() => {});

    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');
    if (rawUser) setUsername(JSON.parse(rawUser).username);

    if (token) {
      setLogueado(true);
      fetch('http://localhost:3001/media/watched', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then(setVistas)
        .catch(() => {});
    }
  }, []);

  const renderCard = (item: any) => (
    <Link key={item.id} href={`/media/${item.id}`} className="flex-shrink-0 w-32 md:w-36 group relative">
      {item.portada ? (
        <img
          src={item.portada}
          alt={item.titulo}
          className="w-32 h-48 md:w-36 md:h-52 object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition duration-300 shadow-lg"
        />
      ) : (
        <div className="w-32 h-48 md:w-36 md:h-52 bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2 group-hover:border-gray-400 transition shadow-lg">
          {item.titulo}
        </div>
      )}
      <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
        <p className="text-sm font-bold text-white">
          {item.titulo} <span className="font-normal text-gray-300">({item.anio})</span>
        </p>
      </div>
    </Link>
  );

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      {/* CABECERA DE PERFIL */}
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden bg-blue-600 flex-shrink-0">
              <img
                src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'Miguel'}`}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold">{username || 'Invitado'}</h1>
          </div>

          {/* PESTAÑAS DE NAVEGACIÓN DEL PERFIL */}
          <div className="flex gap-8 mt-6 border-b border-gray-800 -mb-8 pb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <span className="pb-3 text-sm font-semibold text-white border-b-2 border-blue-500 whitespace-nowrap">Perfil</span>
            <Link href="/perfil/peliculas" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Peliculas</Link>
            <Link href="/series" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Series</Link>
            <Link href="/juegos" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Juegos</Link>
            <Link href="/comics" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Comics</Link>
            <span className="pb-3 text-sm font-semibold text-gray-400 whitespace-nowrap">Listas</span>
            <span className="pb-3 text-sm font-semibold text-gray-400 whitespace-nowrap">Reseñas</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">

        {!logueado && (
          <div className="bg-blue-900/30 border border-blue-800 text-blue-200 text-sm rounded px-4 py-3">
            <Link href="/login" className="underline font-semibold">Inicia sesión</Link> para ver tu actividad real.
          </div>
        )}

        {/* FAVORITOS */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Favoritos</h2>
          {favoritos.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {favoritos.map(renderCard)}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Aún no tienes favoritos.</p>
          )}
        </section>

        {/* SIGUIENDO */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Siguiendo</h2>
          <p className="text-gray-500 text-sm">Aún no sigues a nadie.</p>
        </section>

        {/* ACTIVIDAD RECIENTE: solo lo marcado como visto, de la más antigua a la más reciente */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Actividad reciente</h2>
            <Link href="/perfil/actividad" className="text-xs text-gray-400 hover:text-white transition flex items-center gap-1">
              Ver todo <span className="text-sm leading-none">›</span>
            </Link>
          </div>
          {vistas.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {vistas.map(renderCard)}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              {logueado ? 'Aún no has marcado nada como visto.' : 'Inicia sesión para ver tu actividad.'}
            </p>
          )}
        </section>

      </div>
    </main>
  );
}