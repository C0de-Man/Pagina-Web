'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

interface JuegoSaga {
    igdbId: number;
    titulo: string;
    anio: number | null;
    portada: string | null;
}

interface CollectionResponse {
    collection: { nombre: string } | null;
    games: JuegoSaga[];
    cancelados: JuegoSaga[];
    indiceActual: number;
    prequel: JuegoSaga | null;
    sequel: JuegoSaga | null;
}

export default function GameCollectionLinks({
    igdbId,
    currentMediaIgdbId,
}: {
    igdbId: number;
    currentMediaIgdbId: number;
}) {
    const router = useRouter();
    const [data, setData] = useState<CollectionResponse | null>(null);
    const [modalAbierto, setModalAbierto] = useState(false);
    const [navegandoA, setNavegandoA] = useState<number | null>(null);
    const [tabModal, setTabModal] = useState<'juegos' | 'cancelados'>('juegos');

    useEffect(() => {
        let cancelado = false;
        fetch(`${API_URL}/igdb/collection/${igdbId}`)
            .then((r) => r.json())
            .then((d: CollectionResponse) => {
                if (!cancelado) setData(d);
            })
            .catch((err) => console.error('Error cargando saga del juego', err));
        return () => {
            cancelado = true;
        };
    }, [igdbId]);

    async function irAlJuego(juego: JuegoSaga) {
        if (juego.igdbId === currentMediaIgdbId) return;

        try {
            setNavegandoA(juego.igdbId);
            const res = await fetch(`${API_URL}/media/igdb`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ igdbId: juego.igdbId }),
            });
            const media = await res.json();
            if (!res.ok) throw new Error(media.error || 'No se pudo guardar el juego');
            router.push(urlFicha(media));
        } catch (err) {
            console.error('Error al navegar a un juego de la saga', err);
            setNavegandoA(null);
        }
    }

    if (!data || !data.collection || data.games.length <= 1) return null;

    function Miniatura({ juego, etiqueta }: { juego: JuegoSaga; etiqueta: string }) {
        const esActual = juego.igdbId === currentMediaIgdbId;
        return (
            <button
                onClick={() => irAlJuego(juego)}
                disabled={esActual || navegandoA !== null}
                className={`group text-left disabled:cursor-default ${esActual ? '' : 'cursor-pointer'
                    }`}
            >
                {juego.portada && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={juego.portada}
                        alt={juego.titulo}
                        className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80"
                    />
                )}
                <p className="mt-1 text-sm text-gray-400">{etiqueta}</p>
                <p className={`text-sm font-medium ${esActual ? '' : 'group-hover:underline'}`}>
                    {navegandoA === juego.igdbId ? 'Cargando...' : juego.titulo}
                </p>
            </button>
        );
    }

    return (
        <>
            <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
                <div className="grid grid-cols-2 gap-4">
                    {data.prequel && <Miniatura juego={data.prequel} etiqueta="Precuela" />}
                    {data.sequel && <Miniatura juego={data.sequel} etiqueta="Secuela" />}
                </div>

                <button
                    onClick={() => setModalAbierto(true)}
                    className="mt-3 w-full text-center text-sm text-gray-300 underline cursor-pointer"
                >
                    Ver más de la saga
                </button>
            </div>

            {modalAbierto && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
                    onClick={() => setModalAbierto(false)}
                >
                    <div
                        className="max-h-[85vh] w-[90vw] max-w-5xl overflow-y-auto rounded-lg bg-[#1c2228] border border-gray-700 p-8 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white">{data.collection?.nombre} — Colección</h2>
                            <button
                                onClick={() => setModalAbierto(false)}
                                className="text-2xl text-gray-400 hover:text-white cursor-pointer transition"
                            >
                                ×
                            </button>
                        </div>

                        <div className="flex gap-6 border-b border-gray-800 mb-6">
                            <button
                                onClick={() => setTabModal('juegos')}
                                className={`pb-3 text-sm font-semibold transition cursor-pointer ${tabModal === 'juegos'
                                        ? 'text-white border-b-2 border-white'
                                        : 'text-gray-500 hover:text-gray-300'
                                    }`}
                            >
                                Juegos
                            </button>
                            {data.cancelados.length > 0 && (
                                <button
                                    onClick={() => setTabModal('cancelados')}
                                    className={`pb-3 text-sm font-semibold transition cursor-pointer ${tabModal === 'cancelados'
                                            ? 'text-white border-b-2 border-white'
                                            : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    Cancelados
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
                            {(tabModal === 'juegos' ? data.games : data.cancelados).map((g) => {
                                const esActual = g.igdbId === currentMediaIgdbId;
                                return (
                                    <button
                                        key={g.igdbId}
                                        onClick={() => irAlJuego(g)}
                                        disabled={esActual || navegandoA !== null}
                                        className={`group text-left rounded disabled:cursor-default ${esActual ? '' : 'cursor-pointer'
                                            }`}
                                    >
                                        {g.portada && (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={g.portada}
                                                alt={g.titulo}
                                                className={`w-full aspect-[2/3] object-cover rounded transition ${esActual
                                                        ? 'ring-2 ring-blue-500'
                                                        : 'group-hover:opacity-80 group-hover:scale-[1.02]'
                                                    }`}
                                            />
                                        )}
                                        <p className="mt-2 text-sm font-semibold text-white">
                                            {navegandoA === g.igdbId ? 'Cargando...' : g.titulo}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {g.anio}
                                            {esActual ? ' · Estás viendo esta' : ''}
                                        </p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}