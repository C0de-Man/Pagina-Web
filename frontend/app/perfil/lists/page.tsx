'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function MisListas() {
  const [lists, setLists] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [creando, setCreando] = useState(false);

  const [listaABorrar, setListaABorrar] = useState<{ id: number; nombre: string } | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cargarListas = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('http://localhost:3001/lists', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then(setLists)
      .catch(() => {});
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);
    cargarListas();
  }, []);

  useEffect(() => {
    if (!isModalOpen && !listaABorrar) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
        if (!borrando) setListaABorrar(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, listaABorrar, borrando]);

  const crearLista = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim() || creando) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setCreando(true);
    try {
      await fetch('http://localhost:3001/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nuevoNombre.trim() }),
      });
      setNuevoNombre('');
      setIsModalOpen(false);
      cargarListas();
    } catch {
      // el usuario puede reintentar
    }
    setCreando(false);
  };

  const confirmarBorrado = async () => {
    if (!listaABorrar) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const id = listaABorrar.id;
    setBorrando(true);

    try {
      const res = await fetch(`http://localhost:3001/lists/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fallo al borrar');
      setLists((prev) => prev.filter((l) => l.id !== id));
      setListaABorrar(null);
    } catch {
      alert('Could not delete the list. Please try again.');
    }
    setBorrando(false);
  };

  const listasFiltradas = lists.filter((l) =>
    l.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">My Lists</h1>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Sign in</Link> to see your lists.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-8">
              <input
                type="text"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Search lists..."
                className="flex-grow max-w-md bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
              >
                Create list
              </button>
            </div>

            {lists.length === 0 ? (
              <p className="text-gray-500 text-sm">You don't have any lists yet. Create the first one above.</p>
            ) : listasFiltradas.length === 0 ? (
              <p className="text-gray-500 text-sm">No lists match "{busqueda}".</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {listasFiltradas.map((list) => (
                  <div
                    key={list.id}
                    className="relative group bg-[#1c2228] rounded-lg border border-gray-700 hover:border-gray-500 transition overflow-hidden h-28"
                  >
                    <Link href={`/perfil/lists/${list.id}`} className="flex items-center h-full">
                      {list.portadas && list.portadas.length > 0 && (
                        <div className="flex -space-x-8 h-full flex-shrink-0 pl-1">
                          {list.portadas.map((src: string, i: number) => (
                            <img
                              key={i}
                              src={src}
                              alt=""
                              className="h-full aspect-[2/3] object-cover rounded border-2 border-[#1c2228] shadow-lg"
                              style={{ zIndex: list.portadas.length - i }}
                            />
                          ))}
                        </div>
                      )}

                      <div className="flex flex-col justify-between h-full flex-grow min-w-0 items-end text-right p-4">
                        <h2 className="font-bold text-white truncate max-w-full">{list.nombre}</h2>
                        <p className="text-xs text-gray-400">
                          {list.totalItems} {list.totalItems === 1 ? 'title' : 'titles'}
                        </p>
                      </div>
                    </Link>

                    <button
                      onClick={() => setListaABorrar({ id: list.id, nombre: list.nombre })}
                      className="absolute top-2 right-2 text-gray-500 hover:text-red-400 transition cursor-pointer opacity-0 group-hover:opacity-100 bg-black/40 rounded-full w-6 h-6 flex items-center justify-center"
                      title="Delete list"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full text-white shadow-2xl p-6"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">New list</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>
            <form onSubmit={crearLista} className="flex gap-2">
              <input
                type="text"
                autoFocus
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="List name..."
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

      {listaABorrar && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => !borrando && setListaABorrar(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-sm w-full text-white shadow-2xl p-6"
          >
            <h2 className="text-lg font-bold mb-2">Are you sure you want to delete this list?</h2>
            <p className="text-sm text-gray-400 mb-6">
              "{listaABorrar.nombre}" will be deleted along with everything in it. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setListaABorrar(null)}
                disabled={borrando}
                className="px-4 py-2 rounded text-sm font-bold bg-[#2c3440] hover:bg-gray-600 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmarBorrado}
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