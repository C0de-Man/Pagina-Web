import BookSearchBox from '@/components/BookSearchBox';

export default function BooksPage() {
  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">Books</h1>
        <BookSearchBox />
      </div>
    </main>
  );
}