'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';

// Convierte la nota guardada (escala 1-10) a estrellas visuales sobre 5,
// con soporte de media estrella — igual que Letterboxd.
function Estrellas({ rating }: { rating: number }) {
  const sobreCinco = rating / 2;
  const llenas = Math.floor(sobreCinco);
  const media = sobreCinco - llenas >= 0.5;

  return (
    <span className="text-yellow-400 text-xs tracking-tight">
      {'★'.repeat(llenas)}
      {media && '½'}
    </span>
  );
}

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

export default function Perfil() {
  const [favoritos, setFavoritos] = useState<any[]>([]);
  const [vistas, setVistas] = useState<any[]>([]);
  const [jugandoAhora, setJugandoAhora] = useState<any[]>([]);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [logueado, setLogueado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // Igual que CarruselJuegos en GameTabs.tsx: en vez de scroll continuo (que
  // cortaba la última carátula a medias), se muestra un bloque fijo de
  // carátulas COMPLETAS y las flechas cambian de bloque entero.
  const JUGANDO_AHORA_VISIBLES = 7;
  const [jugandoAhoraInicio, setJugandoAhoraInicio] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');
    if (rawUser) setUsername(JSON.parse(rawUser).username);

    if (token) {
      setLogueado(true);

      fetch('http://localhost:3001/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          setUsername(data.username);
          setAvatar(data.avatar || null);
        })
        .catch(() => {});

      fetch('http://localhost:3001/favorites', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((res) => res.json())
        .then(setFavoritos)
        .catch(() => {});

      fetch('http://localhost:3001/media/watched', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((res) => res.json())
        .then(setVistas)
        .catch(() => {});

      fetch('http://localhost:3001/media/playing', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
        .then((res) => res.json())
        .then(setJugandoAhora)
        .catch(() => {});
    }
  }, []);

  // Copia el enlace público y compartible del perfil (/user/NOMBRE) al
  // portapapeles. Ese, y no /perfil, es el que tiene sentido pasarle a otra
  // persona: /perfil es tu vista privada de edición, sin nombre en la URL.
  const compartirPerfil = async () => {
    if (!username) return;
    const url = `${window.location.origin}/user/${username}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Si el navegador bloquea el portapapeles (p. ej. sin HTTPS en algunos
      // casos), al menos mostramos el enlace para copiarlo a mano.
      window.prompt('Copy your profile link:', url);
    }
  };

  // mostrarFooter: activa el pie estilo Letterboxd (estrellas/corazón/fecha)
  // debajo de la carátula — solo tiene sentido para "Actividad reciente"
  // (favoritos no tiene nota ni fecha de visto).
  const renderCard = (item: any, mostrarFooter = false) => (
    <div key={item.id} className="flex-shrink-0 w-28 md:w-32">
      <Link href={urlFicha(item)} className="group relative block">
        {item.portada ? (
          <img
            src={item.portada}
            alt={item.titulo}
            className="w-28 h-40 md:w-32 md:h-48 object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition duration-300 shadow-lg"
          />
        ) : (
          <div className="w-28 h-40 md:w-32 md:h-48 bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2 group-hover:border-gray-400 transition shadow-lg">
            {item.titulo}
          </div>
        )}
        <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
          <p className="text-sm font-bold text-white">
            {item.titulo} <span className="font-normal text-gray-300">({item.anio})</span>
          </p>
        </div>
      </Link>

      {mostrarFooter && (
        <div className="flex items-center justify-between mt-1 px-0.5">
          <div className="flex items-center gap-1">
            {item.rating != null && <Estrellas rating={item.rating} />}
            {item.liked && <span className="text-pink-500 text-xs">♥</span>}
          </div>
          {item.fechaVisto && (
            <span className="text-[11px] text-gray-500">{formatFecha(item.fechaVisto)}</span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-blue-600 flex-shrink-0">
                <img
                  src={avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'Miguel'}`}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold">{username || 'Guest'}</h1>
            </div>

            {logueado && (
              <button
                onClick={compartirPerfil}
                className="text-sm font-bold px-4 py-2 rounded transition cursor-pointer bg-[#2c3440] text-gray-300 hover:bg-[#3a4552] hover:text-white"
              >
                {copiado ? 'Link copied!' : 'Share profile'}
              </button>
            )}
          </div>

          <div className="flex gap-8 mt-6 border-b border-gray-800 -mb-8 pb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <span className="pb-3 text-sm font-semibold text-white border-b-2 border-blue-500 whitespace-nowrap">Profile</span>
            <Link href="/perfil/movies" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Films</Link>
            <Link href="/perfil/series" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Series</Link>
            <Link href="/perfil/games" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Played</Link>
            <Link href="/books" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Books</Link>
            <Link href="/perfil/lists" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Lists</Link>
            <Link href="/perfil/reviews" className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Reviews</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">

        {!logueado && (
          <div className="bg-blue-900/30 border border-blue-800 text-blue-200 text-sm rounded px-4 py-3">
            <Link href="/login" className="underline font-semibold">Sign in</Link> to see your real activity.
          </div>
        )}

        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Favorites</h2>
            <Link href="/perfil/settings" className="text-xs text-gray-400 hover:text-white transition">Edit</Link>
          </div>
          {favoritos.length > 0 ? (
            <div className="flex flex-wrap gap-4 pb-2">
              {favoritos.map((item) => renderCard(item, false))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              {logueado ? (
                <>You don't have any favorites yet. <Link href="/perfil/settings" className="underline">Choose them here</Link>.</>
              ) : (
                'Sign in to see your favorites.'
              )}
            </p>
          )}
        </section>

        {/* Solo se muestra si tienes algún juego en curso ahora mismo. */}
        {jugandoAhora.length > 0 && (
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Currently Playing</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setJugandoAhoraInicio((i) => Math.max(0, i - JUGANDO_AHORA_VISIBLES))}
                disabled={jugandoAhoraInicio === 0}
                aria-label="Scroll left"
                className="flex-shrink-0 text-2xl text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:text-gray-500 transition cursor-pointer px-1"
              >
                ‹
              </button>

              <div className="flex gap-4 flex-1">
                {jugandoAhora
                  .slice(jugandoAhoraInicio, jugandoAhoraInicio + JUGANDO_AHORA_VISIBLES)
                  .map((item) => renderCard(item, false))}
              </div>

              <button
                onClick={() =>
                  setJugandoAhoraInicio((i) => Math.min(jugandoAhora.length - JUGANDO_AHORA_VISIBLES, i + JUGANDO_AHORA_VISIBLES))
                }
                disabled={jugandoAhoraInicio + JUGANDO_AHORA_VISIBLES >= jugandoAhora.length}
                aria-label="Scroll right"
                className="flex-shrink-0 text-2xl text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:text-gray-500 transition cursor-pointer px-1"
              >
                ›
              </button>
            </div>
          </section>
        )}

        <section>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Recent activity</h2>
            <Link href="/perfil/actividad" className="text-xs text-gray-400 hover:text-white transition flex items-center gap-1">
              See all <span className="text-sm leading-none">›</span>
            </Link>
          </div>
          {vistas.length > 0 ? (
            <div className="flex flex-wrap gap-4 pb-2">
              {vistas.slice(0, 7).map((item) => renderCard(item, true))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              {logueado ? "You haven't marked anything as watched yet." : 'Sign in to see your activity.'}
            </p>
          )}
        </section>

      </div>
    </main>
  );
}