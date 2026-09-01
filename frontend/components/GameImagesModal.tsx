'use client';
import { useState, useEffect } from 'react';
import BannerCropModal from './BannerCropModal';

export default function GameImagesModal({ mediaId }: { mediaId: number }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tab, setTab] = useState<'caratula' | 'banner'>('caratula');
    const [covers, setCovers] = useState<string[]>([]);
    const [heroes, setHeroes] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    // Imagen (banner) pendiente de recortar antes de guardar — null = no hay
    // ningún recorte en marcha.
    const [imagenParaRecortar, setImagenParaRecortar] = useState<string | null>(null);
    const [cargandoParaRecortar, setCargandoParaRecortar] = useState(false);

    const cargarImagenes = async () => {
        setLoading(true);
        setErrorMsg('');
        try {
            // "Hide adult content" en Ajustes → Account, activado por
            // defecto: si no hay nada guardado (null) o vale "true", se
            // oculta; solo se manda "false" si el usuario lo desactivó a mano.
            const ocultarNsfw = localStorage.getItem('ocultarNsfw') !== 'false';
            const res = await fetch(`http://localhost:3001/steamgriddb/images/${mediaId}?ocultarNsfw=${ocultarNsfw}`);
            const data = await res.json();
            setCovers(data.covers || []);
            setHeroes(data.heroes || []);
            if ((data.covers || []).length === 0 && (data.heroes || []).length === 0) {
                setErrorMsg('No se encontraron imágenes en SteamGridDB para este juego.');
            }
        } catch (error) {
            console.error('Error cargando imágenes de SteamGridDB', error);
            setErrorMsg('Error de conexión con el servidor');
        }
        setLoading(false);
    };

    const handleOpen = () => {
        setIsModalOpen(true);
        cargarImagenes();
    };

    // .gif y .webp pueden ser animados — el editor de recorte usa un canvas
    // para exportar el resultado, y un canvas siempre aplana a un único
    // fotograma fijo (pierde la animación pase lo que pase). Para estas
    // extensiones nos saltamos el recorte del todo y guardamos la URL tal
    // cual, para conservar el movimiento.
    const esPosibleAnimacion = (url: string) => /\.(gif|webp)(\?|$)/i.test(url);

    const guardarBannerDirecto = async (url: string) => {
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
                body: JSON.stringify({ newBackdropUrl: url }),
            });
            if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
            window.location.reload();
        } catch (error) {
            console.error('Error al guardar el banner animado', error);
            alert('No se pudo guardar el banner. Revisa la consola del backend para más detalles.');
        }
    };

    const seleccionar = async (url: string) => {
        if (tab === 'banner') {
            if (esPosibleAnimacion(url)) {
                await guardarBannerDirecto(url);
                return;
            }
            // Las imágenes de SteamGridDB/IGDB no siempre permiten CORS, así
            // que el navegador no puede "tocarlas" directamente con canvas
            // para recortarlas — pasan primero por el backend, que las
            // descarga y las devuelve en base64 sin ese problema.
            setCargandoParaRecortar(true);
            try {
                const res = await fetch(`http://localhost:3001/proxy-imagen?url=${encodeURIComponent(url)}`);
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
        const token = localStorage.getItem('token');
        if (!token) {
            alert('Tienes que iniciar sesión para guardar tu carátula.');
            return;
        }
        await fetch(`http://localhost:3001/media/${mediaId}/poster`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ newPosterUrl: url }),
        });
        window.location.reload();
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

    const imagenes = tab === 'caratula' ? covers : heroes;

    return (
        <>
            <button
                onClick={handleOpen}
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
                                    Carátula ({covers.length})
                                </button>
                                <button
                                    onClick={() => setTab('banner')}
                                    className={`text-sm font-bold uppercase tracking-wider pb-1 border-b-2 transition cursor-pointer ${tab === 'banner' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent'}`}
                                >
                                    Banner ({heroes.length})
                                </button>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
                        </div>

                        <div className="overflow-y-auto p-6">
                            {loading ? (
                                <div className="text-center py-12 text-gray-400">Cargando imágenes desde SteamGridDB...</div>
                            ) : imagenes.length === 0 ? (
                                <div className="text-center py-12 text-gray-400">{errorMsg || 'No hay imágenes disponibles en esta categoría.'}</div>
                            ) : tab === 'caratula' ? (
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                                    {imagenes.map((url) => (
                                        <img
                                            key={url}
                                            src={url}
                                            onClick={() => seleccionar(url)}
                                            className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3] bg-gray-800"
                                            alt="Opción de carátula"
                                            loading="lazy"
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {imagenes.map((url) => (
                                        <img
                                            key={url}
                                            src={url}
                                            onClick={() => seleccionar(url)}
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