'use client';
import { useRef, useState, useCallback } from 'react';

// A diferencia de la primera versión (zoom centrado, sin arrastre, copiado
// del patrón de AvatarCropModal), aquí la imagen se muestra fija a tamaño
// completo y es la CAJA DE SELECCIÓN la que se arrastra encima — más parecido
// a un editor de recorte normal. El tamaño de la caja (proporción de zoom) se
// controla con el slider; la proporción ancho/alto de la caja siempre es la
// del banner final, así que lo que ves seleccionado es exactamente lo que
// sale recortado.
const RATIO = 1200 / 375; // ancho/alto de salida (~16:5, parecido al banner real)
const ANCHO_SALIDA = 1200;
const ALTO_SALIDA = 375;
const ANCHO_CONTENEDOR = 760; // ancho fijo del área de recorte dentro del modal

export default function BannerCropModal({
  imagenSrc,
  onClose,
  onSave,
}: {
  imagenSrc: string;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgListo, setImgListo] = useState(false);
  const [errorCors, setErrorCors] = useState(false);

  // Tamaño de render de la imagen dentro del contenedor de ancho fijo
  const [renderH, setRenderH] = useState(0);

  // Caja de selección, en píxeles DE PANTALLA (relativos a la imagen renderizada)
  const [boxW, setBoxW] = useState(0);
  const [boxX, setBoxX] = useState(0);
  const [boxY, setBoxY] = useState(0);

  // Arrastre en curso
  const arrastrando = useRef<{ startX: number; startY: number; boxX0: number; boxY0: number } | null>(null);

  const boxH = boxW / RATIO;

  const handleLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const h = ANCHO_CONTENEDOR * (img.naturalHeight / img.naturalWidth);
    setRenderH(h);

    // Caja inicial: lo más grande posible centrada, respetando los límites
    // de la imagen en ambos ejes.
    const wPorAncho = ANCHO_CONTENEDOR;
    const wPorAlto = h * RATIO;
    const wInicial = Math.min(wPorAncho, wPorAlto);
    setBoxW(wInicial);
    setBoxX((ANCHO_CONTENEDOR - wInicial) / 2);
    setBoxY((h - wInicial / RATIO) / 2);
    setImgListo(true);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    arrastrando.current = { startX: e.clientX, startY: e.clientY, boxX0: boxX, boxY0: boxY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!arrastrando.current) return;
      const dx = e.clientX - arrastrando.current.startX;
      const dy = e.clientY - arrastrando.current.startY;
      const nuevoX = Math.min(Math.max(arrastrando.current.boxX0 + dx, 0), ANCHO_CONTENEDOR - boxW);
      const nuevoY = Math.min(Math.max(arrastrando.current.boxY0 + dy, 0), renderH - boxH);
      setBoxX(nuevoX);
      setBoxY(nuevoY);
    },
    [boxW, boxH, renderH]
  );

  const onPointerUp = () => {
    arrastrando.current = null;
  };

  // El slider controla el tamaño de la caja: más pequeña = más "zoom" (se
  // recorta una porción menor de la imagen y luego se estira al tamaño de
  // salida). Al cambiar el tamaño, recentramos la caja para que no se salga
  // de los límites de la imagen.
  const cambiarZoom = (valor: number) => {
    const wMax = Math.min(ANCHO_CONTENEDOR, renderH * RATIO);
    const nuevoW = wMax * valor;
    const nuevoH = nuevoW / RATIO;
    setBoxX((prev) => Math.min(Math.max(prev, 0), ANCHO_CONTENEDOR - nuevoW));
    setBoxY((prev) => Math.min(Math.max(prev, 0), renderH - nuevoH));
    setBoxW(nuevoW);
  };

  const guardar = () => {
    const img = imgRef.current;
    if (!img || !renderH) return;

    const escala = img.naturalWidth / ANCHO_CONTENEDOR;
    const sx = boxX * escala;
    const sy = boxY * escala;
    const sw = boxW * escala;
    const sh = boxH * escala;

    const canvas = document.createElement('canvas');
    canvas.width = ANCHO_SALIDA;
    canvas.height = ALTO_SALIDA;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ANCHO_SALIDA, ALTO_SALIDA);

    try {
      onSave(canvas.toDataURL('image/jpeg', 0.85));
    } catch (e) {
      console.error('No se pudo exportar el recorte (posible bloqueo CORS del origen de la imagen):', e);
      setErrorCors(true);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl p-6 text-white shadow-2xl"
      >
        <h2 className="text-lg font-bold mb-4">Ajusta el banner</h2>

        <div
          className="relative mx-auto bg-gray-800 select-none"
          style={{ width: ANCHO_CONTENEDOR, height: renderH || undefined }}
        >
          <img
            ref={imgRef}
            src={imagenSrc}
            alt="preview"
            onLoad={handleLoad}
            draggable={false}
            className="w-full h-auto block pointer-events-none"
          />

          {imgListo && (
            <>
              {/* Oscurece todo lo que queda FUERA de la caja de selección */}
              <div className="absolute inset-0 bg-black/60 pointer-events-none" />
              <div
                className="absolute overflow-hidden"
                style={{ left: boxX, top: boxY, width: boxW, height: boxH }}
              >
                <img
                  src={imagenSrc}
                  alt=""
                  draggable={false}
                  className="pointer-events-none"
                  style={{
                    position: 'absolute',
                    left: -boxX,
                    top: -boxY,
                    width: ANCHO_CONTENEDOR,
                    height: renderH,
                    maxWidth: 'none',
                  }}
                />
              </div>

              {/* Caja arrastrable */}
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="absolute border-2 border-blue-400 cursor-move"
                style={{ left: boxX, top: boxY, width: boxW, height: boxH }}
              >
                <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-blue-400 rounded-full" />
                <div className="absolute -right-1.5 -top-1.5 w-3 h-3 bg-blue-400 rounded-full" />
                <div className="absolute -left-1.5 -bottom-1.5 w-3 h-3 bg-blue-400 rounded-full" />
                <div className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-blue-400 rounded-full" />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <span className="text-gray-400">-</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.01}
            defaultValue={1}
            onChange={(e) => cambiarZoom(parseFloat(e.target.value))}
            className="flex-grow"
          />
          <span className="text-gray-400">+</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Arrastra la caja azul para elegir qué parte de la imagen usar.</p>

        {errorCors && (
          <p className="text-red-400 text-xs mt-3">
            No se pudo recortar esta imagen (el servidor de origen no lo permite). Prueba con otra, o avisa para
            buscar otra solución.
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm cursor-pointer">
            Cancel
          </button>
          <button
            onClick={guardar}
            className="bg-green-600 hover:bg-green-500 px-5 py-2 rounded font-bold text-sm transition cursor-pointer"
          >
            Save Banner
          </button>
        </div>
      </div>
    </div>
  );
}