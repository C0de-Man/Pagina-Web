'use client';
import { useState } from 'react';
import pako from 'pako';

interface FilaImportacion {
  titulo: string;
  tipoMal: string; // "TV" | "Movie" | "OVA" | ...
  status: string;  // "Watching" | "Completed" | "On-Hold" | "Dropped" | "Plan to Watch"
  score: number | null;
}

interface ResultadoImportacion {
  total: number;
  importadas: number;
  noEncontradas: number;
  titulosNoEncontrados: string[];
}

export default function ImportarMalAnime() {
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  function extraerTexto(elemento: Element, tag: string): string {
    const nodo = elemento.querySelector(tag);
    return nodo?.textContent?.trim() || '';
  }

  async function procesarArchivo(file: File) {
    setProcesando(true);
    setError(null);
    setResultado(null);

    try {
      let textoXml: string;

      // MAL exporta en .gz — si el archivo termina en .gz (o si al leerlo
      // como texto no parece XML), lo descomprimimos con pako. Si el
      // usuario ya lo descomprimió a mano, también funciona igual.
      if (file.name.endsWith('.gz')) {
        const buffer = await file.arrayBuffer();
        textoXml = pako.inflate(new Uint8Array(buffer), { to: 'string' });
      } else {
        textoXml = await file.text();
      }

      const parser = new DOMParser();
      const xml = parser.parseFromString(textoXml, 'text/xml');

      const errorParseo = xml.querySelector('parsererror');
      if (errorParseo) {
        setError('El archivo no parece un XML válido de MyAnimeList. Asegúrate de subir el export de anime (no el de manga).');
        setProcesando(false);
        return;
      }

      const animeNodos = Array.from(xml.querySelectorAll('anime'));
      if (animeNodos.length === 0) {
        setError('No se encontró ningún anime en el archivo. ¿Seguro que es el export de ANIME y no el de manga?');
        setProcesando(false);
        return;
      }

      const filas: FilaImportacion[] = animeNodos
        .map((nodo) => {
          const titulo = extraerTexto(nodo, 'series_title');
          if (!titulo) return null;
          const scoreTexto = extraerTexto(nodo, 'my_score');
          const score = scoreTexto && parseInt(scoreTexto, 10) > 0 ? parseInt(scoreTexto, 10) : null;
          return {
            titulo,
            tipoMal: extraerTexto(nodo, 'series_type') || 'TV',
            status: extraerTexto(nodo, 'my_status') || 'Plan to Watch',
            score,
          };
        })
        .filter((f): f is FilaImportacion => f !== null);

      if (filas.length === 0) {
        setError('No se pudo leer ningún título del archivo.');
        setProcesando(false);
        return;
      }

      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:3001/import/mal-anime', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filas }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al importar');
      } else {
        setResultado(data);
      }
    } catch (e) {
      console.error(e);
      setError('No se pudo leer el archivo. Asegúrate de que es el .xml o .xml.gz exportado desde MyAnimeList (Settings → Export en myanimelist.net).');
    }
    setProcesando(false);
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-bold mb-2">Import from MyAnimeList</h1>
        <p className="text-gray-400 text-sm mb-2">
          Ve a{' '}
          
            href="https://myanimelist.net/panel.php?go=export"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-blue-400"
          <a>
            myanimelist.net → Export
          </a>
          , exporta tu lista de <strong>anime</strong> (no la de manga) y sube
          aquí el archivo .xml o .xml.gz resultante.
        </p>
        <p className="text-gray-500 text-xs mb-6">
          Cada título se busca en TMDB (series y películas de anime salen de
          ahí en este proyecto, nunca de MAL). Se importa el estado
          (Watching/Completed/On-Hold/Dropped/Plan to Watch) y tu nota — el
          desglose por episodio no se importa, tendrás que revisarlo a mano
          si lo necesitas.
        </p>

        <label className="block border-2 border-dashed border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-gray-500 transition mb-6">
          <input
            type="file"
            accept=".xml,.gz"
            className="hidden"
            disabled={procesando}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) procesarArchivo(file);
            }}
          />
          <span className="text-gray-300 text-sm">
            {procesando ? 'Procesando…' : 'Haz clic para elegir tu archivo .xml o .xml.gz de MyAnimeList'}
          </span>
        </label>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {resultado && (
          <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-4 text-sm space-y-1">
            <p className="text-green-400 font-semibold">Importación completada.</p>
            <p className="text-gray-300">Total de entradas en el archivo: {resultado.total}</p>
            <p className="text-gray-300">Importadas correctamente: {resultado.importadas}</p>
            <p className="text-gray-300">No encontradas en TMDB: {resultado.noEncontradas}</p>
            {resultado.titulosNoEncontrados.length > 0 && (
              <details className="mt-2">
                <summary className="text-gray-400 cursor-pointer">Ver títulos no encontrados</summary>
                <ul className="mt-2 text-gray-500 list-disc list-inside space-y-0.5">
                  {resultado.titulosNoEncontrados.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </main>
  );
}