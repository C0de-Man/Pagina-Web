'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';
import ReviewDetailModal from '@/components/ReviewDetailModal';

const API_URL = 'http://localhost:3001';

function Estrellas({ rating }: { rating: number }) {
  const sobreCinco = rating / 2;
  const llenas = Math.floor(sobreCinco);
  const media = sobreCinco - llenas >= 0.5;
  return (
    <span className="text-yellow-400 text-sm tracking-tight">
      {'★'.repeat(llenas)}
      {media && '½'}
    </span>
  );
}

function formatFecha(fecha: string) {
  return new Date(fecha).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

const ETIQUETA_TIPO: Record<string, string> = {
  PELICULA: 'Film',
  SERIE: 'Series',
  VIDEOJUEGO: 'Game',
};

export default function ResenasDeUsuario() {
  const params = useParams();
  const username = params.username as string;

  const [resenas, setResenas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [resenaAbierta, setResenaAbierta] = useState<any>(null);
  // Solo se puede editar si el perfil que se está viendo es el tuyo propio
  // — comparado sin distinguir mayúsculas/minúsculas, igual que ya hace el
  // backend al buscar el usuario por username.
  const [esMiPerfil, setEsMiPerfil] = useState(false);

  useEffect(() => {
    const rawUser = localStorage.getItem('user');
    if (!rawUser || !username) return;
    try {
      const miUsername = JSON.parse(rawUser).username;
      setEsMiPerfil(typeof miUsername === 'string' && miUsername.toLowerCase() === username.toLowerCase());
    } catch {
      // si el localStorage viene corrupto por lo que sea, mejor no dejar editar
    }
  }, [username]);

  useEffect(() => {
    if (!username) return;

    fetch(`${API_URL}/users/${encodeURIComponent(username)}/reviews`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data) => setResenas(Array.isArray(data) ? data : []))
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [username]);

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">User not found</main>;
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-1">Reviews</h1>
        <p className="text-sm text-gray-400 mb-6">
          <Link href={`/user/${username}`} className="hover:underline">{username}</Link>
        </p>

        {resenas.length === 0 ? (
          <p className="text-gray-500 text-sm">{username} hasn't written any reviews yet.</p>
        ) : (
          <div className="space-y-6">
            {resenas.map((r) => (
              <div
                key={r.logId}
                onClick={() => setResenaAbierta(r)}
                className="flex gap-4 bg-[#1c2228] border border-gray-800 rounded-lg p-4 cursor-pointer hover:border-gray-600 transition"
              >
                <Link href={urlFicha(r)} onClick={(e) => e.stopPropagation()} className="flex-shrink-0 w-20">
                  {r.portada ? (
                    <img
                      src={r.portada}
                      alt={r.titulo}
                      className="w-20 aspect-[2/3] object-cover rounded border border-gray-700"
                    />
                  ) : (
                    <div className="w-20 aspect-[2/3] bg-gray-800 rounded border border-gray-700 flex items-center justify-center text-[10px] text-center p-1">
                      {r.titulo}
                    </div>
                  )}
                </Link>

                <div className="flex-grow min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <Link href={urlFicha(r)} onClick={(e) => e.stopPropagation()} className="font-bold text-white hover:underline">
                      {r.titulo}
                    </Link>
                    <span className="text-gray-500 text-sm">{r.anio}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">
                      {ETIQUETA_TIPO[r.tipo] || r.tipo}
                    </span>
                    {r.rewatch && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">
                        Rewatch
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    {r.rating != null && <Estrellas rating={r.rating} />}
                    {r.liked && <span className="text-pink-500 text-sm">♥</span>}
                    <span className="text-gray-500 text-xs">{formatFecha(r.fecha)}</span>
                    {r.logNombre && <span className="text-gray-600 text-xs">· {r.logNombre}</span>}
                  </div>

                  <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{r.review}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReviewDetailModal resena={resenaAbierta} onClose={() => setResenaAbierta(null)} puedeEditar={esMiPerfil} />
    </main>
  );
}