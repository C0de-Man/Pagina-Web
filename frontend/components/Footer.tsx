import Link from 'next/link';

export default function Footer() {
  const anioActual = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-800 bg-[#14181c] mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">

          {/* Enlaces internos */}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-gray-400">
            <Link href="/about" className="hover:text-white transition">About</Link>
            <Link href="/contact" className="hover:text-white transition">Contact</Link>
            <Link href="/terms" className="hover:text-white transition">Terms</Link>
            <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
          </div>

          {/* Créditos de datos */}
          <div className="text-xs text-gray-500 text-center md:text-right">
            <p>
              Movie & series data from{' '}
              <a
                href="https://www.themoviedb.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 underline transition"
              >
                TMDB
              </a>
              . Game data from{' '}
              <a
                href="https://www.igdb.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 underline transition"
              >
                IGDB
              </a>
              . Game covers & banners from{' '}
              <a
                href="https://www.steamgriddb.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 underline transition"
              >
                SteamGridDB
              </a>
              .
            </p>
          </div>

        </div>

        <div className="mt-6 pt-6 border-t border-gray-900 text-center text-xs text-gray-600">
          © {anioActual} MediaTracker. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </div>
      </div>
    </footer>
  );
}