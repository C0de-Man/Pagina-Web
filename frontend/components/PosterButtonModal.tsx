'use client';
import { useState } from 'react';

export default function PosterButtonModal({ tmdbId, mediaId }: { tmdbId: number; mediaId: number }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [posters, setPosters] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const loadPosters = async () => {
        setLoading(true);
        setErrorMsg('');
        try {
            const res = await fetch(`http://localhost:3001/tmdb/images/${tmdbId}`);
            const data = await res.json();

            if (Array.isArray(data)) {
                // AQUÍ QUITAMOS EL LÍMITE: ahora guardamos todos los pósters sin recortar
                setPosters(data);
            } else {
                setErrorMsg('No se encontraron pósters en TMDB');
            }
        } catch (error) {
            console.error("Error cargando pósters", error);
            setErrorMsg('Error de conexión con el servidor');
        }
        setLoading(false);
    };

    const handleOpen = () => {
        setIsModalOpen(true);
        loadPosters();
    };

    const selectPoster = async (path: string) => {
        const newUrl = `https://image.tmdb.org/t/p/w500${path}`;
        await fetch(`http://localhost:3001/media/${mediaId}/poster`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPosterUrl: newUrl })
        });
        window.location.reload();
    };

    return (
        <>
            <button
                onClick={handleOpen}
                className="w-full mt-3 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
            >
                Cambiar póster
            </button>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg max-w-4xl w-full max-h-[85vh] overflow-y-auto text-white shadow-2xl">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3 sticky top-0 bg-gray-900 z-10">
                            <h2 className="text-xl font-bold">
                                Elige un póster <span className="text-sm font-normal text-gray-400 ml-2">({posters.length} opciones)</span>
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
                        </div>

                        {loading ? (
                            <div className="text-center py-12 text-gray-400">Cargando pósters desde TMDB...</div>
                        ) : errorMsg ? (
                            <div className="text-center py-12 text-red-400">{errorMsg}</div>
                        ) : posters.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">No hay pósters disponibles para este título.</div>
                        ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                                {posters.map((p) => (
                                    <img
                                        key={p.file_path}
                                        src={`https://image.tmdb.org/t/p/w300${p.file_path}`}
                                        onClick={() => selectPoster(p.file_path)}
                                        className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3] bg-gray-800"
                                        alt="Poster option"
                                        loading="lazy" // MUY IMPORTANTE: Evita que el navegador se congele al cargar cientos de imágenes
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}