'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import GameCard from '@/components/GameCard';

export default function ListaDetalle() {
  const params = useParams();
  const router = useRouter();
  const listId = params.id;

  const [lista, setLista] = useState<{ id: number; nombre: string; items: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const cargarLista = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetch(`http://localhost:3001/lists/${listId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setLista(null);
        } else {
          setLista(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarLista();
  }, [listId]);

  useEffect(() => {
    if (!confirmandoBorrado) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmandoBorrado(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmandoBorrado]);

  const quitarDeLista = async (mediaId: number) => {
    const token = localStorage.getItem('token');
    if (!token || !lista) return;

    setLista({ ...lista, items: lista.items.filter((i) => i.id !== mediaId) });

    try {
      await fetch(`http://localhost:3001/lists/${listId}/items/${mediaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      cargarLista();
    }
  };

  const eliminarLista = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setBorrando(true);
    try {
      const res = await fetch(`http://localhost:3001/lists/${listId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fallo al borrar');
      router.push('/perfil/lists');
    } catch {
      setBorrando(false);
      setConfirmandoBorrado(false);
      alert('No se ha podido eliminar la lista. Inténtalo de nuevo.');
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Cargando...</main>;
  }

  if (!lista) {
    return (
      <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">
        Lista no encontrada
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Link href="/perfil/lists" className="text-sm text-gray-400 hover:text-white transition">← Mis listas</Link>

        <div className="flex items-center justify-between mt-2 mb-6">
          <h1 className="text-2xl font-extrabold">{lista.nombre}</h1>
          <button
            onClick={() => setConfirmandoBorrado(true)}
            className="text-xs text-gray-500 hover:text-red-400 underline cursor-pointer"
          >
            Eliminar lista
          </button>
        </div>

        {lista.items.length === 0 ? (
          <p className="text-gray-500 text-sm">Esta lista está vacía. Añade títulos desde su ficha con "Add to lists...".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {lista.items.map((item) => (
              <div key={item.id} className="group relative">
                {item.tipo === 'VIDEOJUEGO' ? (
                  <GameCard juego={item} dbId={item.id} customPoster={null} />
                ) : (
                  <MovieCard pelicula={item} dbId={item.id} customPoster={null} />
                )}
                <button
                  onClick={() => quitarDeLista(item.id)}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-white text-xs opacity-0 group-hover:opacity-100 hover:bg-red-500 transition cursor-pointer z-10"
                  title="Quitar de la lista"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmandoBorrado && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => !borrando && setConfirmandoBorrado(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full text-white shadow-2xl p-6"
          >
            <h2 className="text-lg font-bold mb-2">¿Seguro que quieres eliminar esta lista?</h2>
            <p className="text-sm text-gray-400 mb-6">
              Se eliminará "{lista.nombre}" junto con todas las películas que contiene. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmandoBorrado(false)}
                disabled={borrando}
                className="px-4 py-2 rounded text-sm font-bold bg-[#2c3440] hover:bg-gray-600 transition cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={eliminarLista}
                disabled={borrando}
                className="px-4 py-2 rounded text-sm font-bold bg-red-600 hover:bg-red-500 transition cursor-pointer disabled:opacity-50"
              >
                {borrando ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}