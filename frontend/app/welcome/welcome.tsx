import { Link } from "react-router";

export function Welcome() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black font-sans">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-8">
          Lidar Viewer
        </h1>

        <div className="flex items-center justify-center gap-3">
          <Link
            to="/potree"
            className="inline-block px-10 py-3 bg-black text-white font-medium rounded hover:bg-gray-800 transition-colors"
          >
            Start Viewer
          </Link>
          <Link
            to="/classification"
            className="inline-block px-10 py-3 border border-black text-black font-medium rounded hover:bg-gray-100 transition-colors"
          >
            Classification
          </Link>
        </div>
      </div>
    </div>
  );
}
