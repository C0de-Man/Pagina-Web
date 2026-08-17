'use client';
import { useState, useEffect } from 'react';

export default function PosterButtonModal({ tmdbId, mediaId }: { tmdbId: number; mediaId: number }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tab, setTab] = useState<'caratula' | 'banner'>('caratula');
    const [posters, setPosters] = useState<any[]>([]);
    const [backdrops, setBackdrops] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const loadImages = async () => {
        setLoading(true);
        setErrorMsg('');
        try {
            const res = await fetch(`http://localhost:3001/tmdb/images/${tmdbId}`);
            const data = await res.json();
            setPosters(data.posters || []);
            setBackdrops(data.backdrops || []);
            if ((data.posters || []).length === 0 && (data.backdrops || []).length === 0) {
                setErrorMsg('No se encontraron imágenes en TMDB para este título.');
            }
        } catch (error) {
            console.error("Error cargando imágenes de TMDB", error);
            setErrorMsg('Error de conexión con el servidor');
        }
        setLoading(false);
    };

    const handleOpen = () => {
        setIsModalOpen(true);
        loadImages();
    };

    const seleccionar = async (path: string) => {
        const campo = tab === 'caratula' ? 'newPosterUrl' : 'newBackdropUrl';
        const ruta = tab === 'caratula' ? 'poster' : 'backdrop';
        const size = tab === 'caratula' ? 'w500' : 'w1280';
        const url = `https://image.tmdb.org/t/p/${size}${path}`;
        await fetch(`http://localhost:3001/media/${mediaId}/${ruta}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [campo]: url }),
        });
        window.location.reload();
    };

    // Cerrar con la tecla ESC mientras el modal está abierto
    useEffect(() => {
        if (!isModalOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsModalOpen(false);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen]);

    const imagenes = tab === 'caratula' ? posters : backdrops;

    return (
        <>
            <button
                onClick={handleOpen}
                className="w-full mt-3 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
            >
                Cambiar carátula / banner
            </button>

            {isModalOpen && (
                // Clic fuera del recuadro (en el fondo oscuro) cierra el modal
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        // Evitamos que un clic DENTRO del recuadro se propague y lo cierre
                        onClick={(e) => e.stopPropagation()}
                        className="bg-gray-900 border border-gray-700 rounded-lg max-w-4xl w-full max-h-[85vh] text-white shadow-2xl flex flex-col overflow-hidden"
                    >
                        {/* Cabecera fija con pestañas, fuera de la zona con scroll */}
                        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 flex-shrink-0">
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setTab('caratula')}
                                    className={`text-sm font-bold uppercase tracking-wider pb-1 border-b-2 transition cursor-pointer ${tab === 'caratula' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent'}`}
                                >
                                    Carátula ({posters.length})
                                </button>
                                <button
                                    onClick={() => setTab('banner')}
                                    className={`text-sm font-bold uppercase tracking-wider pb-1 border-b-2 transition cursor-pointer ${tab === 'banner' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent'}`}
                                >
                                    Banner ({backdrops.length})
                                </button>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
                        </div>

                        {/* Zona con scroll, separada de la cabecera */}
                        <div className="overflow-y-auto p-6">
                            {loading ? (
                                <div className="text-center py-12 text-gray-400">Cargando imágenes desde TMDB...</div>
                            ) : errorMsg ? (
                                <div className="text-center py-12 text-red-400">{errorMsg}</div>
                            ) : imagenes.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">No hay imágenes disponibles en esta categoría.</div>
                            ) : tab === 'caratula' ? (
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                                    {imagenes.map((img) => (
                                        <img
                                            key={img.file_path}
                                            src={`https://image.tmdb.org/t/p/w300${img.file_path}`}
                                            onClick={() => seleccionar(img.file_path)}
                                            className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3] bg-gray-800"
                                            alt="Opción de carátula"
                                            loading="lazy" // Evita que el navegador se congele al cargar cientos de imágenes
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {imagenes.map((img) => (
                                        <img
                                            key={img.file_path}
                                            src={`https://image.tmdb.org/t/p/w780${img.file_path}`}
                                            onClick={() => seleccionar(img.file_path)}
                                            className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-video bg-gray-800"
                                            alt="Opción de banner"
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