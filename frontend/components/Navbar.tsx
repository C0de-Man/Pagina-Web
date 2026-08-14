'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Navbar() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery)}`);
      setIsSearchOpen(false); // Cerramos el buscador tras buscar
      setSearchQuery(''); // Limpiamos el texto
    }
  };

  return (
    <nav className="bg-[#14181c] text-gray-300 font-sans border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          
          {/* LOGO */}
          <div className="flex-shrink-0 flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              </div>
              <span className="font-extrabold text-white text-xl tracking-tight hover:text-gray-300 transition">
                MediaTracker
              </span>
            </Link>
          </div>

          {/* ENLACES Y BUSCADOR */}
          <div className="flex items-center gap-6">
            {!isSearchOpen ? (
              <>
                <Link href="/peliculas" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">Peliculas</Link>
                <Link href="/series" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">Series</Link>
                <Link href="/comics" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">Comics</Link>
                <Link href="/juegos" className="text-sm font-semibold hover:text-white uppercase tracking-wider transition">Juegos</Link>
                
                {/* LUPA */}
                <button 
                  onClick={() => setIsSearchOpen(true)}
                  className="text-gray-400 hover:text-white transition"
                >
                  <svg xmlns="http://www.w3.org/20Software" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </>
            ) : (
              <form onSubmit={handleSearch} className="flex items-center w-full max-w-md animate-fade-in">
                <button 
                  type="button" 
                  onClick={() => setIsSearchOpen(false)}
                  className="text-gray-400 hover:text-white mr-2"
                >
                  ✕
                </button>
                <div className="relative w-full">
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar película, serie..."
                    className="w-full bg-[#2c3440] text-white text-sm rounded-full pl-4 pr-10 py-1.5 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                  <button type="submit" className="absolute right-3 top-1.5 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </button>
                </div>
              </form>
            )}

            {/* PERFIL */}
            <div className="flex items-center gap-2 border-l border-gray-700 pl-6 ml-2 cursor-pointer group">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white uppercase overflow-hidden">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Miguel" alt="Avatar" className="w-full h-full object-cover" />
              </div>
              <span className="text-sm font-bold uppercase tracking-wider group-hover:text-white transition">Miguel</span>
              <span className="text-xs">▼</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}