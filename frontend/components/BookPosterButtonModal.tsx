'use client';
import { useState, useEffect } from 'react';

export default function BookPosterButtonModal({ mediaId }: { mediaId: number }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [ediciones, setEdiciones] = useState<{ googleBooksId: string; portada: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadEditions = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`http://localhost:3001/googlebooks/editions/${mediaId}`);
      const data = await res.json();
      setEdiciones(Array.isArray(data) ? data : []);
      if (!Array.isArray(data) || data.length === 0) {
        setErrorMsg('No se encontraron otras ediciones de este libro en Google Books.');
      }
    } catch (error) {
      console.error('Error cargando ediciones de Google Books', error);
      setErrorMsg('Error de conexión con el servidor');
    }
    setLoading(false);
  };

  const handleOpen = () => {
    setIsModalOpen(true);
    loadEditions();
  };

  const seleccionar = async (portada: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Tienes que iniciar sesión para guardar tu carátula.');
      return;
    }
    // Mismo endpoint genérico que ya usa PosterButtonModal — solo guarda
    // la URL, sin importar de qué fuente venga.
    await fetch(`http://localhost:3001/media/${mediaId}/poster`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newPosterUrl: portada }),
    });
    window.location.reload();
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  return (
    <>
      <button
        onClick={handleOpen}
        className="w-full mt-3 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
      >
        Cambiar carátula
      </button>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-4xl w-full max-h-[85vh] text-white shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <span className="text-sm font-bold uppercase tracking-wider text-white">
                Otras ediciones ({ediciones.length})
              </span>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            <div className="overflow-y-auto p-6">
              <p className="text-xs text-gray-500 mb-4">
                Google Books no tiene un catálogo de carátulas alternativas — estas son las portadas de otras ediciones (idioma, año, editorial) del mismo título que hemos encontrado.
              </p>
              {loading ? (
                <div className="text-center py-12 text-gray-400">Buscando otras ediciones...</div>
              ) : errorMsg ? (
                <div className="text-center py-12 text-red-400">{errorMsg}</div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {ediciones.map((e) => (
                    <img
                      key={e.googleBooksId}
                      src={e.portada}
                      onClick={() => seleccionar(e.portada)}
                      className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3] bg-gray-800"
                      alt="Edición alternativa"
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}