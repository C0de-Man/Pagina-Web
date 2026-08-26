'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import GameCard from '@/components/GameCard';

const API_URL = 'http://localhost:3001';

export default function ListaDetallePublica() {
  const params = useParams();
  const router = useRouter();
  const username = params.username as string;
  const listId = params.listId as string;

  const [lista, setLista] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [procesandoLike, setProcesandoLike] = useState(false);

  const cargarLista = () => {
    const token = localStorage.getItem('token');
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    fetch(`${API_URL}/users/${encodeURIComponent(username)}/lists/${listId}`, {
      headers,
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setLista)
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    if (username && listId) cargarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, listId]);

  const alternarLike = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    if (!lista || procesandoLike) return;

    setProcesandoLike(true);
    const yaLeDabaLike = lista.isLiked;
    // Actualización optimista
    setLista({
      ...lista,
      isLiked: !yaLeDabaLike,
      likesCount: lista.likesCount + (yaLeDabaLike ? -1 : 1),
    });

    try {
      await fetch(`${API_URL}/lists/${listId}/like`, {
        method: yaLeDabaLike ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      cargarLista();
    }
    setProcesandoLike(false);
  };

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado || !lista) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">List not found</main>;
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Link href={`/user/${username}/lists`} className="text-sm text-gray-400 hover:text-white transition">
          ← {username}'s Lists
        </Link>

        <div className="flex items-center justify-between mt-2 mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">{lista.nombre}</h1>
            <p className="text-sm text-gray-400">
              by <Link href={`/user/${username}`} className="hover:underline">{lista.autor}</Link>
            </p>
          </div>

          <button
            onClick={alternarLike}
            disabled={procesandoLike}
            className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded transition cursor-pointer disabled:opacity-50 ${
              lista.isLiked
                ? 'bg-pink-900/40 text-pink-300 hover:bg-pink-900/60'
                : 'bg-[#2c3440] text-gray-300 hover:bg-[#3a4552]'
            }`}
          >
            <span>{lista.isLiked ? '♥' : '♡'}</span>
            {lista.likesCount}
          </button>
        </div>

        {lista.items.length === 0 ? (
          <p className="text-gray-500 text-sm">This list is empty.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {lista.items.map((item: any) => (
              <div key={item.id}>
                {item.tipo === 'VIDEOJUEGO' ? (
                  <GameCard juego={item} dbId={item.id} customPoster={item.portada} />
                ) : (
                  <MovieCard pelicula={item} dbId={item.id} customPoster={item.portada} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}