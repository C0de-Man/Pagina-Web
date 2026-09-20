import BookSearchBox from '@/components/BookSearchBox';
import YearBooksCarousel from '@/components/YearBooksCarousel';

export default async function BooksPage() {
  const currentYear = new Date().getFullYear();

  const resYear = await fetch(`http://localhost:3001/libros/anio/${currentYear}`, { cache: 'no-store' });
  const librosDelAño = await resYear.json();

  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  // Igual que en Movies: aquí solo comprobamos si el título ya está
  // guardado (dbId), sin inventar un customPoster — esta es una página de
  // servidor sin acceso a tu token, así que BookCard es quien comprueba tu
  // personalización real en el navegador.
  const getLocalData = (libro: any) => {
    const local = myDb.find((m: any) =>
      (libro.fuente === 'mal' && m.malMangaId === libro.origenId) ||
      (libro.fuente === 'comicvine' && m.comicVineId === libro.origenId)
    );
    return {
      dbId: local ? local.id : null,
      customPoster: null,
    };
  };

  const librosDelAñoConDatos = librosDelAño.map((libro: any) => ({
    libro,
    ...getLocalData(libro),
  }));

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <BookSearchBox />

        {librosDelAñoConDatos.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xl font-bold mb-4">Books {currentYear}</h2>
            <YearBooksCarousel items={librosDelAñoConDatos} />
          </div>
        )}
      </div>
    </main>
  );
}