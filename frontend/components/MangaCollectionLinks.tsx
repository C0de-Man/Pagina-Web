'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = 'http://localhost:3001';

interface MangaSimple {
  malMangaId: number;
  titulo: string;
  portada: string | null;
}

interface RelationsResponse {
  saga: MangaSimple[];
  indiceActual: number;
  moreContent: Record<string, MangaSimple[]>;
}

export default function MangaCollectionLinks({ malMangaId }: { malMangaId: number }) {
  const [data, setData] = useState<RelationsResponse | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [tabModal, setTabModal] = useState<string>('saga');
  // /media no lleva token y solo sirve para saber si un manga ya está
  // guardado (dbId) — así se enlaza a su ficha real en vez de pasar por la
  // resolvedora de nuevo, mismo criterio que en GameCollectionLinks.
  const [myDb, setMyDb] = useState<{ id: number; malMangaId: number | null }[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/mal/manga/${malMangaId}/relations`)
      .then((r) => r.json())
      .then(setData)
      .catch((err) => console.error('Error cargando relaciones del manga', err));
  }, [malMangaId]);

  useEffect(() => {
    fetch(`${API_URL}/media`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setMyDb)
      .catch(() => {});
  }, []);

  function hrefDeManga(manga: MangaSimple) {
    const local = myDb.find((m) => m.malMangaId === manga.malMangaId);
    return local ? `/book/mal/${manga.malMangaId}` : `/book/mal/${manga.malMangaId}`;
    // Ambas rutas son la misma resolvedora: si ya está guardado, /media/mal-manga
    // devuelve la fila existente sin duplicar, así que no hace falta distinguirlas.
  }

  if (!data) return null;

  const grupos = Object.entries(data.moreContent || {});
  const haySaga = data.saga.length > 1;
  const hayMasContenido = grupos.length > 0;
  if (!haySaga && !hayMasContenido) return null;

  const prequel = haySaga && data.indiceActual > 0 ? data.saga[data.indiceActual - 1] : null;
  const sequel = haySaga && data.indiceActual < data.saga.length - 1 ? data.saga[data.indiceActual + 1] : null;

  function Miniatura({ manga, etiqueta }: { manga: MangaSimple; etiqueta?: string }) {
    return (
      <Link href={hrefDeManga(manga)} className="block w-full text-left cursor-pointer group">
        {manga.portada ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={manga.portada}
            alt={manga.titulo}
            className="w-full aspect-[2/3] object-cover rounded transition group-hover:opacity-80"
          />
        ) : (
          <div className="w-full aspect-[2/3] bg-black rounded flex items-center justify-center text-center p-2 transition group-hover:opacity-80">
            <p className="text-xs font-semibold text-white">{manga.titulo}</p>
          </div>
        )}
        {etiqueta && <p className="mt-1 text-sm text-gray-400 text-center">{etiqueta}</p>}
      </Link>
    );
  }

  return (
    <>
      <div className="mt-4 bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
        {haySaga && (
          <div className="flex justify-center gap-4">
            {prequel && (
              <div className={sequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
                <Miniatura manga={prequel} etiqueta="Prequel" />
              </div>
            )}
            {sequel && (
              <div className={prequel ? 'w-1/2' : 'w-1/2 max-w-[200px]'}>
                <Miniatura manga={sequel} etiqueta="Sequel" />
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => {
            setTabModal(haySaga ? 'saga' : grupos[0][0]);
            setModalAbierto(true);
          }}
          className="mt-3 w-full text-center text-sm text-gray-300 underline cursor-pointer"
        >
          See full saga
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
              <h2 className="text-xl font-bold text-white">Related</h2>
              <button
                onClick={() => setModalAbierto(false)}
                className="text-2xl text-gray-400 hover:text-white cursor-pointer transition"
              >
                ×
              </button>
            </div>

            <div className="flex gap-6 border-b border-gray-800 mb-6 flex-wrap">
              {haySaga && (
                <button
                  onClick={() => setTabModal('saga')}
                  className={`pb-3 text-sm font-semibold transition cursor-pointer ${
                    tabModal === 'saga' ? 'text-white border-b-2 border-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Saga
                </button>
              )}
              {grupos.map(([etiqueta]) => (
                <button
                  key={etiqueta}
                  onClick={() => setTabModal(etiqueta)}
                  className={`pb-3 text-sm font-semibold transition cursor-pointer ${
                    tabModal === etiqueta ? 'text-white border-b-2 border-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-5">
              {(tabModal === 'saga' ? data.saga : data.moreContent[tabModal] || []).map((m) => (
                <div key={m.malMangaId}>
                  <Miniatura manga={m} />
                  <p className="mt-2 text-sm font-semibold text-white">{m.titulo}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}