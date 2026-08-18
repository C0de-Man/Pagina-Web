'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

const API_URL = 'http://localhost:3001';

interface JuegoSaga {
    id: number; // id de la fila en CuratedCollectionItem — hace falta para poder borrarla
    igdbId: number;
    titulo: string;
    anio: number | null;
    portada: string | null;
}

interface CollectionResponse {
    collection: { id: number; nombre: string } | null;
    games: JuegoSaga[];
    cancelados: JuegoSaga[];
    otros: JuegoSaga[];
    indiceActual: number;
    prequel: JuegoSaga | null;
    sequel: JuegoSaga | null;
}

interface ResultadoIgdb {
    id: number;
    name: string;
    first_release_date?: number | null;
    cover?: { url: string } | null;
}

// Mismo patrón que el resto de la app: usuario y token en localStorage.
function useEsAdmin() {
    const [esAdmin, setEsAdmin] = useState(false);
    useEffect(() => {
        try {
            const raw = localStorage.getItem('user');
            if (raw) {
                const user = JSON.parse(raw);
                setEsAdmin(!!user.isAdmin);
            }
        } catch (e) {
            setEsAdmin(false);
        }
    }, []);
    return esAdmin;
}

export default function GameCollectionLinks({
    igdbId,
    currentMediaIgdbId,
}: {
    igdbId: number;
    currentMediaIgdbId: number;
}) {
    const router = useRouter();
    const esAdmin = useEsAdmin();
    const [data, setData] = useState<CollectionResponse | null>(null);
    const [modalAbierto, setModalAbierto] = useState(false);
    const [navegandoA, setNavegandoA] = useState<number | null>(null);
    const [tabModal, setTabModal] = useState<'juegos' | 'cancelados' | 'otros'>('juegos');
    const [juegoABorrar, setJuegoABorrar] = useState<JuegoSaga | null>(null);
    const [borrando, setBorrando] = useState(false);
    const [arrastrandoId, setArrastrandoId] = useState<number | null>(null);
    const [confirmandoReinicio, setConfirmandoReinicio] = useState(false);
    const [reiniciando, setReiniciando] = useState(false);

    // --- Buscador para añadir juegos (solo admin) ---
    const [busquedaTexto, setBusquedaTexto] = useState('');
    const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoIgdb[]>([]);
    const [buscando, setBuscando] = useState(false);
    const [anadiendoId, setAnadiendoId] = useState<number | null>(null);
    const [errorAnadir, setErrorAnadir] = useState<string | null>(null);

    function cargarColeccion() {
        fetch(`${API_URL}/igdb/collection/${igdbId}`)
            .then((r) => r.json())
            .then((d: CollectionResponse) => setData(d))
            .catch((err) => console.error('Error cargando saga del juego', err));
    }

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

    // Busca en IGDB mientras se escribe (con un pequeño debounce), igual que
    // el buscador principal de juegos de la app.
    useEffect(() => {
        if (!esAdmin || busquedaTexto.trim().length < 2) {
            setResultadosBusqueda([]);
            return;
        }
        setBuscando(true);
        const timeout = setTimeout(() => {
            fetch(`${API_URL}/igdb/search?q=${encodeURIComponent(busquedaTexto)}`)
                .then((r) => r.json())
                .then((d) => setResultadosBusqueda(Array.isArray(d) ? d.slice(0, 20) : []))
                .catch((err) => console.error('Error buscando en IGDB', err))
                .finally(() => setBuscando(false));
        }, 350);
        return () => clearTimeout(timeout);
    }, [busquedaTexto, esAdmin]);

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

    // Solo quita la fila de la colección curada (CuratedCollectionItem). No
    // toca Media ni UserMedia, así que el catálogo del usuario (visto, like,
    // watchlist, nota...) queda intacto aunque este juego ya estuviera ahí.
    async function confirmarBorrado() {
        if (!juegoABorrar) return;
        setBorrando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/admin/curated-collection-items/${juegoABorrar.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('No se pudo eliminar');

            setData((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    games: prev.games.filter((g) => g.id !== juegoABorrar.id),
                    cancelados: prev.cancelados.filter((g) => g.id !== juegoABorrar.id),
                    otros: prev.otros.filter((g) => g.id !== juegoABorrar.id),
                    prequel: prev.prequel?.id === juegoABorrar.id ? null : prev.prequel,
                    sequel: prev.sequel?.id === juegoABorrar.id ? null : prev.sequel,
                };
            });
            setJuegoABorrar(null);
        } catch (err) {
            console.error('Error al borrar el juego de la colección', err);
        }
        setBorrando(false);
    }

    // --- Arrastrar y soltar para reordenar (solo dentro de la pestaña actual,
    // Juegos, Cancelados y Other nunca se mezclan porque cada una es una lista
    // separada dentro de "data"). Solo activo para admins.
    function listaDeLaPestanaActual(): JuegoSaga[] {
        if (tabModal === 'juegos') return data!.games;
        if (tabModal === 'cancelados') return data!.cancelados;
        return data!.otros;
    }

    function actualizarListaDeLaPestanaActual(nuevaLista: JuegoSaga[]) {
        setData((prev) => {
            if (!prev) return prev;
            if (tabModal === 'juegos') return { ...prev, games: nuevaLista };
            if (tabModal === 'cancelados') return { ...prev, cancelados: nuevaLista };
            return { ...prev, otros: nuevaLista };
        });
    }

    function handleDragStart(id: number) {
        if (!esAdmin) return;
        setArrastrandoId(id);
    }

    // Reordena en vivo mientras se arrastra por encima de otra carátula,
    // igual que la mayoría de listas arrastrables.
    // OJO: e.preventDefault() tiene que llamarse SIEMPRE que haya un arrastre
    // activo, incluso si estás pasando por encima del propio juego que estás
    // arrastrando (que pasa constantemente, porque el reordenado en vivo lo
    // va colocando justo debajo del cursor). Si no se llama en ese caso, el
    // navegador entiende que "aquí no se puede soltar" y el drop nunca llega
    // a disparar la petición al backend — por eso el orden no se guardaba.
    function handleDragOver(e: React.DragEvent, idDebajo: number) {
        if (!esAdmin || arrastrandoId === null) return;
        e.preventDefault();
        if (arrastrandoId === idDebajo) return; // ya está en su sitio, nada que mover
        const lista = listaDeLaPestanaActual();
        const idxOrigen = lista.findIndex((g) => g.id === arrastrandoId);
        const idxDestino = lista.findIndex((g) => g.id === idDebajo);
        if (idxOrigen === -1 || idxDestino === -1) return;
        const nueva = [...lista];
        const [movido] = nueva.splice(idxOrigen, 1);
        nueva.splice(idxDestino, 0, movido);
        actualizarListaDeLaPestanaActual(nueva);
    }

    // Al soltar, mandamos el orden final (tal como ha quedado tras arrastrar)
    // al backend. La lista local ya está actualizada desde el dragOver, así
    // que aquí solo hace falta persistirla.
    async function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        if (!esAdmin || arrastrandoId === null) return;
        setArrastrandoId(null);
        try {
            const token = localStorage.getItem('token');
            const ids = listaDeLaPestanaActual().map((g) => g.id);
            await fetch(`${API_URL}/admin/curated-collection-items/reorder`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ ids }),
            });
        } catch (err) {
            console.error('Error al guardar el nuevo orden', err);
        }
    }

    function cambiarTab(nuevaTab: 'juegos' | 'cancelados' | 'otros') {
        setTabModal(nuevaTab);
        setBusquedaTexto('');
        setResultadosBusqueda([]);
        setErrorAnadir(null);
    }

    // Añade el juego elegido del buscador al grupo de la pestaña actual
    // (Juegos, Cancelados u Other) — así es como el admin "elige a cuál
    // añadirlo": cambiando de pestaña antes de buscar.
    async function anadirJuego(resultado: ResultadoIgdb) {
        if (!data?.collection) return;
        setAnadiendoId(resultado.id);
        setErrorAnadir(null);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/admin/curated-collection-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    collectionId: data.collection.id,
                    igdbId: resultado.id,
                    titulo: resultado.name,
                    anio: resultado.first_release_date
                        ? new Date(resultado.first_release_date * 1000).getFullYear()
                        : null,
                    portada: resultado.cover?.url || null,
                    grupo: tabModal,
                }),
            });
            const body = await res.json();
            if (!res.ok) {
                setErrorAnadir(body.error || 'No se pudo añadir el juego');
                return;
            }
            setBusquedaTexto('');
            setResultadosBusqueda([]);
            cargarColeccion();
        } catch (err) {
            console.error('Error al añadir el juego a la colección', err);
            setErrorAnadir('No se pudo añadir el juego');
        } finally {
            setAnadiendoId(null);
        }
    }

    // Borra TODO lo guardado a mano en esta colección y la recalcula desde
    // IGDB de cero, como si nunca se hubiera tocado. Acción destructiva —
    // por eso pide confirmación antes de ejecutarse.
    async function confirmarReinicio() {
        if (!data?.collection) return;
        setReiniciando(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/admin/curated-collections/${data.collection.id}/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ igdbId }),
            });
            if (!res.ok) throw new Error('No se pudo reiniciar la colección');
            const nuevaData: CollectionResponse = await res.json();
            setData(nuevaData);
            setTabModal('juegos');
            setConfirmandoReinicio(false);
        } catch (err) {
            console.error('Error al reiniciar la colección', err);
        }
        setReiniciando(false);
    }

    if (!data || !data.collection || data.games.length <= 1) return null;

    // Botón "X" en la esquina, solo visible al pasar el cursor y solo si eres
    // admin. Va como hermano de la imagen (no dentro del <button> que navega),
    // para que el clic no dispare también la navegación al juego.
    function BotonBorrar({ juego }: { juego: JuegoSaga }) {
        if (!esAdmin) return null;
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    setJuegoABorrar(juego);
                }}
                title="Quitar de la colección"
                className="absolute top-1 left-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-sm font-bold text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100 cursor-pointer"
            >
                ×
            </button>
        );
    }

    function Miniatura({ juego, etiqueta }: { juego: JuegoSaga; etiqueta: string }) {
        const esActual = juego.igdbId === currentMediaIgdbId;
        return (
            <div className="group relative">
                <BotonBorrar juego={juego} />
                <button
                    onClick={() => irAlJuego(juego)}
                    disabled={esActual || navegandoA !== null}
                    className={`block w-full text-left disabled:cursor-default ${esActual ? '' : 'cursor-pointer'
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
                    <p className="mt-1 text-sm text-gray-400 text-center">
                        {navegandoA === juego.igdbId ? 'Cargando...' : etiqueta}
                    </p>
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
                <div className="flex justify-center gap-4">
                    {data.prequel && (
                        <div className={data.sequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
                            <Miniatura juego={data.prequel} etiqueta="Precuela" />
                        </div>
                    )}
                    {data.sequel && (
                        <div className={data.prequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
                            <Miniatura juego={data.sequel} etiqueta="Secuela" />
                        </div>
                    )}
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
                            <div className="flex items-center gap-4">
                                {esAdmin && (
                                    <button
                                        onClick={() => setConfirmandoReinicio(true)}
                                        className="text-xs font-semibold text-amber-400 hover:text-amber-300 underline cursor-pointer transition"
                                    >
                                        Reiniciar
                                    </button>
                                )}
                                <button
                                    onClick={() => setModalAbierto(false)}
                                    className="text-2xl text-gray-400 hover:text-white cursor-pointer transition"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        <div className="flex gap-6 border-b border-gray-800 mb-6">
                            <button
                                onClick={() => cambiarTab('juegos')}
                                className={`pb-3 text-sm font-semibold transition cursor-pointer ${tabModal === 'juegos'
                                    ? 'text-white border-b-2 border-white'
                                    : 'text-gray-500 hover:text-gray-300'
                                    }`}
                            >
                                Juegos
                            </button>
                            {(data.cancelados.length > 0 || esAdmin) && (
                                <button
                                    onClick={() => cambiarTab('cancelados')}
                                    className={`pb-3 text-sm font-semibold transition cursor-pointer ${tabModal === 'cancelados'
                                        ? 'text-white border-b-2 border-white'
                                        : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    Cancelados
                                </button>
                            )}
                            {(data.otros.length > 0 || esAdmin) && (
                                <button
                                    onClick={() => cambiarTab('otros')}
                                    className={`pb-3 text-sm font-semibold transition cursor-pointer ${tabModal === 'otros'
                                        ? 'text-white border-b-2 border-white'
                                        : 'text-gray-500 hover:text-gray-300'
                                        }`}
                                >
                                    Other
                                </button>
                            )}
                        </div>

                        {esAdmin && (
                            <div className="relative mb-6">
                                <input
                                    type="text"
                                    value={busquedaTexto}
                                    onChange={(e) => setBusquedaTexto(e.target.value)}
                                    placeholder={
                                        tabModal === 'cancelados'
                                            ? 'Añadir un juego cancelado a esta saga...'
                                            : tabModal === 'otros'
                                                ? 'Añadir un juego a "Other"...'
                                                : 'Añadir un juego a esta saga...'
                                    }
                                    className="w-full max-w-md bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                                />
                                {errorAnadir && (
                                    <p className="mt-1 text-xs text-red-400">{errorAnadir}</p>
                                )}
                                {busquedaTexto.trim().length >= 2 && (
                                    <div className="absolute z-10 mt-1 w-full max-w-md max-h-72 overflow-y-auto rounded border border-gray-700 bg-[#20262e] shadow-xl">
                                        {buscando ? (
                                            <p className="px-3 py-2 text-sm text-gray-400">Buscando...</p>
                                        ) : resultadosBusqueda.length === 0 ? (
                                            <p className="px-3 py-2 text-sm text-gray-400">Sin resultados.</p>
                                        ) : (
                                            resultadosBusqueda.map((r) => {
                                                const anioResultado = r.first_release_date
                                                    ? new Date(r.first_release_date * 1000).getFullYear()
                                                    : null;
                                                const yaEnLaLista = [...data.games, ...data.cancelados, ...data.otros].some(
                                                    (g) => g.igdbId === r.id
                                                );
                                                return (
                                                    <button
                                                        key={r.id}
                                                        onClick={() => !yaEnLaLista && anadirJuego(r)}
                                                        disabled={yaEnLaLista || anadiendoId !== null}
                                                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition cursor-pointer disabled:cursor-default ${yaEnLaLista
                                                            ? 'text-gray-600'
                                                            : 'text-blue-400 hover:bg-white/5 hover:text-blue-300'
                                                            }`}
                                                    >
                                                        <span>
                                                            {r.name}
                                                            {anioResultado ? ` (${anioResultado})` : ''}
                                                        </span>
                                                        {anadiendoId === r.id && (
                                                            <span className="text-xs text-gray-400">Añadiendo...</span>
                                                        )}
                                                        {yaEnLaLista && (
                                                            <span className="text-xs text-gray-600">Ya está</span>
                                                        )}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
                            {(tabModal === 'juegos' ? data.games : tabModal === 'cancelados' ? data.cancelados : data.otros).map((g) => {
                                const esActual = g.igdbId === currentMediaIgdbId;
                                return (
                                    <div
                                        key={g.id}
                                        className={`group relative ${arrastrandoId === g.id ? 'opacity-40' : ''}`}
                                        onDragStart={() => handleDragStart(g.id)}
                                        onDragOver={(e) => handleDragOver(e, g.id)}
                                        onDrop={handleDrop}
                                        onDragEnd={() => setArrastrandoId(null)}
                                    >
                                        <BotonBorrar juego={g} />
                                        <button
                                            onClick={() => irAlJuego(g)}
                                            disabled={esActual || navegandoA !== null}
                                            className={`block w-full rounded text-left disabled:cursor-default ${esActual ? '' : 'cursor-pointer'
                                                }`}
                                        >
                                            {g.portada && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={g.portada}
                                                    alt={g.titulo}
                                                    // Solo la carátula es arrastrable (no toda la tarjeta): así el
                                                    // título sigue siendo texto normal, seleccionable/copiable —
                                                    // un elemento "draggable" bloquea la selección de texto dentro
                                                    // de él, y antes eso incluía el nombre del juego sin querer.
                                                    draggable={esAdmin}
                                                    className={`w-full aspect-[2/3] object-cover rounded transition ${esActual
                                                        ? 'ring-2 ring-blue-500'
                                                        : 'group-hover:opacity-80 group-hover:scale-[1.02]'
                                                        } ${esAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                                />
                                            )}
                                            <p className="mt-2 text-sm font-semibold text-white select-text">
                                                {navegandoA === g.igdbId ? 'Cargando...' : g.titulo}
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                {g.anio}
                                                {esActual ? ' · Estás viendo esta' : ''}
                                            </p>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de confirmación de borrado */}
            {juegoABorrar && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
                    onClick={() => !borrando && setJuegoABorrar(null)}
                >
                    <div
                        className="w-[90vw] max-w-sm rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-bold text-white mb-2">¿Eliminar de la colección?</h3>
                        <p className="text-sm text-gray-400 mb-6">
                            Vas a quitar <span className="text-white font-semibold">{juegoABorrar.titulo}</span> de esta
                            saga. Esto no lo borra de tu catálogo ni de la búsqueda, solo de este listado.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setJuegoABorrar(null)}
                                disabled={borrando}
                                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmarBorrado}
                                disabled={borrando}
                                className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
                            >
                                {borrando ? 'Eliminando...' : 'Sí, eliminar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de confirmación de reinicio */}
            {confirmandoReinicio && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
                    onClick={() => !reiniciando && setConfirmandoReinicio(false)}
                >
                    <div
                        className="w-[90vw] max-w-sm rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-lg font-bold text-white mb-2">¿Reiniciar esta colección?</h3>
                        <p className="text-sm text-gray-400 mb-6">
                            Se va a borrar <span className="text-white font-semibold">todo</span> lo que hayas editado a
                            mano en "{data?.collection?.nombre}" — orden, juegos borrados, juegos añadidos, cancelados y
                            "Other" — y se va a recalcular desde cero con los datos de IGDB. Esto no se puede deshacer.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmandoReinicio(false)}
                                disabled={reiniciando}
                                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmarReinicio}
                                disabled={reiniciando}
                                className="px-4 py-2 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
                            >
                                {reiniciando ? 'Reiniciando...' : 'Sí, reiniciar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}