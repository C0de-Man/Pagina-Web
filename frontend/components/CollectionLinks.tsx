'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { urlFicha } from '@/lib/slug';
import { withLangRegion } from '@/lib/preferences';

const API_URL = 'http://localhost:3001';

interface UniverseItem {
  id: number; // id de la fila CinematicUniverseItem — hace falta para borrar/reordenar
  tmdbId: number;
  titulo: string;
  anio: number | null;
  portada: string | null;
}

interface UniverseTab {
  nombre: string;
  items: UniverseItem[];
}

interface Universo {
  id: number;
  nombre: string;
  pestañas: UniverseTab[];
}

interface CollectionResponse {
  prequel: any;
  sequel: any;
  nombreColeccion: string | null;
  collectionId: number | null;
  parts: any[];
  universo: Universo | null;
}

interface UniversoResumen {
  id: number;
  nombre: string;
}

interface ResultadoTmdb {
  id: number;
  media_type: string;
  title?: string;
  release_date?: string;
  poster_path?: string | null;
}

// Mismo patrón que el resto de la app: usuario y token en localStorage.
function useEsAdmin() {
  const [esAdmin, setEsAdmin] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      if (raw) setEsAdmin(!!JSON.parse(raw).isAdmin);
    } catch {
      setEsAdmin(false);
    }
  }, []);
  return esAdmin;
}

