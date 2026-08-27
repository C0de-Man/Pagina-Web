// components/SortDropdown.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpcionOrden, ValorOrden } from '../lib/ordenamiento';

interface Props {
  opciones: OpcionOrden[];
  valor: ValorOrden;
  onChange: (nuevo: ValorOrden) => void;
}

export default function SortDropdown({ opciones, valor, onChange }: Props) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function alClicarFuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClicarFuera);
    return () => document.removeEventListener('mousedown', alClicarFuera);
  }, []);

  const opcionActual = opciones.find((o) => o.campo === valor.campo);
  const etiquetaActual = opcionActual
    ? opcionActual.tipo === 'grupo'
      ? opcionActual.subopciones.find((s) => s.direccion === valor.direccion)?.etiqueta ??
        opcionActual.etiqueta
      : opcionActual.etiqueta
    : 'Sort by';

  function elegir(campo: string, direccion: ValorOrden['direccion']) {
    onChange({ campo, direccion });
    setAbierto(false);
  }

  return (
    <div className="relative inline-block text-sm" ref={ref}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-zinc-500"
      >
        <span className="text-zinc-500">Sort by</span>
        <span className="font-medium text-white">{etiquetaActual}</span>
        <svg
          className={`h-3 w-3 text-zinc-500 transition-transform ${abierto ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {abierto && (
        <div className="absolute right-0 z-50 mt-1 w-56 max-h-96 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-xl">
          {opciones.map((opcion) => {
            if (opcion.tipo === 'simple') {
              const seleccionado = valor.campo === opcion.campo;
              return (
                <button
                  key={opcion.campo}
                  type="button"
                  onClick={() => elegir(opcion.campo, opcion.direccion)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-700 ${
                    seleccionado ? 'text-white' : 'text-zinc-300'
                  }`}
                >
                  <span className="w-4">{seleccionado ? '✓' : ''}</span>
                  {opcion.etiqueta}
                </button>
              );
            }

            return (
              <div key={opcion.campo} className="border-t border-zinc-700 first:border-t-0">
                <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {opcion.etiqueta}
                </div>
                {opcion.subopciones.map((sub) => {
                  const seleccionado = valor.campo === opcion.campo && valor.direccion === sub.direccion;
                  return (
                    <button
                      key={sub.direccion}
                      type="button"
                      onClick={() => elegir(opcion.campo, sub.direccion)}
                      className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-zinc-700 ${
                        seleccionado ? 'text-green-400' : 'text-zinc-300'
                      }`}
                    >
                      <span className="w-4">{seleccionado ? '✓' : ''}</span>
                      {sub.etiqueta}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}