'use client';
import { useState } from 'react';
import Papa from 'papaparse';

interface FilaImportacion {
  titulo: string;
  rating: number | null;
}

interface ResultadoImportacion {
  total: number;
  importadas: number;
  noEncontradas: number;
  titulosNoEncontrados: string[];
}

export default function ImportarBackloggd() {
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function procesarArchivo(file: File) {
    setProcesando(true);
    setError(null);
    setResultado(null);

    try {
      const texto = await file.text();
      const parsed = Papa.parse(texto, { header: true, skipEmptyLines: true });
      const filasCrudas = parsed.data as any[];

      const filas: FilaImportacion[] = filasCrudas
        .filter((f) => f.Title && f.Title.trim())
        .map((f) => ({
          titulo: f.Title.trim(),
          rating: f.Rating && f.Rating.trim() ? parseFloat(f.Rating) : null,
        }));

      if (filas.length === 0) {
        setError('No se encontró ningún dato reconocible en el archivo. Asegúrate de subir el .csv generado por BackloggdExporter (columnas Title y Rating).');
        setProcesando(false);
        return;
      }

      const token = localStorage.getItem('token');
      const res = await fetch('http://localhost:3001/import/backloggd', {
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
      setError('No se pudo leer el archivo. Asegúrate de que es el .csv generado por BackloggdExporter.');
    }
    setProcesando(false);
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-bold mb-2">Import from Backloggd</h1>
        <p className="text-gray-400 text-sm mb-2">
          Backloggd no tiene exportación oficial. Genera primero el .csv con la
          herramienta de terceros{' '}
          
            href="https://github.com/Medpus/BackloggdExporter"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-blue-400"
          <a>
            BackloggdExporter
          </a>{' '}
          (ejecutándola contra tu perfil público) y sube aquí el archivo
          resultante.
        </p>
        <p className="text-gray-500 text-xs mb-6">
          Solo se importan título y nota (convertida de la escala 0-5 de
          Backloggd a la 0-10 de aquí). Estado, fecha jugado y plataforma no
          vienen en este export — puedes repasarlos a mano después.
        </p>

        <label className="block border-2 border-dashed border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-gray-500 transition mb-6">
          <input
            type="file"
            accept=".csv"
            className="hidden"
            disabled={procesando}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) procesarArchivo(file);
            }}
          />
          <span className="text-gray-300 text-sm">
            {procesando ? 'Procesando…' : 'Haz clic para elegir tu archivo .csv de Backloggd'}
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
            <p className="text-gray-300">No encontradas en IGDB: {resultado.noEncontradas}</p>
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