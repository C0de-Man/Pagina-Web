'use client';

import { useState, useEffect } from 'react';
import {
  getIdioma,
  getRegion,
  setPreferences,
  IDIOMAS_DISPONIBLES,
  REGIONES_DISPONIBLES,
} from '@/lib/preferences';

export default function SettingsIdiomaRegion() {
  const [idioma, setIdioma] = useState('es-ES');
  const [region, setRegion] = useState('ES');
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    setIdioma(getIdioma());
    setRegion(getRegion());
  }, []);

  const handleGuardar = async () => {
    setGuardando(true);
    setGuardado(false);
    await setPreferences({ idioma, region });
    setGuardando(false);
    setGuardado(true);
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm text-slate-300">Content language</label>
        <select
          value={idioma}
          onChange={(e) => setIdioma(e.target.value)}
          className="w-full rounded bg-slate-800 px-3 py-2 text-white"
        >
          {IDIOMAS_DISPONIBLES.map((i) => (
            <option key={i.codigo} value={i.codigo}>
              {i.nombre}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Affects titles, synopsis and cast on movie pages.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">Region</label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="w-full rounded bg-slate-800 px-3 py-2 text-white"
        >
          {REGIONES_DISPONIBLES.map((r) => (
            <option key={r.codigo} value={r.codigo}>
              {r.nombre}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-400">
          Determines which streaming platforms show up under "Where to watch".
        </p>
      </div>

      <button
        onClick={handleGuardar}
        disabled={guardando}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {guardando ? 'Saving...' : guardado ? 'Saved ✓' : 'Save changes'}
      </button>
    </div>
  );
}