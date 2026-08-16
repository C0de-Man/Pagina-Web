'use client';
import { useState, useRef } from 'react';

export default function AvatarCropModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const SIZE = 300;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  };

  const guardar = () => {
    const img = imgRef.current;
    if (!img) return;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseScale = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
    const finalScale = baseScale * scale;
    const drawWidth = img.naturalWidth * finalScale;
    const drawHeight = img.naturalHeight * finalScale;
    const dx = (SIZE - drawWidth) / 2;
    const dy = (SIZE - drawHeight) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, dx, dy, drawWidth, drawHeight);
    ctx.restore();

    onSave(canvas.toDataURL('image/jpeg', 0.85));
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md p-6 text-white shadow-2xl"
      >
        <h2 className="text-lg font-bold mb-4">Avatar</h2>

        {!imgSrc ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold text-sm transition cursor-pointer"
            >
              Elegir imagen de tu ordenador
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </div>
        ) : (
          <>
            <div
              className="mx-auto rounded-full overflow-hidden border border-gray-700 bg-gray-800"
              style={{ width: SIZE, height: SIZE }}
            >
              <img
                ref={imgRef}
                src={imgSrc}
                alt="preview"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${scale})`,
                }}
              />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <span className="text-gray-400">-</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value))}
                className="flex-grow"
              />
              <span className="text-gray-400">+</span>
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm cursor-pointer">
            Cancel
          </button>
          {imgSrc && (
            <button
              onClick={guardar}
              className="bg-green-600 hover:bg-green-500 px-5 py-2 rounded font-bold text-sm transition cursor-pointer"
            >
              Save Avatar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}