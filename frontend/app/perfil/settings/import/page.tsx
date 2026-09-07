'use client';
import { useState } from 'react';
import JSZip from 'jszip';
import Papa from 'papaparse';

interface FilaImportacion {
  titulo: string;
  anio: number | null;
  watched: boolean;
  fechaVisto: string | null;
  rating: number | null;
  review: string | null;
  watchlist: boolean;
}

interface ResultadoImportacion {
  total: number;
  importadas: number;
  noEncontradas: number;
  titulosNoEncontrados: string[];
}

export default function ImportarLetterboxd() {
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lee un CSV dentro del zip por su nombre exacto (dentro de la carpeta
  // raíz que Letterboxd suele meter). Devuelve [] si el archivo no existe
  // (no todos los exports tienen los 4 CSV — reviews.csv, por ejemplo, solo
  // aparece si de verdad has escrito alguna reseña alguna vez).
  async function leerCsvDelZip(zip: JSZip, nombreArchivo: string): Promise<any[]> {
    const archivo = Object.values(zip.files).find((f) => f.name.endsWith(nombreArchivo) && !f.dir);
    if (!archivo) return [];
    const texto = await archivo.async('text');
    const parsed = Papa.parse(texto, { header: true, skipEmptyLines: true });
    return parsed.data as any[];
  }

  async function procesarArchivo(file: File) {
    setProcesando(true);
    setError(null);
    setResultado(null);

    try {
      const zip = await JSZip.loadAsync(file);

      const [diary, watched, ratings, reviews, watchlist] = await Promise.all([
        leerCsvDelZip(zip, 'diary.csv'),
        leerCsvDelZip(zip, 'watched.csv'),
        leerCsvDelZip(zip, 'ratings.csv'),
        leerCsvDelZip(zip, 'reviews.csv'),
        leerCsvDelZip(zip, 'watchlist.csv'),
      ]);

      // Base: diary.csv si existe (trae fecha exacta de visionado), si no
      // watched.csv (solo título+año, sin fecha).
      const base = diary.length > 0 ? diary : watched;

      // Clave de emparejamiento: título+año en minúsculas, para cruzar la
      // misma película entre los distintos CSV (Letterboxd no comparte un
      // id común entre ellos, solo el propio título+año).
      const clave = (titulo: string, anio: string | number) => `${(titulo || '').trim().toLowerCase()}-${anio || ''}`;

      const ratingsPorClave = new Map(ratings.map((r) => [clave(r.Name, r.Year), r.Rating]));
      const reviewsPorClave = new Map(reviews.map((r) => [clave(r.Name, r.Year), r.Review]));
      const watchlistClaves = new Set(watchlist.map((w) => clave(w.Name, w.Year)));

      const vistasClaves = new Set(base.map((b) => clave(b.Name, b.Year)));

      const filas: FilaImportacion[] = base.map((b) => {
        const k = clave(b.Name, b.Year);
        const ratingRaw = ratingsPorClave.get(k);
        return {
          titulo: b.Name,
          anio: b.Year ? parseInt(b.Year, 10) : null,
          watched: true,
          fechaVisto: b['Watched Date'] || b.Date || null,
          rating: ratingRaw ? parseFloat(ratingRaw) : null,
          review: reviewsPorClave.get(k) || null,
          watchlist: false,
        };
      });

      // Watchlist: añadimos las que NO estén ya en "vistas" como filas
      // aparte (marcadas solo como watchlist, no watched).
      for (const w of watchlist) {
        const k = clave(w.Name, w.Year);
        if (vistasClaves.has(k)) continue;
        filas.push({
          titulo: w.Name,
          anio: w.Year ? parseInt(w.Year, 10) : null,
          watched: false,
          fechaVisto: null,
          rating: null,
          review: null,
          watchlist: true,
        });
      }

      if (filas.length === 0) {
        setError('No se encontró ningún dato reconocible en el archivo. Asegúrate de subir el .zip completo exportado desde Letterboxd (Settings → Import & Export → Export Data).');
        setProcesando(false);
        return;
      }

      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:3001/import/letterboxd', {
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
      setError('No se pudo leer el archivo. Asegúrate de que es el .zip exportado desde Letterboxd, sin descomprimir.');
    }
    setProcesando(false);
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-bold mb-2">Import from Letterboxd</h1>
        <p className="text-gray-400 text-sm mb-6">
          Sube el archivo .zip que Letterboxd te da al exportar tus datos
          (Settings → Import & Export → Export Data en letterboxd.com). Se
          importarán tus películas vistas, notas, reseñas y watchlist.
        </p>

        <label className="block border-2 border-dashed border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-gray-500 transition mb-6">
          <input
            type="file"
            accept=".zip"
            className="hidden"
            disabled={procesando}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) procesarArchivo(file);
            }}
          />
          <span className="text-gray-300 text-sm">
            {procesando ? 'Procesando…' : 'Haz clic para elegir tu archivo .zip de Letterboxd'}
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