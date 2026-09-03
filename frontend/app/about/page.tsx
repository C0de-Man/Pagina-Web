export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl font-bold mb-6">About</h1>
        <div className="text-gray-300 leading-relaxed space-y-4">
          {/* TODO: escribe aquí una breve descripción del proyecto */}
          <p>MediaTracker is a personal project for tracking movies, series, games and more.</p>
        </div>
      </div>
    </main>
  );
}