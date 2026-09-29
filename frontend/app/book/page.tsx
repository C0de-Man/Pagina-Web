import BookSearchBox from '@/components/BookSearchBox';

export default async function BooksPage() {
  const currentYear = new Date().getFullYear();

  const resYear = await fetch(`http://localhost:3001/libros/anio/${currentYear}`, { cache: 'no-store' });
  const librosDelAño = await resYear.json();

  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

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
        <h1 className="text-2xl font-extrabold mb-6">Books</h1>
        <BookSearchBox añoActual={currentYear} librosDelAño={librosDelAñoConDatos} />
      </div>
    </main>
  );
}