'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AddToListModal({ mediaId }: { mediaId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [lists, setLists] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [creando, setCreando] = useState(false);
  const router = useRouter();

  const cargarListas = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLoading(true);
    fetch(`http://localhost:3001/lists?mediaId=${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then(setLists)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleOpen = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    setIsOpen(true);
    setBusqueda('');
    cargarListas();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filtramos las listas según lo que se va escribiendo en el buscador
  const listasFiltradas = lists.filter((l) =>
    l.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  const toggleLista = async (list: any) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // actualización optimista
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, contieneMedia: !l.contieneMedia } : l)));

    try {
      if (list.contieneMedia) {
        await fetch(`http://localhost:3001/lists/${list.id}/items/${mediaId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await fetch(`http://localhost:3001/lists/${list.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mediaId }),
        });
      }
    } catch {
      // si falla, revertimos
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, contieneMedia: list.contieneMedia } : l)));
    }
  };

  const crearYAñadir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim() || creando) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setCreando(true);
    try {
      const resNueva = await fetch('http://localhost:3001/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nuevoNombre.trim() }),
      });
      const nueva = await resNueva.json();

      await fetch(`http://localhost:3001/lists/${nueva.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mediaId }),
      });

      setNuevoNombre('');
      cargarListas();
    } catch {
      // si falla, no pasa nada, el usuario puede reintentar
    }
    setCreando(false);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full bg-[#2c3440] hover:bg-gray-600 text-white font-bold py-2 rounded text-sm transition cursor-pointer"
      >
        Add to lists...
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-md w-full max-h-[80vh] text-white shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex justify-between items-center gap-3 px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <h2 className="text-lg font-bold whitespace-nowrap">Add to lists</h2>
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Search lists..."
                className="flex-grow min-w-0 bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer flex-shrink-0">✕</button>
            </div>

            <div className="overflow-y-auto p-4 space-y-1">
              {loading ? (
                <p className="text-gray-400 text-sm text-center py-4">Loading lists...</p>
              ) : lists.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">You don't have any lists yet. Create one below.</p>
              ) : listasFiltradas.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No lists match "{busqueda}".</p>
              ) : (
                listasFiltradas.map((list) => (
                  <label
                    key={list.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded hover:bg-gray-800/60 cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!list.contieneMedia}
                        onChange={() => toggleLista(list)}
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                      />
                      <span className="text-sm font-medium">{list.nombre}</span>
                    </div>
                    <span className="text-xs text-gray-500">{list.totalItems}</span>
                  </label>
                ))
              )}
            </div>

            <form onSubmit={crearYAñadir} className="flex gap-2 p-4 border-t border-gray-700 flex-shrink-0">
              <input
                type="text"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="New list..."
                className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              <button
                type="submit"
                disabled={creando || !nuevoNombre.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold px-4 rounded transition cursor-pointer"
              >
                Create
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}