import { useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router";

type ConvertResponse = {
    job_id: string;
    classified_filename: string;
    potree_output_dir: string;
    metadata_path: string;
    viewer_src: string;
    viewer_url: string;
    message: string;
};

export default function ConversionPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const jobId = searchParams.get("job_id");

    const [isConverting, setIsConverting] = useState(false);
    const [error, setError] = useState("");

    const handleConvert = async () => {
        if (!jobId) {
            setError("Job ID tidak ditemukan.");
            return;
        }

        setError("");
        setIsConverting(true);

        try {
            const response = await fetch(`http://localhost:8000/convert/${encodeURIComponent(jobId)}`, {
                method: "POST",
            });

            const rawText = await response.text();
            if (!response.ok) {
                throw new Error(rawText || "Gagal melakukan konversi.");
            }

            try {
                const parsed: ConvertResponse = JSON.parse(rawText);
                if (parsed.viewer_url) {
                    navigate(parsed.viewer_url);
                } else {
                    throw new Error("viewer_url tidak ditemukan dalam response.");
                }
            } catch (err) {
                if (err instanceof SyntaxError) {
                    throw new Error("Invalid JSON response dari server: " + rawText);
                }
                throw err;
            }
        } catch (err) {
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError("Terjadi kesalahan saat konversi.");
            }
        } finally {
            setIsConverting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950 p-4 sm:p-8 flex items-center justify-center font-sans">
            <div className="w-full max-w-xl bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-10 shadow-2xl">
                <div className="flex flex-col mb-8 gap-2">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
                        Konversi Potree
                    </h1>
                    <p className="text-slate-400 text-sm">Ubah data klasifikasi menjadi visualisasi 3D Potree.</p>
                </div>

                <div className="p-6 bg-slate-800/30 border border-white/5 rounded-xl border-dashed mb-8">
                    <label className="block mb-2 text-sm font-semibold text-slate-200">
                        Job ID Saat Ini
                    </label>
                    <div className="px-4 py-3 bg-slate-900 border border-white/10 rounded-lg text-indigo-300 font-mono text-sm break-all">
                        {jobId || <span className="text-red-400">Job ID tidak tersedia. Harap kembali ke halaman klasifikasi.</span>}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                    <button
                        onClick={handleConvert}
                        disabled={!jobId || isConverting}
                        className="flex-1 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isConverting ? (
                            <span className="flex items-center justify-center gap-2">
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Converting...
                            </span>
                        ) : "Convert ke Potree"}
                    </button>
                    <Link
                        to="/classification"
                        className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white text-center font-medium rounded-lg border border-white/10 transition-all focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                    >
                        Kembali
                    </Link>
                </div>

                {error && (
                    <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm flex items-start gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                        <span className="whitespace-pre-wrap">{error}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
