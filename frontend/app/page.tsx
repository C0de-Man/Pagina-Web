import Link from 'next/link';
import { generarSlug } from '@/lib/slug';

export default async function Home() {
  // 1. Llamamos a tu backend para pedir los datos (sin guardarlos en caché para que se actualice siempre)
  const res = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const mediaList = await res.json();

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center text-emerald-400">
          Mi Catálogo
        </h1>
        
        {/* 2. Creamos la cuadrícula para las películas */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {mediaList.map((media: any) => (
            
            <Link 
              href={`/peliculas/${generarSlug(media.titulo, media.anio, media.id)}`}
              key={media.id} 
              className="bg-gray-900 rounded-lg overflow-hidden shadow-xl transition-transform hover:scale-105 border border-gray-800 block cursor-pointer"
            >
              {/* Renderizamos la portada si existe */}
              {media.portada ? (
                <img 
                  src={media.portada} 
                  alt={media.titulo} 
                  className="w-full aspect-[2/3] object-cover" 
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-500">
                  Sin imagen
                </div>
              )}
              
              {/* Información de la película */}
              <div className="p-4">
                <h2 className="font-bold text-lg truncate" title={media.titulo}>
                  {media.titulo}
                </h2>
                <div className="flex justify-between items-center mt-2 text-sm text-gray-400">
                  <span>{media.anio}</span>
                  <span className="bg-gray-800 px-2 py-1 rounded-md text-xs border border-gray-700">
                    {media.tipo}
                  </span>
                </div>
              </div>
            </Link>
            
          ))}
        </div>
      </div>
    </main>
  );
}