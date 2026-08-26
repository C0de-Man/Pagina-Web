'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MovieCard from '@/components/MovieCard';
import GameCard from '@/components/GameCard';

const API_URL = 'http://localhost:3001';

const OPCIONES_ORDEN = [
  { valor: 'MANUAL', label: 'User Order' },
  { valor: 'NOMBRE', label: 'Name' },
  { valor: 'FECHA', label: 'Date Added' },
  { valor: 'NOTA_MEDIA', label: 'Average Rating' },
  { valor: 'MI_NOTA', label: 'My Rating' },
];

export default function ListaDetalle() {
  const params = useParams();
  const router = useRouter();
  const listId = params.id;

  const [lista, setLista] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const [editando, setEditando] = useState(false);
  const [nombreEdit, setNombreEdit] = useState('');
  const [privadaEdit, setPrivadaEdit] = useState(false);
  const [modoEdit, setModoEdit] = useState<'RANKED' | 'GRID'>('GRID');
  const [ordenPorEdit, setOrdenPorEdit] = useState('MANUAL');
  const [ordenDireccionEdit, setOrdenDireccionEdit] = useState<'ASC' | 'DESC'>('DESC');
  const [guardandoMetadatos, setGuardandoMetadatos] = useState(false);

  const [arrastrando, setArrastrando] = useState<number | null>(null);

  const cargarLista = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetch(`${API_URL}/lists/${listId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setLista(null);
        } else {
          setLista(data);
          setNombreEdit(data.nombre);
          setPrivadaEdit(data.privada);
          setModoEdit(data.modo);
          setOrdenPorEdit(data.ordenPor);
          setOrdenDireccionEdit(data.ordenDireccion);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargarLista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    setLista({ ...lista, items: lista.items.filter((i: any) => i.id !== mediaId) });

    try {
      await fetch(`${API_URL}/lists/${listId}/items/${mediaId}`, {
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
      const res = await fetch(`${API_URL}/lists/${listId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fallo al borrar');
      router.push('/perfil/lists');
    } catch {
      setBorrando(false);
      setConfirmandoBorrado(false);
      alert('Could not delete the list. Please try again.');
    }
  };

  const guardarMetadatos = async () => {
    const token = localStorage.getItem('token');
    if (!token || !nombreEdit.trim()) return;

    setGuardandoMetadatos(true);
    try {
      await fetch(`${API_URL}/lists/${listId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          nombre: nombreEdit.trim(),
          privada: privadaEdit,
          modo: modoEdit,
          ordenPor: ordenPorEdit,
          ordenDireccion: ordenDireccionEdit,
        }),
      });
      cargarLista();
    } catch {
      alert('Could not save changes. Please try again.');
    }
    setGuardandoMetadatos(false);
  };

  // --- Arrastrar y soltar para reordenar a mano ---
  const onDragStart = (index: number) => setArrastrando(index);

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (arrastrando === null || arrastrando === index || !lista) return;
    const items = [...lista.items];
    const [movido] = items.splice(arrastrando, 1);
    items.splice(index, 0, movido);
    setLista({ ...lista, items });
    setArrastrando(index);
  };

  const onDragEnd = async () => {
    setArrastrando(null);
    if (!lista) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setOrdenPorEdit('MANUAL'); // el backend también lo cambia a MANUAL al reordenar
    try {
      await fetch(`${API_URL}/lists/${listId}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listItemIds: lista.items.map((i: any) => i.listItemId) }),
      });
    } catch {
      cargarLista();
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (!lista) {
    return (
      <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">
        List not found
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Link href="/perfil/lists" className="text-sm text-gray-400 hover:text-white transition">← My Lists</Link>

        {!editando ? (
          <div className="flex items-center justify-between mt-2 mb-6">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold">{lista.nombre}</h1>
              {lista.privada && <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">Private</span>}
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEditando(true)}
                className="text-sm text-blue-400 hover:text-blue-300 font-semibold cursor-pointer"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmandoBorrado(true)}
                className="text-xs text-gray-500 hover:text-red-400 underline cursor-pointer"
              >
                Delete list
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 mb-6 bg-[#1c2228] border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-blue-400">Editing your list</h2>
              <button
                onClick={() => setConfirmandoBorrado(true)}
                className="text-xs text-gray-500 hover:text-red-400 underline cursor-pointer"
              >
                Delete List
              </button>
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-grow min-w-[180px]">
                <label className="text-xs text-gray-400 uppercase tracking-wider">Title</label>
                <input
                  type="text"
                  value={nombreEdit}
                  onChange={(e) => setNombreEdit(e.target.value)}
                  className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 mt-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider block mb-1">Mode</label>
                <div className="flex gap-3 bg-[#2c3440] border border-gray-700 rounded px-3 py-2">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={modoEdit === 'RANKED'}
                      onChange={() => setModoEdit('RANKED')}
                      className="cursor-pointer"
                    />
                    Ranked
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      checked={modoEdit === 'GRID'}
                      onChange={() => setModoEdit('GRID')}
                      className="cursor-pointer"
                    />
                    Grid
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider">Privacy</label>
                <select
                  value={privadaEdit ? 'private' : 'public'}
                  onChange={(e) => setPrivadaEdit(e.target.value === 'private')}
                  className="w-full bg-[#2c3440] border border-gray-700 rounded px-3 py-2 mt-1 text-sm text-white focus:outline-none"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wider">Default Sorting</label>
                <div className="flex gap-2 mt-1">
                  <select
                    value={ordenPorEdit}
                    onChange={(e) => setOrdenPorEdit(e.target.value)}
                    className="bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    {OPCIONES_ORDEN.map((o) => (
                      <option key={o.valor} value={o.valor}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    value={ordenDireccionEdit}
                    onChange={(e) => setOrdenDireccionEdit(e.target.value as 'ASC' | 'DESC')}
                    className="bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="ASC">ASC</option>
                    <option value="DESC">DESC</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => setEditando(false)}
                  className="bg-[#2c3440] hover:bg-gray-600 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
                >
                  View List
                </button>
                <button
                  onClick={guardarMetadatos}
                  disabled={guardandoMetadatos || !nombreEdit.trim()}
                  className="bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
                >
                  {guardandoMetadatos ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

            {ordenPorEdit === 'MANUAL' && (
              <p className="text-xs text-gray-500 mt-3">Drag and drop the covers below to reorder them by hand.</p>
            )}
          </div>
        )}

        {lista.items.length === 0 ? (
          <p className="text-gray-500 text-sm">This list is empty. Add titles from their page using "Add to lists...".</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {lista.items.map((item: any, index: number) => (
              <div
                key={item.id}
                draggable={editando}
                onDragStart={() => onDragStart(index)}
                onDragOver={(e) => onDragOver(e, index)}
                onDragEnd={onDragEnd}
                className={`group relative ${editando ? 'cursor-move' : ''} ${arrastrando === index ? 'opacity-40' : ''}`}
              >
                {lista.modo === 'RANKED' && (
                  <div className="absolute -top-2 -left-2 z-10 w-7 h-7 rounded-full bg-pink-600 text-white text-xs font-bold flex items-center justify-center shadow-lg">
                    {index + 1}
                  </div>
                )}
                {item.tipo === 'VIDEOJUEGO' ? (
                  <GameCard juego={item} dbId={item.id} customPoster={item.portada} />
                ) : (
                  <MovieCard pelicula={item} dbId={item.id} customPoster={item.portada} />
                )}
                {!editando && (
                  <button
                    onClick={() => quitarDeLista(item.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-white text-xs opacity-0 group-hover:opacity-100 hover:bg-red-500 transition cursor-pointer z-10"
                    title="Remove from list"
                  >
                    ✕
                  </button>
                )}
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
            <h2 className="text-lg font-bold mb-2">Are you sure you want to delete this list?</h2>
            <p className="text-sm text-gray-400 mb-6">
              "{lista.nombre}" will be deleted along with everything in it. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmandoBorrado(false)}
                disabled={borrando}
                className="px-4 py-2 rounded text-sm font-bold bg-[#2c3440] hover:bg-gray-600 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={eliminarLista}
                disabled={borrando}
                className="px-4 py-2 rounded text-sm font-bold bg-red-600 hover:bg-red-500 transition cursor-pointer disabled:opacity-50"
              >
                {borrando ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}