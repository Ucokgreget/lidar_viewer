import { Link } from "react-router";

export function Welcome() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black font-sans">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-8">
          Lidar Viewer
        </h1>
        
        <Link
          to="/potree"
          className="inline-block px-10 py-3 bg-black text-white font-medium rounded hover:bg-gray-800 transition-colors"
        >
          Start
        </Link>
      </div>
    </div>
  );
}
