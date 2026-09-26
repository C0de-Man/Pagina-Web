'use client';
import { useState } from 'react';

interface ResultadoImportacion {
  mediaCreada: number;
  catalogoAñadido: number;
  catalogoSaltado: number;
  logsAñadidos: number;
  listasAñadidas: number;
  listasSaltadas: number;
  favoritosAñadidos: number;
}

export default function ImportarBackup() {
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function procesarArchivo(file: File) {
    setProcesando(true);
    setError(null);
    setResultado(null);

    try {
      const texto = await file.text();
      let data: any;
      try {
        data = JSON.parse(texto);
      } catch {
        setError('El archivo no es un JSON válido. Asegúrate de subir el backup .json generado desde Export.');
        setProcesando(false);
        return;
      }

      if (!Array.isArray(data.catalogo)) {
        setError('Este archivo no parece un backup de MediaTracker (falta el campo "catalogo"). Sube el .json que descargaste desde Import/Export → Export my data.');
        setProcesando(false);
        return;
      }

      const token = localStorage.getItem('token');
      const res = await fetch('${process.env.NEXT_PUBLIC_API_URL}/import/mediatracker-backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      const resultadoData = await res.json();

      if (!res.ok) {
        setError(resultadoData.error || 'Error al importar el backup');
      } else {
        setResultado(resultadoData);
      }
    } catch (e) {
      console.error(e);
      setError('No se pudo leer el archivo. Asegúrate de que es el .json exportado desde MediaTracker.');
    }
    setProcesando(false);
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <h1 className="text-2xl font-bold mb-2">Import from backup</h1>
        <p className="text-gray-400 text-sm mb-6">
          Sube un archivo .json exportado desde MediaTracker (Import/Export → Export my data).
          Solo se añade lo que aún no tengas — nada de lo que ya tienes en tu catálogo, logs o listas se toca ni se sobrescribe.
        </p>

        <label className="block border-2 border-dashed border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-gray-500 transition mb-6">
          <input
            type="file"
            accept=".json"
            className="hidden"
            disabled={procesando}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) procesarArchivo(file);
            }}
          />
          <span className="text-gray-300 text-sm">
            {procesando ? 'Procesando…' : 'Haz clic para elegir tu archivo .json de backup'}
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
            <p className="text-gray-300">Títulos nuevos añadidos: {resultado.catalogoAñadido}</p>
            <p className="text-gray-300">Títulos que ya tenías (sin tocar): {resultado.catalogoSaltado}</p>
            <p className="text-gray-300">Fichas nuevas creadas en la base de datos: {resultado.mediaCreada}</p>
            <p className="text-gray-300">Logs/reseñas añadidos: {resultado.logsAñadidos}</p>
            <p className="text-gray-300">Listas nuevas añadidas: {resultado.listasAñadidas}</p>
            <p className="text-gray-300">Listas que ya tenías (sin tocar): {resultado.listasSaltadas}</p>
            <p className="text-gray-300">Favoritos nuevos añadidos: {resultado.favoritosAñadidos}</p>
          </div>
        )}
      </div>
    </main>
  );
}