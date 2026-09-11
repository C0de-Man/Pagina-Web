'use client';
import { useState, useEffect } from 'react';

export default function BookPosterButtonModal({ mediaId }: { mediaId: number }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [fuente, setFuente] = useState<'googlebooks' | 'mal' | 'comicvine' | null>(null);
  // null = todavía no sabemos si hay imágenes; el botón se queda oculto
  // hasta confirmar que SÍ hay algo que mostrar.
  const [hayImagenes, setHayImagenes] = useState<boolean | null>(null);

  const obtenerImagenes = async (): Promise<{ imgs: string[]; fuenteDetectada: 'googlebooks' | 'mal' | 'comicvine' }> => {
    const resMedia = await fetch(`http://localhost:3001/media/${mediaId}`);
    const media = await resMedia.json();

    if (media.malMangaId) {
      const res = await fetch(`http://localhost:3001/mal/manga/${media.malMangaId}/images`);
      const data = await res.json();
      return { imgs: Array.isArray(data) ? data : [], fuenteDetectada: 'mal' };
    } else if (media.comicVineId) {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/comicvine-images`);
      const data = await res.json();
      return { imgs: Array.isArray(data) ? data : [], fuenteDetectada: 'comicvine' };
    } else {
      const res = await fetch(`http://localhost:3001/googlebooks/editions/${mediaId}`);
      const data = await res.json();
      return { imgs: Array.isArray(data) ? data.map((e: any) => e.portada) : [], fuenteDetectada: 'googlebooks' };
    }
  };

  // Precomprobación silenciosa al montar: si no hay ninguna imagen
  // alternativa, el botón ni se muestra — evita el modal vacío con el aviso
  // de "no se encontraron imágenes" que resultaba confuso.
  useEffect(() => {
    let cancelado = false;
    obtenerImagenes()
      .then(({ imgs, fuenteDetectada }) => {
        // Para cómics de Comic Vine, con una sola imagen no tiene sentido
        // mostrar el selector (sería "elegir" entre una única opción, la
        // misma que ya tienes) — mangas y libros se quedan con el criterio
        // de siempre (basta con que haya al menos una).
        const minimo = fuenteDetectada === 'comicvine' ? 2 : 1;
        if (!cancelado) {
          setFuente(fuenteDetectada);
          setHayImagenes(imgs.length >= minimo);
        }
      })
      .catch(() => {
        if (!cancelado) setHayImagenes(false);
      });
    return () => {
      cancelado = true;
    };
  }, [mediaId]);

  const handleOpen = async () => {
    setIsModalOpen(true);
    setLoading(true);
    setErrorMsg('');
    try {
      const { imgs, fuenteDetectada } = await obtenerImagenes();
      setFuente(fuenteDetectada);
      setImagenes(imgs);
      if (imgs.length === 0) {
        setErrorMsg(
          fuenteDetectada === 'mal'
            ? 'No se encontraron imágenes alternativas para este manga.'
            : fuenteDetectada === 'comicvine'
              ? 'No se encontraron carátulas alternativas para este cómic.'
              : 'No se encontraron otras ediciones de este libro en Google Books.'
        );
      }
    } catch (error) {
      console.error('Error cargando imágenes alternativas', error);
      setErrorMsg('Error de conexión con el servidor');
    }
    setLoading(false);
  };

  const seleccionar = async (portada: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Tienes que iniciar sesión para guardar tu carátula.');
      return;
    }
    try {
      const res = await fetch(`http://localhost:3001/media/${mediaId}/poster`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPosterUrl: portada }),
      });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      window.location.reload();
    } catch (error) {
      console.error('Error al guardar la carátula', error);
      alert('No se pudo guardar la carátula. Revisa la consola del backend para más detalles.');
    }
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  if (!hayImagenes) return null;

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
                {fuente === 'mal' || fuente === 'comicvine' ? 'Otras imágenes' : 'Otras ediciones'} ({imagenes.length})
              </span>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            <div className="overflow-y-auto p-6">
              {loading ? (
                <div className="text-center py-12 text-gray-400">Buscando imágenes alternativas...</div>
              ) : errorMsg ? (
                <div className="text-center py-12 text-red-400">{errorMsg}</div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {imagenes.map((url) => (
                    <img
                      key={url}
                      src={url}
                      onClick={() => seleccionar(url)}
                      className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3] bg-gray-800"
                      alt="Imagen alternativa"
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