

import { useMemo, useState } from "react";
import { Link } from "react-router";

type ClassificationFormValues = {
    file: File | null;
    cell: number;
    window: number;
    threshold: number;
    slope: number;
    scalar: number;
    returns: string;
    count: number;
    allow_extrapolation: boolean;
    tree_min_h: number;
    chunk_size: number;
};

const defaultValues: ClassificationFormValues = {
    file: null,
    cell: 1,
    window: 18,
    threshold: 0.5,
    slope: 0.15,
    scalar: 1.25,
    returns: "first, last, intermediate, only",
    count: 10,
    allow_extrapolation: true,
    tree_min_h: 3,
    chunk_size: 2_000_000,
};

export default function Classification() {
    const [values, setValues] = useState<ClassificationFormValues>(defaultValues);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [result, setResult] = useState<string>("");
    const [error, setError] = useState<string>("");

    const fileName = useMemo(() => values.file?.name ?? "Belum ada file dipilih", [values.file]);

    const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        setResult("");

        if (!values.file) {
            setError("File wajib dipilih.");
            return;
        }

        const formData = new FormData();
        formData.append("file", values.file);
        formData.append("cell", String(values.cell));
        formData.append("window", String(values.window));
        formData.append("threshold", String(values.threshold));
        formData.append("slope", String(values.slope));
        formData.append("scalar", String(values.scalar));
        formData.append("returns", values.returns);
        formData.append("count", String(values.count));
        formData.append("allow_extrapolation", String(values.allow_extrapolation));
        formData.append("tree_min_h", String(values.tree_min_h));
        formData.append("chunk_size", String(values.chunk_size));

        try {
            setIsSubmitting(true);
            const response = await fetch("http://localhost:8000/classify", {
                method: "POST",
                body: formData,
            });

            const rawText = await response.text();
            if (!response.ok) {
                throw new Error(rawText || "Request klasifikasi gagal.");
            }

            try {
                const parsed = JSON.parse(rawText);
                setResult(JSON.stringify(parsed, null, 2));
            } catch {
                setResult(rawText || "Klasifikasi berhasil.");
            }
        } catch (submitError) {
            if (submitError instanceof Error) {
                setError(submitError.message);
            } else {
                setError("Terjadi kesalahan saat mengirim form.");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClasses = "w-full px-4 py-2.5 bg-slate-800/50 border border-white/10 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
    const labelClasses = "block mb-2 text-sm font-medium text-slate-300";

    return (
        <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950 p-4 sm:p-8 flex items-center justify-center font-sans">
            <div className="w-full max-w-4xl bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 sm:p-10 shadow-2xl">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4 sm:gap-0">
                    <div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
                            Klasifikasi Pohon
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">Konfigurasi parameter klasifikasi LiDAR Anda.</p>
                    </div>
                    <Link 
                        to="/" 
                        className="text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-lg px-4 py-2 transition-all flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                        Kembali
                    </Link>
                </div>

                <form onSubmit={onSubmit} encType="multipart/form-data" className="space-y-8">
                    {/* File Upload Section */}
                    <div className="p-6 bg-slate-800/30 border border-white/5 rounded-xl border-dashed">
                        <label htmlFor="file" className="block mb-3 text-sm font-semibold text-slate-200">
                            File Point Cloud (.las, .laz)
                        </label>
                        <div className="flex items-center gap-4">
                            <label className="cursor-pointer">
                                <span className="px-4 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-lg text-sm font-medium transition-colors inline-block">
                                    Pilih File
                                </span>
                                <input
                                    id="file"
                                    type="file"
                                    accept=".las,.laz"
                                    className="hidden"
                                    onChange={(e) => {
                                        const nextFile = e.target.files?.[0] ?? null;
                                        setValues((prev) => ({ ...prev, file: nextFile }));
                                    }}
                                />
                            </label>
                            <span className="text-sm text-slate-400 truncate max-w-[200px] sm:max-w-md">
                                {fileName}
                            </span>
                        </div>
                    </div>

                    {/* Parameters Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                        <div>
                            <label className={labelClasses}>Cell</label>
                            <input type="number" value={values.cell} onChange={(e) => setValues((prev) => ({ ...prev, cell: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Window</label>
                            <input type="number" value={values.window} onChange={(e) => setValues((prev) => ({ ...prev, window: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Threshold</label>
                            <input type="number" step="any" value={values.threshold} onChange={(e) => setValues((prev) => ({ ...prev, threshold: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Slope</label>
                            <input type="number" step="any" value={values.slope} onChange={(e) => setValues((prev) => ({ ...prev, slope: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Scalar</label>
                            <input type="number" step="any" value={values.scalar} onChange={(e) => setValues((prev) => ({ ...prev, scalar: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Returns</label>
                            <input type="text" value={values.returns} onChange={(e) => setValues((prev) => ({ ...prev, returns: e.target.value }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Count</label>
                            <input type="number" value={values.count} onChange={(e) => setValues((prev) => ({ ...prev, count: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div>
                            <label className={labelClasses}>Allow Extrapolation</label>
                            <select value={String(values.allow_extrapolation)} onChange={(e) => setValues((prev) => ({ ...prev, allow_extrapolation: e.target.value === "true" }))} className={inputClasses}>
                                <option value="true">True</option>
                                <option value="false">False</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelClasses}>Tree Min Height</label>
                            <input type="number" step="any" value={values.tree_min_h} onChange={(e) => setValues((prev) => ({ ...prev, tree_min_h: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                        <div className="sm:col-span-2 md:col-span-3">
                            <label className={labelClasses}>Chunk Size</label>
                            <input type="number" value={values.chunk_size} onChange={(e) => setValues((prev) => ({ ...prev, chunk_size: Number(e.target.value) }))} className={inputClasses} />
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/5">
                        <button 
                            type="submit" 
                            disabled={isSubmitting} 
                            className="flex-1 sm:flex-none px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/25 transition-all focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Memproses...
                                </span>
                            ) : "Jalankan Klasifikasi"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setValues(defaultValues);
                                setError("");
                                setResult("");
                            }}
                            className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg border border-white/10 transition-all focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                        >
                            Reset
                        </button>
                    </div>

                    {error && (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm flex items-start gap-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                            {error}
                        </div>
                    )}
                    
                    {result && (
                        <div className="mt-6 rounded-xl overflow-hidden border border-slate-700/50 bg-slate-950/50">
                            <div className="bg-slate-800/80 px-4 py-2 border-b border-slate-700/50 flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Hasil Klasifikasi</span>
                            </div>
                            <pre className="p-4 m-0 text-xs text-indigo-200 overflow-x-auto whitespace-pre-wrap break-words">
                                {result}
                            </pre>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
}