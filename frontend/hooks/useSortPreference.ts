// hooks/useSortPreference.ts
import { useEffect, useState } from 'react';
import type { ValorOrden } from '../lib/ordenamiento';

// Igual que el JWT del proyecto, esto vive en localStorage (por navegador,
// no por cuenta). Si en el futuro quieres que el orden elegido viaje entre
// dispositivos habría que guardarlo en el backend (PATCH /auth/me/preferences
// ya existe para otras preferencias y podría ampliarse), pero de momento es
// más simple y no toca schema.prisma.

function claveStorage(seccion: string) {
  return `mediatracker:orden:${seccion}`;
}

export function useSortPreference(seccion: string, valorPorDefecto: ValorOrden) {
  const [valor, setValorState] = useState<ValorOrden>(valorPorDefecto);
  const [cargado, setCargado] = useState(false);

  // Cargar preferencia guardada al montar (solo en cliente)
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(claveStorage(seccion));
      if (guardado) {
        const parsed = JSON.parse(guardado) as ValorOrden;
        if (parsed?.campo && parsed?.direccion) {
          setValorState(parsed);
        }
      }
    } catch {
      // localStorage corrupto o inaccesible: nos quedamos con el valor por defecto
    } finally {
      setCargado(true);
    }
  }, [seccion]);

  function setValor(nuevo: ValorOrden) {
    setValorState(nuevo);
    try {
      localStorage.setItem(claveStorage(seccion), JSON.stringify(nuevo));
    } catch {
      // si falla el guardado, el orden sigue funcionando esta sesión, solo no persiste
    }
  }

  return { valor, setValor, cargado };
}