export default function CollectionLinks({ tmdbId }: { tmdbId: number }) {
  const esAdmin = useEsAdmin();
  const router = useRouter();
  const idPeticionRef = useRef(0);

  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [personalizaciones, setPersonalizaciones] = useState<
    Record<number, { customPoster: string | null; customBackdrop: string | null }>
  >({});
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // --- Modo universo: pestaña activa, borrado, drag&drop ---
  const [pestañaActiva, setPestañaActiva] = useState(0);
  const [itemABorrar, setItemABorrar] = useState<UniverseItem | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [arrastrandoId, setArrastrandoId] = useState<number | null>(null);

  // --- Buscador para añadir películas sueltas a la pestaña actual (solo admin) ---
  const [busquedaTexto, setBusquedaTexto] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<ResultadoTmdb[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [anadiendoId, setAnadiendoId] = useState<number | null>(null);
  const [errorAnadir, setErrorAnadir] = useState<string | null>(null);

  // --- Admin: crear universo / añadir esta colección a uno existente ---
  const [mostrarFormUniverso, setMostrarFormUniverso] = useState(false);
  const [universosExistentes, setUniversosExistentes] = useState<UniversoResumen[]>([]);
  const [universoElegido, setUniversoElegido] = useState<'nuevo' | number>('nuevo');
  const [nombreNuevoUniverso, setNombreNuevoUniverso] = useState('');
  const [nombrePestañaNueva, setNombrePestañaNueva] = useState('');
  const [guardandoUniverso, setGuardandoUniverso] = useState(false);
  const [errorUniverso, setErrorUniverso] = useState<string | null>(null);

  // --- Admin (ya dentro de un universo): añadir OTRA colección de TMDB entera ---
  const [mostrarAñadirColeccion, setMostrarAñadirColeccion] = useState(false);
  const [nuevoTmdbCollectionId, setNuevoTmdbCollectionId] = useState('');
  const [nuevaEtiquetaPestaña, setNuevaEtiquetaPestaña] = useState('');
  const [añadiendoColeccion, setAñadiendoColeccion] = useState(false);
  const [errorAñadirColeccion, setErrorAñadirColeccion] = useState<string | null>(null);

  function cargarColeccion() {
    const miId = ++idPeticionRef.current;
    fetch(withLangRegion(`${API_URL}/tmdb/collection/${tmdbId}`))
      .then((r) => r.json())
      .then((d: CollectionResponse) => {
        if (miId === idPeticionRef.current) setCollection(d);
      })
      .catch((err) => console.error('Error cargando colección/universo', err));
  }

  useEffect(() => {
    if (!tmdbId) return;
    cargarColeccion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  useEffect(() => {
    fetch(`${API_URL}/media`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setMyDb)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || myDb.length === 0 || !collection) return;

    const idsUniverso = collection.universo
      ? collection.universo.pestañas.flatMap((p) => p.items.map((it) => it.tmdbId))
      : [];

    const idsTmdb = [
      collection.prequel?.id,
      collection.sequel?.id,
      ...(collection.parts || []).map((p) => p.id),
      ...idsUniverso,
    ].filter(Boolean);

    const dbIds = idsTmdb
      .map((id) => myDb.find((m: any) => m.tmdbId === id)?.id)
      .filter(Boolean);
    if (dbIds.length === 0) return;

    fetch(`${API_URL}/media/personalizaciones?ids=${[...new Set(dbIds)].join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then(setPersonalizaciones)
      .catch(() => {});
  }, [myDb, collection]);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // Buscador de películas para añadir a la pestaña actual (con debounce)
  useEffect(() => {
    if (!esAdmin || busquedaTexto.trim().length < 2) {
      setResultadosBusqueda([]);
      return;
    }
    setBuscando(true);
    const timeout = setTimeout(() => {
      fetch(withLangRegion(`${API_URL}/tmdb/buscar?q=${encodeURIComponent(busquedaTexto)}`))
        .then((r) => r.json())
        .then((d) =>
          setResultadosBusqueda(
            (Array.isArray(d) ? d : []).filter((r: ResultadoTmdb) => r.media_type === 'movie').slice(0, 20)
          )
        )
        .catch((err) => console.error('Error buscando en TMDB', err))
        .finally(() => setBuscando(false));
    }, 350);
    return () => clearTimeout(timeout);
  }, [busquedaTexto, esAdmin]);

  if (!collection || (!collection.universo && !collection.prequel && !collection.sequel)) return null;

  // SIEMPRE dos pestañas de cara al usuario, aunque el universo tenga más
  // de dos sub-colecciones guardadas en el backend: la saga PROPIA de esta
  // película (la sub-colección a la que pertenece), y el universo entero
  // con TODAS las películas de todas las sub-colecciones mezcladas y
  // ordenadas por fecha de estreno (no agrupadas). Las sub-colecciones
  // individuales solo existen como concepto interno/admin — el visitante
  // nunca navega pestaña por pestaña entre ellas.
  type TabVisual = { tipo: 'propia' | 'universo'; nombre: string; items: UniverseItem[]; pestañaOrigen?: string };

  function calcularTabsVisuales(universo: Universo): TabVisual[] {
    const pestañaPropia =
      universo.pestañas.find((p) => p.items.some((it) => it.tmdbId === tmdbId)) || universo.pestañas[0];

    const vistos = new Set<number>();
    const todas: UniverseItem[] = [];
    for (const p of universo.pestañas) {
      for (const it of p.items) {
        if (vistos.has(it.tmdbId)) continue;
        vistos.add(it.tmdbId);
        todas.push(it);
      }
    }
    todas.sort((a, b) => (a.anio ?? Infinity) - (b.anio ?? Infinity));

    return [
      { tipo: 'propia', nombre: pestañaPropia.nombre, items: pestañaPropia.items, pestañaOrigen: pestañaPropia.nombre },
      { tipo: 'universo', nombre: universo.nombre, items: todas },
    ];
  }

  const tabsVisuales = collection.universo ? calcularTabsVisuales(collection.universo) : [];
  const tabActiva = tabsVisuales[pestañaActiva];

  const getLocalData = (id: number) => {
    const local = myDb.find((m: any) => m.tmdbId === id);
    const dbId = local?.id || null;
    const miPersonalizacion = dbId ? personalizaciones[dbId] : undefined;
    return {
      dbId,
      customPoster: miPersonalizacion?.customPoster || local?.portada || null,
    };
  };

  const handleClick = async (item: any, dbId: number | null) => {
    if (loadingId) return;
    setLoadingId(item.id);
    if (dbId) {
      router.push(urlFicha({ ...item, id: dbId }));
    } else {
      try {
        const res = await fetch(`${API_URL}/media/tmdb`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tmdbId: item.id, tipo: 'PELICULA' }),
        });
        const nueva = await res.json();
        router.push(urlFicha(nueva));
      } catch (e) {
        setLoadingId(null);
      }
    }
  };

  const renderItem = (item: any, label: string) => {
    if (!item) return null;
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null);

    return (
      <div onClick={() => handleClick(item, dbId)} className="flex flex-col items-center gap-1.5 cursor-pointer group w-24">
        <div className="relative w-full aspect-[2/3] rounded border border-gray-700 group-hover:border-gray-400 transition shadow-lg overflow-hidden bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className={`w-full h-full object-cover ${loadingId === item.id ? 'opacity-50 blur-sm' : ''}`} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1">{item.title}</div>
          )}
          {loadingId === item.id && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span className="text-white text-[10px] font-bold">...</span>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 group-hover:text-white transition font-medium">{label}</span>
      </div>
    );
  };

  // Tarjeta de la colección "plana" (sin universo) — igual que antes.
  const renderFullCard = (item: any) => {
    const { dbId, customPoster } = getLocalData(item.id);
    const posterUrl = customPoster || (item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null);
    const anio = item.release_date ? item.release_date.split('-')[0] : '—';
    const esActual = item.id === tmdbId;

    return (
      <div
        key={item.id}
        onClick={() => handleClick(item, dbId)}
        className={`flex flex-col items-center gap-2 p-2 rounded-lg cursor-pointer transition ${
          esActual ? 'bg-gray-800/80 ring-1 ring-blue-500' : 'hover:bg-gray-800/50'
        }`}
      >
        <div className="w-full aspect-[2/3] rounded overflow-hidden border border-gray-700 bg-gray-800">
          {posterUrl ? (
            <img src={posterUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-center p-1 text-gray-400">{item.title}</div>
          )}
        </div>
        <div className="text-center">
          <p className="font-semibold text-white text-sm leading-tight">{item.title}</p>
          <p className="text-xs text-gray-400">{anio}{esActual ? " · You're viewing this" : ''}</p>
        </div>
      </div>
    );
  };

  // Portada real de un item de universo: tu personalización si existe, si no
  // la guardada en tu base de datos, si no la que trae el propio universo.
  function getPortadaUniverso(item: UniverseItem): string | null {
    const local = myDb.find((m: any) => m.tmdbId === item.tmdbId);
    const miPersonalizacion = local ? personalizaciones[local.id] : undefined;
    return miPersonalizacion?.customPoster || local?.portada || item.portada;
  }

  const hrefDeItemUniverso = (item: UniverseItem) => `/movie/tmdb/${item.tmdbId}`;

  function listaDeLaPestañaActual(): UniverseItem[] {
    return tabActiva?.items || [];
  }

  function actualizarPestañaActual(nuevaLista: UniverseItem[]) {
    const origen = tabActiva?.pestañaOrigen;
    if (!origen) return; // no se reordena la pestaña "universo" (mezclada, orden por fecha)
    setCollection((prev) => {
      if (!prev?.universo) return prev;
      const pestañas = prev.universo.pestañas.map((p) => (p.nombre === origen ? { ...p, items: nuevaLista } : p));
      return { ...prev, universo: { ...prev.universo, pestañas } };
    });
  }

  function handleDragStart(id: number) {
    if (!esAdmin || tabActiva?.tipo !== 'propia') return;
    setArrastrandoId(id);
  }

  function handleDragOver(e: React.DragEvent, idDebajo: number) {
    if (!esAdmin || arrastrandoId === null || tabActiva?.tipo !== 'propia') return;
    e.preventDefault();
    if (arrastrandoId === idDebajo) return;
    const lista = listaDeLaPestañaActual();
    const idxOrigen = lista.findIndex((it) => it.id === arrastrandoId);
    const idxDestino = lista.findIndex((it) => it.id === idDebajo);
    if (idxOrigen === -1 || idxDestino === -1) return;
    const nueva = [...lista];
    const [movido] = nueva.splice(idxOrigen, 1);
    nueva.splice(idxDestino, 0, movido);
    actualizarPestañaActual(nueva);
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!esAdmin || arrastrandoId === null) return;
    setArrastrandoId(null);
    try {
      const token = localStorage.getItem('token');
      const ids = listaDeLaPestañaActual().map((it) => it.id);
      await fetch(`${API_URL}/admin/cinematic-universe-items/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.error('Error al guardar el nuevo orden', err);
    }
  }

  function cambiarPestaña(i: number) {
    setPestañaActiva(i);
    setBusquedaTexto('');
    setResultadosBusqueda([]);
    setErrorAnadir(null);
  }

  async function confirmarBorrado() {
    if (!itemABorrar) return;
    setBorrando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items/${itemABorrar.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo eliminar');
      actualizarPestañaActual(listaDeLaPestañaActual().filter((it) => it.id !== itemABorrar.id));
      setItemABorrar(null);
    } catch (err) {
      console.error('Error al borrar de la colección', err);
    }
    setBorrando(false);
  }

  async function añadirPelicula(resultado: ResultadoTmdb) {
    if (!collection?.universo || !tabActiva?.pestañaOrigen) return;
    setAnadiendoId(resultado.id);
    setErrorAnadir(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universe-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          universeId: collection.universo.id,
          tmdbId: resultado.id,
          titulo: resultado.title,
          anio: resultado.release_date ? new Date(resultado.release_date).getFullYear() : null,
          portada: resultado.poster_path ? `https://image.tmdb.org/t/p/w500${resultado.poster_path}` : null,
          pestaña: tabActiva.pestañaOrigen,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorAnadir(body.error || 'No se pudo añadir la película');
        return;
      }
      setBusquedaTexto('');
      setResultadosBusqueda([]);
      cargarColeccion();
    } catch (err) {
      console.error('Error al añadir la película al universo', err);
      setErrorAnadir('No se pudo añadir la película');
    } finally {
      setAnadiendoId(null);
    }
  }

  // Abre el formulario de "convertir en universo" y precarga el nombre de
  // pestaña con el de esta propia colección (se puede editar).
  function abrirFormUniverso() {
    setNombrePestañaNueva(collection?.nombreColeccion || '');
    setErrorUniverso(null);
    setMostrarFormUniverso(true);
    const token = localStorage.getItem('token');
    fetch(`${API_URL}/admin/cinematic-universes`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then(setUniversosExistentes)
      .catch(() => {});
  }

  async function guardarUniverso() {
    if (!collection?.collectionId) return;
    setGuardandoUniverso(true);
    setErrorUniverso(null);
    try {
      const token = localStorage.getItem('token');
      let universeId: number;

      if (universoElegido === 'nuevo') {
        if (!nombreNuevoUniverso.trim()) {
          setErrorUniverso('Ponle un nombre al universo');
          setGuardandoUniverso(false);
          return;
        }
        const resCrear = await fetch(`${API_URL}/admin/cinematic-universes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ nombre: nombreNuevoUniverso.trim() }),
        });
        const nuevo = await resCrear.json();
        if (!resCrear.ok) throw new Error(nuevo.error || 'No se pudo crear el universo');
        universeId = nuevo.id;
      } else {
        universeId = universoElegido;
      }

      const resAñadir = await fetch(`${API_URL}/admin/cinematic-universes/${universeId}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbCollectionId: collection.collectionId,
          nombrePestaña: nombrePestañaNueva.trim() || undefined,
        }),
      });
      const bodyAñadir = await resAñadir.json();
      if (!resAñadir.ok) throw new Error(bodyAñadir.error || 'No se pudo añadir la colección al universo');

      setMostrarFormUniverso(false);
      cargarColeccion();
    } catch (err: any) {
      setErrorUniverso(err.message || 'Algo falló');
    }
    setGuardandoUniverso(false);
  }

  async function añadirOtraColeccion() {
    if (!collection?.universo) return;
    const idNum = parseInt(nuevoTmdbCollectionId, 10);
    if (Number.isNaN(idNum)) {
      setErrorAñadirColeccion('Ese id de colección de TMDB no es válido');
      return;
    }
    setAñadiendoColeccion(true);
    setErrorAñadirColeccion(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/admin/cinematic-universes/${collection.universo.id}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tmdbCollectionId: idNum,
          nombrePestaña: nuevaEtiquetaPestaña.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo añadir la colección');

      setMostrarAñadirColeccion(false);
      setNuevoTmdbCollectionId('');
      setNuevaEtiquetaPestaña('');
      cargarColeccion();
    } catch (err: any) {
      setErrorAñadirColeccion(err.message || 'Algo falló');
    }
    setAñadiendoColeccion(false);
  }

  function BotonBorrar({ item }: { item: UniverseItem }) {
    if (!esAdmin) return null;
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setItemABorrar(item);
        }}
        title="Remove from universe"
        className="absolute top-1 left-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-sm font-bold text-white opacity-0 transition hover:bg-red-600 group-hover:opacity-100 cursor-pointer"
      >
        ×
      </button>
    );
  }

  return (
    <>
      <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
        <div className="flex justify-center gap-4">
          {collection.prequel && (
            <div className={collection.sequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
              {renderItem(collection.prequel, 'Prequel')}
            </div>
          )}
          {collection.sequel && (
            <div className={collection.prequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
              {renderItem(collection.sequel, 'Sequel')}
            </div>
          )}
        </div>

        {((collection.parts && collection.parts.length > 1) || collection.universo) && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="w-full mt-4 text-xs text-gray-400 hover:text-white text-center underline cursor-pointer bg-gray-900/80 py-2 rounded border border-gray-800 transition"
          >
            See full saga
          </button>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setIsModalOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-gray-900 border border-gray-700 rounded-lg max-w-5xl w-full max-h-[85vh] text-white shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-700 flex-shrink-0">
              <h2 className="text-xl font-bold">
                {collection.universo?.nombre || collection.nombreColeccion || 'Full saga'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold cursor-pointer">✕</button>
            </div>

            {collection.universo && (
              <div className="flex items-center justify-between px-6 pt-3 border-b border-gray-800 flex-shrink-0">
                <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                  {tabsVisuales.map((t, i) => (
                    <button
                      key={t.tipo}
                      onClick={() => cambiarPestaña(i)}
                      className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition cursor-pointer ${
                        pestañaActiva === i ? 'border-blue-500 text-white' : 'border-transparent text-gray-400 hover:text-white'
                      }`}
                    >
                      {t.nombre}
                    </button>
                  ))}
                </div>
                {esAdmin && (
                  <button
                    onClick={() => setMostrarAñadirColeccion(true)}
                    className="mb-2 text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition whitespace-nowrap"
                  >
                    + Add collection
                  </button>
                )}
              </div>
            )}

            {esAdmin && collection.universo && tabActiva?.tipo === 'propia' && (
              <div className="relative px-6 pt-4">
                <input
                  type="text"
                  value={busquedaTexto}
                  onChange={(e) => setBusquedaTexto(e.target.value)}
                  placeholder={`Add a movie to "${tabActiva.nombre}"...`}
                  className="w-full max-w-md bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
                />
                {errorAnadir && <p className="mt-1 text-xs text-red-400">{errorAnadir}</p>}
                {busquedaTexto.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 w-full max-w-md max-h-72 overflow-y-auto rounded border border-gray-700 bg-[#20262e] shadow-xl">
                    {buscando ? (
                      <p className="px-3 py-2 text-sm text-gray-400">Searching...</p>
                    ) : resultadosBusqueda.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-400">No results.</p>
                    ) : (
                      resultadosBusqueda.map((r) => {
                        const anioResultado = r.release_date ? new Date(r.release_date).getFullYear() : null;
                        const yaEnLaLista = collection.universo!.pestañas.some((p) => p.items.some((it) => it.tmdbId === r.id));
                        return (
                          <button
                            key={r.id}
                            onClick={() => !yaEnLaLista && añadirPelicula(r)}
                            disabled={yaEnLaLista || anadiendoId !== null}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition cursor-pointer disabled:cursor-default ${
                              yaEnLaLista ? 'text-gray-600' : 'text-blue-400 hover:bg-white/5 hover:text-blue-300'
                            }`}
                          >
                            <span>{r.title}{anioResultado ? ` (${anioResultado})` : ''}</span>
                            {anadiendoId === r.id && <span className="text-xs text-gray-400">Adding...</span>}
                            {yaEnLaLista && <span className="text-xs text-gray-600">Already added</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {esAdmin && !collection.universo && collection.collectionId && (
              <div className="px-6 pt-4">
                {!mostrarFormUniverso ? (
                  <button
                    onClick={abrirFormUniverso}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer transition"
                  >
                    Add this collection to a Cinematic Universe
                  </button>
                ) : (
                  <div className="rounded border border-gray-700 bg-[#20262e] p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <select
                        value={universoElegido}
                        onChange={(e) => setUniversoElegido(e.target.value === 'nuevo' ? 'nuevo' : parseInt(e.target.value, 10))}
                        className="bg-[#2c3440] text-white text-sm rounded px-2 py-1.5 focus:outline-none"
                      >
                        <option value="nuevo">+ New universe...</option>
                        {universosExistentes.map((u) => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                      {universoElegido === 'nuevo' && (
                        <input
                          type="text"
                          value={nombreNuevoUniverso}
                          onChange={(e) => setNombreNuevoUniverso(e.target.value)}
                          placeholder="Universe name (e.g. Marvel Cinematic Universe)"
                          className="flex-1 bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                        />
                      )}
                    </div>
                    <input
                      type="text"
                      value={nombrePestañaNueva}
                      onChange={(e) => setNombrePestañaNueva(e.target.value)}
                      placeholder="Tab label for this collection (e.g. Avengers)"
                      className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    />
                    {errorUniverso && <p className="text-xs text-red-400">{errorUniverso}</p>}
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setMostrarFormUniverso(false)}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={guardarUniverso}
                        disabled={guardandoUniverso}
                        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {guardandoUniverso ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="overflow-y-auto p-6">
              {collection.universo ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-6">
                  {listaDeLaPestañaActual().map((it) => {
                    const esActual = it.tmdbId === tmdbId;
                    const portadaReal = getPortadaUniverso(it);
                    return (
                      <div
                        key={it.id}
                        className={`group relative ${arrastrandoId === it.id ? 'opacity-40' : ''}`}
                        onDragStart={() => handleDragStart(it.id)}
                        onDragOver={(e) => handleDragOver(e, it.id)}
                        onDrop={handleDrop}
                        onDragEnd={() => setArrastrandoId(null)}
                      >
                        <BotonBorrar item={it} />
                        <a href={hrefDeItemUniverso(it)} className="block w-full rounded text-left cursor-pointer">
                          {portadaReal && (
                            <img
                              src={portadaReal}
                              alt={it.titulo}
                              draggable={esAdmin && tabActiva?.tipo === 'propia'}
                              className={`w-full aspect-[2/3] object-cover rounded transition ${
                                esActual ? 'ring-2 ring-blue-500' : 'group-hover:opacity-80 group-hover:scale-[1.02]'
                              } ${esAdmin && tabActiva?.tipo === 'propia' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                            />
                          )}
                          <p className="mt-2 text-sm font-semibold text-white select-text">{it.titulo}</p>
                          <p className="text-xs text-gray-400">{it.anio}{esActual ? " · You're viewing this" : ''}</p>
                        </a>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
                  {collection.parts.map(renderFullCard)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal para añadir otra colección de TMDB entera al universo actual */}
      {mostrarAñadirColeccion && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
          onClick={() => !añadiendoColeccion && setMostrarAñadirColeccion(false)}
        >
          <div className="w-[90vw] max-w-md rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Add a collection to "{collection.universo?.nombre}"</h3>
            <p className="text-sm text-gray-400 mb-4">
              Paste the TMDB collection id (found in the collection's URL on themoviedb.org) — every movie in it will
              be added under its own tab.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                inputMode="numeric"
                value={nuevoTmdbCollectionId}
                onChange={(e) => setNuevoTmdbCollectionId(e.target.value)}
                placeholder="TMDB collection id (e.g. 131296)"
                className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              <input
                type="text"
                value={nuevaEtiquetaPestaña}
                onChange={(e) => setNuevaEtiquetaPestaña(e.target.value)}
                placeholder="Tab label (optional, defaults to TMDB's collection name)"
                className="w-full bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              {errorAñadirColeccion && <p className="text-xs text-red-400">{errorAñadirColeccion}</p>}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setMostrarAñadirColeccion(false)}
                disabled={añadiendoColeccion}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={añadirOtraColeccion}
                disabled={añadiendoColeccion}
                className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
              >
                {añadiendoColeccion ? 'Adding...' : 'Add collection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de borrado */}
      {itemABorrar && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={() => !borrando && setItemABorrar(null)}>
          <div className="w-[90vw] max-w-sm rounded-lg bg-[#1c2228] border border-gray-700 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">Remove from universe?</h3>
            <p className="text-sm text-gray-400 mb-6">
              You're about to remove <span className="text-white font-semibold">{itemABorrar.titulo}</span> from this
              universe. This won't remove it from your catalog or from search, only from this list.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setItemABorrar(null)}
                disabled={borrando}
                className="px-4 py-2 text-sm text-gray-300 hover:text-white transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmarBorrado}
                disabled={borrando}
                className="px-4 py-2 text-sm rounded bg-red-600 hover:bg-red-500 text-white font-semibold transition cursor-pointer disabled:opacity-50"
              >
                {borrando ? 'Removing...' : 'Yes, remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}