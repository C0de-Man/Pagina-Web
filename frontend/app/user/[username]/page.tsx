'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

interface PerfilPublico {
  id: number;
  username: string;
  avatar: string | null;
  miembroDesde: string;
  followersCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean | null;
  favoritos: any[];
  actividad: any[];
  jugandoAhora: any[];
}

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

export default function PerfilPublicoPage() {
  const params = useParams();
  const username = params.username as string;

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [procesandoFollow, setProcesandoFollow] = useState(false);
  const JUGANDO_AHORA_VISIBLES = 7;
  const [jugandoAhoraInicio, setJugandoAhoraInicio] = useState(0);

  const cargarPerfil = () => {
    const token = localStorage.getItem('token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(`${API_URL}/users/${encodeURIComponent(username)}`, {
      headers,
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setPerfil)
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    if (username) cargarPerfil();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const toggleSeguir = async () => {
    if (!perfil || procesandoFollow) return;
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    setProcesandoFollow(true);
    const siguiendoAntes = perfil.isFollowing;
    // Actualización optimista
    setPerfil({
      ...perfil,
      isFollowing: !siguiendoAntes,
      followersCount: perfil.followersCount + (siguiendoAntes ? -1 : 1),
    });

    try {
      await fetch(`${API_URL}/users/${perfil.id}/follow`, {
        method: siguiendoAntes ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // si falla, revertimos
      setPerfil((prev) => prev && { ...prev, isFollowing: siguiendoAntes, followersCount: prev.followersCount });
      cargarPerfil();
    }
    setProcesandoFollow(false);
  };

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

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado || !perfil) {
    return (
      <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">
        User not found
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-blue-600 flex-shrink-0">
                <img
                  src={perfil.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${perfil.username}`}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-extrabold">{perfil.username}</h1>
                <div className="flex gap-4 text-sm text-gray-400 mt-1">
                  <span>{perfil.followersCount} follower{perfil.followersCount === 1 ? '' : 's'}</span>
                  <span>{perfil.followingCount} following</span>
                </div>
              </div>
            </div>

            {!perfil.isSelf && (
              <button
                onClick={toggleSeguir}
                disabled={procesandoFollow}
                className={`text-sm font-bold px-5 py-2 rounded transition cursor-pointer disabled:opacity-50 ${
                  perfil.isFollowing
                    ? 'bg-[#2c3440] text-gray-300 hover:bg-red-900/40 hover:text-red-300'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {perfil.isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <div className="flex gap-8 mt-6 border-b border-gray-800 -mb-8 pb-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <span className="pb-3 text-sm font-semibold text-white border-b-2 border-blue-500 whitespace-nowrap">Profile</span>
            <Link href={`/user/${username}/movies`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Films</Link>
            <Link href={`/user/${username}/series`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Series</Link>
            <Link href={`/user/${username}/games`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Played</Link>
            <Link href={`/user/${username}/books`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Books</Link>
            <Link href={`/user/${username}/lists`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Lists</Link>
            <Link href={`/user/${username}/reviews`} className="pb-3 text-sm font-semibold text-gray-400 hover:text-white transition whitespace-nowrap">Reviews</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Favorites</h2>
          {perfil.favoritos.length > 0 ? (
            <div className="flex flex-wrap gap-4 pb-2">
              {perfil.favoritos.map((item) => renderCard(item, false))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No favorites yet.</p>
          )}
        </section>

        {/* Solo se muestra si hay algún juego en curso — un dueño de perfil
            sin ningún "Playing" no debería ver una sección vacía aquí. */}
        {perfil.jugandoAhora.length > 0 && (
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
                {perfil.jugandoAhora
                  .slice(jugandoAhoraInicio, jugandoAhoraInicio + JUGANDO_AHORA_VISIBLES)
                  .map((item) => renderCard(item, false))}
              </div>

              <button
                onClick={() =>
                  setJugandoAhoraInicio((i) =>
                    Math.min(perfil.jugandoAhora.length - JUGANDO_AHORA_VISIBLES, i + JUGANDO_AHORA_VISIBLES)
                  )
                }
                disabled={jugandoAhoraInicio + JUGANDO_AHORA_VISIBLES >= perfil.jugandoAhora.length}
                aria-label="Scroll right"
                className="flex-shrink-0 text-2xl text-gray-500 hover:text-white disabled:opacity-20 disabled:hover:text-gray-500 transition cursor-pointer px-1"
              >
                ›
              </button>
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4">Recent activity</h2>
          {perfil.actividad.length > 0 ? (
            <div className="flex flex-wrap gap-4 pb-2">
              {perfil.actividad.slice(0, 7).map((item) => renderCard(item, true))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No activity yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}