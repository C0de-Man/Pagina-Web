'use client';
import { useState } from 'react';

export default function PosterButtonModal({ tmdbId, mediaId }: { tmdbId: number; mediaId: number }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [posters, setPosters] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const loadPosters = async () => {
        setLoading(true);
        try {
            const res = await fetch(`http://localhost:3001/tmdb/images/${tmdbId}`);
            const data = await res.json();
            setPosters(data.slice(0, 12));
        } catch (error) {
            console.error("Error cargando pósters", error);
        }
        setLoading(false);
    };

    const selectPoster = async (path: string) => {
        const newUrl = `https://image.tmdb.org/t/p/w780${path}`;
        await fetch(`http://localhost:3001/media/${mediaId}/poster`, {
            method: 'PATCH',
            headers: { 'Type': 'Client', 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPosterUrl: newUrl })
        });
        window.location.reload();
    };

    return (
        <>
            <button
                onClick={() => { setIsModalOpen(true); loadPosters(); }}
                className="w-full mt-3 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
            >
                Cambiar póster
            </button>

            {isModalOpen && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 p-6 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto text-white shadow-2xl">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                            <h2 className="text-xl font-bold">Elige un póster de TMDB</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
                        </div>

                        {loading ? (
                            <div className="text-center py-8 text-gray-400">Cargando pósters...</div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                {posters.map((p) => (
                                    <img
                                        key={p.file_path}
                                        src={`https://image.tmdb.org/t/p/w300${p.file_path}`}
                                        onClick={() => selectPoster(p.file_path)}
                                        className="cursor-pointer rounded-lg hover:scale-105 transition border-2 border-transparent hover:border-blue-500 object-cover aspect-[2/3]"
                                        alt="Poster option"
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