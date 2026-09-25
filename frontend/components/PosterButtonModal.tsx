'use client';
import { useState, useEffect } from 'react';
import BannerCropModal from './BannerCropModal';

export default function PosterButtonModal({ tmdbId, mediaId, tipo }: { tmdbId: number; mediaId: number; tipo?: string }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tab, setTab] = useState<'caratula' | 'banner'>('caratula');
    const [posters, setPosters] = useState<any[]>([]);
    const [backdrops, setBackdrops] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [imagenParaRecortar, setImagenParaRecortar] = useState<string | null>(null);
    const [cargandoParaRecortar, setCargandoParaRecortar] = useState(false);

    // Cargamos las imágenes al montar el componente, no al hacer clic.
    useEffect(() => {
        const loadImages = async () => {
            try {
                const tipoParam = tipo ? `?tipo=${tipo}` : '';
                const res = await fetch(`http://localhost:3001/tmdb/images/${tmdbId}${tipoParam}`);
                const data = await res.json();
                
                const dedup = (arr: any[]) =>
                    Array.from(new Map(arr.map((img) => [img.file_path, img])).values());
                
                setPosters(dedup(data.posters || []));
                setBackdrops(dedup(data.backdrops || []));
                
                if ((data.posters || []).length === 0 && (data.backdrops || []).length === 0) {
                    setErrorMsg('No se encontraron imágenes en TMDB para este título.');
                }
            } catch (error) {
                console.error("Error cargando imágenes de TMDB", error);
                setErrorMsg('Error de conexión con el servidor');
            }
            setLoading(false);
        };

        loadImages();
    }, [tmdbId, tipo]);

    const seleccionar = async (path: string) => {
        if (tab === 'banner') {
            setCargandoParaRecortar(true);
            const urlOriginal = `https://image.tmdb.org/t/p/original${path}`;
            try {
                const res = await fetch(`http://localhost:3001/proxy-imagen?url=${encodeURIComponent(urlOriginal)}`);
                const data = await res.json();
                if (!res.ok || !data.dataUrl) throw new Error(data.error || 'Error al descargar la imagen');
                setImagenParaRecortar(data.dataUrl);
            } catch (error) {
                console.error('Error preparando la imagen para recortar', error);
                alert('No se pudo cargar esta imagen para recortarla. Prueba con otra.');
            }
            setCargandoParaRecortar(false);
            return;
        }
        const url = `https://image.tmdb.org/t/p/w780${path}`;
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
                body: JSON.stringify({ newPosterUrl: url }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `El servidor respondió ${res.status}`);
            }
            window.location.reload();
        } catch (error) {
            console.error('Error al guardar la carátula', error);
            alert('No se pudo guardar la carátula. Revisa la consola del backend para más detalles.');
        }
    };

    const guardarBannerRecortado = async (dataUrl: string) => {
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Tienes que iniciar sesión para guardar tu banner.');
            return;
        }
        try {
            const res = await fetch(`http://localhost:3001/media/${mediaId}/backdrop`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ newBackdropUrl: dataUrl }),
            });
            if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
            window.location.reload();
        } catch (error) {
            console.error('Error al guardar el banner recortado', error);
            alert('No se pudo guardar el banner. Revisa la consola del backend para más detalles.');
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

    const imagenes = tab === 'caratula' ? posters : backdrops;

    // Si todavía está cargando o el total de imágenes (carátulas + banners) es 1 o 0, NO dibujamos el botón.
    const totalImagenes = posters.length + backdrops.length;
    if (loading || totalImagenes <= 1) return null;

    return (
        <>
            <button
                onClick={() => setIsModalOpen(true)}
                className="w-full mt-3 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
            >
                Cambiar carátula / banner
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

                        <div className="overflow-y-auto p-6">
                            {errorMsg ? (
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
                                            loading="lazy"
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

            {cargandoParaRecortar && (
                <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center">
                    <p className="text-gray-300 text-sm">Preparando imagen...</p>
                </div>
            )}

            {imagenParaRecortar && (
                <BannerCropModal
                    imagenSrc={imagenParaRecortar}
                    onClose={() => setImagenParaRecortar(null)}
                    onSave={guardarBannerRecortado}
                />
            )}
        </>
    );
}