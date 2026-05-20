//routes/potree-viewer.tsx
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { redirect } from "react-router";
import type { Route } from "./+types/potree-viewer";
import PotreeViewer from "../component/PotreeViewer";

type AoiPolygon = Array<[number, number]>;

type GeoJsonPointFeature = {
	type: "Feature";
	geometry: {
		type: "Point";
		coordinates: [number, number, number?];
	};
	properties?: {
		id?: number;
		height?: number;
		[key: string]: unknown;
	};
};

type GeoJsonFeatureCollection = {
	type: "FeatureCollection";
	features: GeoJsonPointFeature[];
};

type TreeCountGeojsonResponse = {
	job_id: string;
	count: number;
	using_aoi: boolean;
	geojson: GeoJsonFeatureCollection;
	count_params: Record<string, unknown>;
	las_bounds: Record<string, unknown>;
	processing_bounds: Record<string, unknown>;
	debug_info?: Record<string, unknown>;
	metadata?: {
		count_result?: {
			count?: number;
			chm_width?: number;
			chm_height?: number;
			chm_res?: number;
		};
		count_params?: Record<string, unknown>;
		las_bounds?: Record<string, unknown>;
		processing_bounds?: Record<string, unknown>;
	};
};

type TreeCountParams = {
	chm_res: number;
	min_tree_distance: number;
	tree_count_min_h: number;
	smooth_sigma: number;
	chunk_size: number;
};

type MarkerSettings = {
	marker_radius: number;
	marker_z_offset: number;
};

type SweepPreset = {
	label: string;
	min_tree_distance: number;
	smooth_sigma: number;
};

type SweepResult = SweepPreset & {
	count: number;
	geojson: GeoJsonFeatureCollection;
	using_aoi: boolean;
	chm_res: number;
	tree_count_min_h: number;
};

type VolumeParams = {
	resolution: number;
	smooth_sigma: number;
};

type VolumeResult = {
	volume_cut_m3: number;
	volume_fill_m3: number;
	net_volume_m3: number;
	stockpile_area_m2: number;
	total_aoi_area_m2: number;
	max_height_m: number;
	avg_height_m: number;
	resolution: number;
	ground_points_used: number;
	using_aoi: boolean;
};

const DEFAULT_COUNT_PARAMS: TreeCountParams = {
	chm_res: 0.5,
	min_tree_distance: 6.0,
	tree_count_min_h: 3.0,
	smooth_sigma: 1.0,
	chunk_size: 2_000_000,
};

const DEFAULT_MARKER_SETTINGS: MarkerSettings = {
	marker_radius: 2.0,
	marker_z_offset: 4.0,
};

const COUNT_PRESETS: SweepPreset[] = [
	{ label: "Conservative", min_tree_distance: 7.0, smooth_sigma: 1.2 },
	{ label: "Default", min_tree_distance: 6.0, smooth_sigma: 1.0 },
	{ label: "Sensitive", min_tree_distance: 5.0, smooth_sigma: 0.8 },
	{ label: "Very Sensitive", min_tree_distance: 4.5, smooth_sigma: 0.7 },
];

const SWEEP_PRESETS: SweepPreset[] = [
	...COUNT_PRESETS,
	{ label: "Aggressive", min_tree_distance: 4.0, smooth_sigma: 0.5 },
];

const DEFAULT_VOLUME_PARAMS: VolumeParams = {
	resolution: 0.5,
	smooth_sigma: 0.5,
};

function getFilenameFromDisposition(disposition: string | null, fallback: string): string {
	if (!disposition) return fallback;
	const match = /filename\*?=(?:UTF-8''|"?)([^;"\n]+)/i.exec(disposition);
	if (!match) return fallback;
	try {
		return decodeURIComponent(match[1].replace(/"/g, ""));
	} catch {
		return match[1].replace(/"/g, "");
	}
}

async function readErrorPayload(response: Response): Promise<{ message: string; detail: string | null }> {
	const raw = await response.text();
	if (!raw) return { message: "Request gagal.", detail: null };
	try {
		const parsed = JSON.parse(raw) as { detail?: unknown };
		const detailText = JSON.stringify(parsed, null, 2);
		if (parsed?.detail !== undefined) {
			const detailMessage = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
			return { message: detailMessage, detail: detailText };
		}
		return { message: "Request gagal.", detail: detailText };
	} catch {
		return { message: raw, detail: raw };
	}
}

export function loader({ request }: Route.LoaderArgs) {
	const requestUrl = new URL(request.url);
	const src = requestUrl.searchParams.get("src");
	const jobId = requestUrl.searchParams.get("job_id");
	if (!src || !src.startsWith("/pointclouds/")) {
		throw redirect("/potree");
	}
	return { src, jobId };
}

export default function PotreeViewerPage({ loaderData }: Route.ComponentProps) {
	const [aoiPolygon, setAoiPolygon] = useState<AoiPolygon | null>(null);
	const [treeCountResult, setTreeCountResult] = useState<{ count: number; usingAoi: boolean } | null>(null);
	const [treeCentersGeojson, setTreeCentersGeojson] = useState<GeoJsonFeatureCollection | null>(null);
	const [countParams, setCountParams] = useState<TreeCountParams>(DEFAULT_COUNT_PARAMS);
	const [markerSettings, setMarkerSettings] = useState<MarkerSettings>(DEFAULT_MARKER_SETTINGS);
	const [sweepResults, setSweepResults] = useState<SweepResult[]>([]);
	const [isCounting, setIsCounting] = useState(false);
	const [isSweepRunning, setIsSweepRunning] = useState(false);
	const [isDownloading, setIsDownloading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorDetail, setErrorDetail] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [volumeParams, setVolumeParams] = useState<VolumeParams>(DEFAULT_VOLUME_PARAMS);
	const [volumeResult, setVolumeResult] = useState<VolumeResult | null>(null);
	const [isCalculatingVolume, setIsCalculatingVolume] = useState(false);
	const [treeCountOpen, setTreeCountOpen] = useState(true);
	const [volumeOpen, setVolumeOpen] = useState(true);
	const sidebarPortalRef = useRef<HTMLDivElement | null>(null);
	const [portalReady, setPortalReady] = useState(false);

	// Poll for portal container to be ready (set by PotreeViewer after loadGUI)
	useEffect(() => {
		const interval = setInterval(() => {
			if (sidebarPortalRef.current) {
				setPortalReady(true);
				clearInterval(interval);
			}
		}, 100);
		return () => clearInterval(interval);
	}, []);

	const jobId = loaderData.jobId ?? null;
	const hasAoi = Boolean(aoiPolygon && aoiPolygon.length >= 3);
	const aoiStatus = aoiPolygon && aoiPolygon.length >= 3 ? `${aoiPolygon.length} titik` : "belum ada";

	const inputLabelStyle = { fontSize: "11px", color: "#8b949e", marginBottom: "4px" };
	const inputStyle = { width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: "6px", color: "#e6edf3", padding: "4px 6px", fontSize: "12px", fontFamily: "monospace" };
	const presetButtonStyle = { border: "1px solid #30363d", borderRadius: "6px", padding: "4px 6px", fontSize: "11px", fontWeight: 600, background: "#161b22", color: "#e6edf3", cursor: "pointer" };

	const updateCountParam = (key: keyof TreeCountParams, value: number) => setCountParams((prev) => ({ ...prev, [key]: value }));
	const updateMarkerSetting = (key: keyof MarkerSettings, value: number) => setMarkerSettings((prev) => ({ ...prev, [key]: value }));

	const handleCountTrees = async () => {
		setErrorMessage(null); setErrorDetail(null); setStatusMessage(null);
		setTreeCountResult(null); setTreeCentersGeojson(null);
		if (!jobId) { setErrorMessage("job_id tidak ditemukan di URL."); return; }
		if (!hasAoi) { setErrorMessage("AOI belum disimpan. Klik Gambar AOI, buat polygon, lalu klik Simpan AOI."); return; }
		const formData = new FormData();
		formData.append("chm_res", String(countParams.chm_res));
		formData.append("min_tree_distance", String(countParams.min_tree_distance));
		formData.append("tree_count_min_h", String(countParams.tree_count_min_h));
		formData.append("smooth_sigma", String(countParams.smooth_sigma));
		formData.append("chunk_size", String(countParams.chunk_size));
		formData.append("aoi_polygon", JSON.stringify(aoiPolygon));
		setIsCounting(true);
		try {
			const response = await fetch(`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}/geojson`, { method: "POST", body: formData });
			if (!response.ok) { const { message, detail } = await readErrorPayload(response); setErrorMessage(message); setErrorDetail(detail && detail !== message ? detail : null); return; }
			const payload = (await response.json()) as TreeCountGeojsonResponse;
			setTreeCountResult({ count: payload.count, usingAoi: payload.using_aoi });
			setTreeCentersGeojson(payload.geojson ?? null);
			setStatusMessage("Tree centers berhasil dimuat.");
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Gagal menghitung pohon.");
		} finally { setIsCounting(false); }
	};

	const handleRunSweep = async () => {
		setErrorMessage(null); setErrorDetail(null); setStatusMessage(null); setSweepResults([]);
		if (!jobId) { setErrorMessage("job_id tidak ditemukan di URL."); return; }
		if (!hasAoi) { setErrorMessage("AOI belum disimpan. Klik Gambar AOI, buat polygon, lalu klik Simpan AOI."); return; }
		setIsSweepRunning(true);
		try {
			const results: SweepResult[] = [];
			for (const preset of SWEEP_PRESETS) {
				const formData = new FormData();
				formData.append("chm_res", String(countParams.chm_res));
				formData.append("min_tree_distance", String(preset.min_tree_distance));
				formData.append("tree_count_min_h", String(countParams.tree_count_min_h));
				formData.append("smooth_sigma", String(preset.smooth_sigma));
				formData.append("chunk_size", String(countParams.chunk_size));
				formData.append("aoi_polygon", JSON.stringify(aoiPolygon));
				const response = await fetch(`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}/geojson`, { method: "POST", body: formData });
				if (!response.ok) { const { message, detail } = await readErrorPayload(response); setErrorMessage(message); setErrorDetail(detail && detail !== message ? detail : null); return; }
				const payload = (await response.json()) as TreeCountGeojsonResponse;
				results.push({ label: preset.label, min_tree_distance: preset.min_tree_distance, smooth_sigma: preset.smooth_sigma, count: payload.count, geojson: payload.geojson, using_aoi: payload.using_aoi, chm_res: countParams.chm_res, tree_count_min_h: countParams.tree_count_min_h });
			}
			setSweepResults(results);
			setStatusMessage("Sweep selesai.");
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Gagal menjalankan sweep.");
		} finally { setIsSweepRunning(false); }
	};

	const handleDownloadZip = async () => {
		setErrorMessage(null); setErrorDetail(null); setStatusMessage(null);
		if (!jobId) { setErrorMessage("job_id tidak ditemukan di URL."); return; }
		const formData = new FormData();
		formData.append("chm_res", String(countParams.chm_res));
		formData.append("min_tree_distance", String(countParams.min_tree_distance));
		formData.append("tree_count_min_h", String(countParams.tree_count_min_h));
		formData.append("smooth_sigma", String(countParams.smooth_sigma));
		formData.append("chunk_size", String(countParams.chunk_size));
		if (aoiPolygon && aoiPolygon.length >= 3) formData.append("aoi_polygon", JSON.stringify(aoiPolygon));
		setIsDownloading(true);
		try {
			const response = await fetch(`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}`, { method: "POST", body: formData });
			if (!response.ok) { const { message, detail } = await readErrorPayload(response); setErrorMessage(message); setErrorDetail(detail && detail !== message ? detail : null); return; }
			const blob = await response.blob();
			const fallbackName = `tree_centers_${jobId}.zip`;
			const filename = getFilenameFromDisposition(response.headers.get("content-disposition"), fallbackName);
			const url = window.URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url; anchor.download = filename;
			document.body.appendChild(anchor); anchor.click(); anchor.remove();
			window.URL.revokeObjectURL(url);
			setStatusMessage("ZIP hasil perhitungan diunduh.");
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Gagal mengunduh ZIP.");
		} finally { setIsDownloading(false); }
	};

	const handleCalculateVolume = async () => {
		setErrorMessage(null); setErrorDetail(null); setStatusMessage(null); setVolumeResult(null);
		if (!jobId) { setErrorMessage("job_id tidak ditemukan di URL."); return; }
		const formData = new FormData();
		formData.append("resolution", String(volumeParams.resolution));
		formData.append("smooth_sigma", String(volumeParams.smooth_sigma));
		if (aoiPolygon && aoiPolygon.length >= 3) formData.append("aoi_polygon", JSON.stringify(aoiPolygon));
		setIsCalculatingVolume(true);
		try {
			const response = await fetch(`http://localhost:8000/volume/${encodeURIComponent(jobId)}`, { method: "POST", body: formData });
			if (!response.ok) { const { message, detail } = await readErrorPayload(response); setErrorMessage(message); setErrorDetail(detail && detail !== message ? detail : null); return; }
			const payload = (await response.json()) as VolumeResult;
			setVolumeResult(payload);
			setStatusMessage("Volume berhasil dihitung.");
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Gagal menghitung volume.");
		} finally { setIsCalculatingVolume(false); }
	};

	const isButtonDisabled = !jobId || isCounting || isSweepRunning;
	const isSweepDisabled = !jobId || isCounting || isSweepRunning;
	const isDownloadDisabled = !jobId || isDownloading;

	const handleApplySweep = (result: SweepResult) => {
		setErrorMessage(null); setErrorDetail(null);
		setStatusMessage(`Menggunakan ${result.label}.`);
		setCountParams((prev) => ({ ...prev, chm_res: result.chm_res, min_tree_distance: result.min_tree_distance, tree_count_min_h: result.tree_count_min_h, smooth_sigma: result.smooth_sigma }));
		setTreeCountResult({ count: result.count, usingAoi: result.using_aoi });
		setTreeCentersGeojson(result.geojson);
	};

	const handleClearMarkers = () => { setTreeCentersGeojson(null); setStatusMessage("Markers dibersihkan."); };

	const accordionHeaderStyle = (isOpen: boolean, color: string) => ({
		width: "100%", background: "#161b22", border: "none", borderBottom: "1px solid #21262d",
		color: isOpen ? color : "#e6edf3", fontSize: "11px", letterSpacing: "0.06em",
		textTransform: "uppercase" as const, fontWeight: 600, padding: "10px 16px",
		cursor: "pointer", textAlign: "left" as const, display: "flex", alignItems: "center", gap: "8px",
	});

	return (
		<div style={{ position: "relative", width: "100%", height: "100vh" }}>
			<PotreeViewer
				pointcloudUrl={loaderData.src}
				onAoiPolygonChange={setAoiPolygon}
				treeCentersGeojson={treeCentersGeojson}
				markerRadius={markerSettings.marker_radius}
				markerZOffset={markerSettings.marker_z_offset}
				sidebarPortalRef={sidebarPortalRef}
				style={{ width: "100%", height: "100%" }}
			/>

			{/* Render analysis panels into Potree sidebar via portal */}
			{portalReady && sidebarPortalRef.current && createPortal(
				<AnalysisPanels
					jobId={jobId}
					aoiStatus={aoiStatus}
					treeCountResult={treeCountResult}
					treeCountOpen={treeCountOpen}
					setTreeCountOpen={setTreeCountOpen}
					volumeOpen={volumeOpen}
					setVolumeOpen={setVolumeOpen}
					countParams={countParams}
					updateCountParam={updateCountParam}
					markerSettings={markerSettings}
					updateMarkerSetting={updateMarkerSetting}
					volumeParams={volumeParams}
					setVolumeParams={setVolumeParams}
					volumeResult={volumeResult}
					sweepResults={sweepResults}
					isButtonDisabled={isButtonDisabled}
					isSweepDisabled={isSweepDisabled}
					isDownloadDisabled={isDownloadDisabled}
					isCalculatingVolume={isCalculatingVolume}
					isCounting={isCounting}
					isSweepRunning={isSweepRunning}
					isDownloading={isDownloading}
					statusMessage={statusMessage}
					errorMessage={errorMessage}
					errorDetail={errorDetail}
					handleCountTrees={handleCountTrees}
					handleRunSweep={handleRunSweep}
					handleCalculateVolume={handleCalculateVolume}
					handleDownloadZip={handleDownloadZip}
					handleApplySweep={handleApplySweep}
					handleClearMarkers={handleClearMarkers}
					inputLabelStyle={inputLabelStyle}
					inputStyle={inputStyle}
					presetButtonStyle={presetButtonStyle}
				/>,
				sidebarPortalRef.current,
			)}
		</div>
	);
}

/* ── AnalysisPanels: rendered inside Potree sidebar via portal ── */
type AnalysisPanelsProps = {
	jobId: string | null;
	aoiStatus: string;
	treeCountResult: { count: number; usingAoi: boolean } | null;
	treeCountOpen: boolean;
	setTreeCountOpen: (fn: (v: boolean) => boolean) => void;
	volumeOpen: boolean;
	setVolumeOpen: (fn: (v: boolean) => boolean) => void;
	countParams: TreeCountParams;
	updateCountParam: (key: keyof TreeCountParams, value: number) => void;
	markerSettings: MarkerSettings;
	updateMarkerSetting: (key: keyof MarkerSettings, value: number) => void;
	volumeParams: VolumeParams;
	setVolumeParams: (fn: (p: VolumeParams) => VolumeParams) => void;
	volumeResult: VolumeResult | null;
	sweepResults: SweepResult[];
	isButtonDisabled: boolean;
	isSweepDisabled: boolean;
	isDownloadDisabled: boolean;
	isCalculatingVolume: boolean;
	isCounting: boolean;
	isSweepRunning: boolean;
	isDownloading: boolean;
	statusMessage: string | null;
	errorMessage: string | null;
	errorDetail: string | null;
	handleCountTrees: () => void;
	handleRunSweep: () => void;
	handleCalculateVolume: () => void;
	handleDownloadZip: () => void;
	handleApplySweep: (r: SweepResult) => void;
	handleClearMarkers: () => void;
	inputLabelStyle: Record<string, string>;
	inputStyle: Record<string, string>;
	presetButtonStyle: Record<string, string | number>;
};

function AnalysisPanels(props: AnalysisPanelsProps) {
	const {
		jobId, aoiStatus, treeCountResult, treeCountOpen, setTreeCountOpen,
		volumeOpen, setVolumeOpen, countParams, updateCountParam,
		markerSettings, updateMarkerSetting, volumeParams, setVolumeParams,
		volumeResult, sweepResults, isButtonDisabled, isSweepDisabled,
		isDownloadDisabled, isCalculatingVolume, isCounting, isSweepRunning,
		isDownloading, statusMessage, errorMessage, errorDetail,
		handleCountTrees, handleRunSweep, handleCalculateVolume,
		handleDownloadZip, handleApplySweep, handleClearMarkers,
		inputLabelStyle, inputStyle, presetButtonStyle,
	} = props;

	const headerStyle = (isOpen: boolean, color: string): React.CSSProperties => ({
		width: "100%", background: "#161b22", border: "none",
		borderBottom: "1px solid #21262d", color: isOpen ? color : "#e6edf3",
		fontSize: "0.75rem", letterSpacing: "0.06em", textTransform: "uppercase",
		fontWeight: 600, padding: "10px 16px 10px 36px", cursor: "pointer",
		textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
		borderRadius: 0, textShadow: "none", boxShadow: "none",
	});

	return (
		<>

			{/* ══ Hitung Pohon ══ */}
			<h3 style={headerStyle(treeCountOpen, "#58a6ff")} onClick={() => setTreeCountOpen((v) => !v)}>
				<span style={{ fontSize: "9px" }}>{treeCountOpen ? "▼" : "▶"}</span>
				Hitung Pohon
			</h3>
			{treeCountOpen && (
				<div style={{ padding: "12px" }}>
					<div style={{ fontSize: "12px", marginBottom: "6px" }}>
						<span style={{ color: "#8b949e" }}>Job ID:</span>{" "}
						<span style={{ fontFamily: "monospace", fontSize: "10px" }}>{jobId ?? "-"}</span>
					</div>
					<div style={{ fontSize: "12px", marginBottom: "6px" }}>
						<span style={{ color: "#8b949e" }}>AOI:</span> <span>{aoiStatus}</span>
					</div>
					<div style={{ fontSize: "12px", marginBottom: "12px" }}>
						<span style={{ color: "#8b949e" }}>Count:</span>{" "}
						<span style={{ color: "#58a6ff", fontWeight: 700 }}>{treeCountResult ? treeCountResult.count : "-"}</span>
					</div>
					<div style={{ marginBottom: "12px" }}>
						<div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#58a6ff", marginBottom: "6px", fontWeight: 600 }}>CHM Params</div>
						<div style={{ display: "grid", gap: "6px" }}>
							<div><div style={inputLabelStyle}>chm_res</div><input type="number" step="0.1" value={countParams.chm_res} onChange={(e) => updateCountParam("chm_res", Number(e.target.value))} style={inputStyle} /></div>
							<div><div style={inputLabelStyle}>min_tree_distance</div><input type="number" step="0.1" value={countParams.min_tree_distance} onChange={(e) => updateCountParam("min_tree_distance", Number(e.target.value))} style={inputStyle} /></div>
							<div><div style={inputLabelStyle}>tree_count_min_h</div><input type="number" step="0.1" value={countParams.tree_count_min_h} onChange={(e) => updateCountParam("tree_count_min_h", Number(e.target.value))} style={inputStyle} /></div>
							<div><div style={inputLabelStyle}>smooth_sigma</div><input type="number" step="0.1" value={countParams.smooth_sigma} onChange={(e) => updateCountParam("smooth_sigma", Number(e.target.value))} style={inputStyle} /></div>
						</div>
					</div>
					<div style={{ marginBottom: "12px" }}>
						<div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#58a6ff", marginBottom: "6px", fontWeight: 600 }}>Preset</div>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
							{COUNT_PRESETS.map((preset) => (
								<button key={preset.label} type="button" style={presetButtonStyle as React.CSSProperties} onClick={() => { updateCountParam("min_tree_distance", preset.min_tree_distance); updateCountParam("smooth_sigma", preset.smooth_sigma); }}>
									{preset.label}
								</button>
							))}
						</div>
					</div>

					<button type="button" onClick={handleCountTrees} disabled={isButtonDisabled} style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #30363d", background: isButtonDisabled ? "#161b22" : "#1f6feb", color: isButtonDisabled ? "#8b949e" : "#ffffff", fontWeight: 600, fontSize: "12px", cursor: isButtonDisabled ? "not-allowed" : "pointer" }}>
						{isCounting ? "Menghitung..." : "Hitung Pohon"}
					</button>
					<button type="button" onClick={handleRunSweep} disabled={isSweepDisabled} style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #30363d", background: isSweepDisabled ? "#161b22" : "#238636", color: isSweepDisabled ? "#8b949e" : "#ffffff", fontWeight: 600, fontSize: "12px", cursor: isSweepDisabled ? "not-allowed" : "pointer", marginTop: "6px" }}>
						{isSweepRunning ? "Sweep berjalan..." : "Run Sweep"}
					</button>
					{sweepResults.length > 0 && (
						<div style={{ marginTop: "8px", border: "1px solid #21262d", borderRadius: "6px", padding: "8px", background: "#0b0f14" }}>
							<div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#58a6ff", marginBottom: "4px", fontWeight: 600 }}>Sweep Results</div>
							<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
								<thead><tr style={{ textAlign: "left", color: "#8b949e" }}><th style={{ paddingBottom: "3px" }}>Label</th><th style={{ paddingBottom: "3px" }}>Dist</th><th style={{ paddingBottom: "3px" }}>σ</th><th style={{ paddingBottom: "3px" }}>N</th><th /></tr></thead>
								<tbody>
									{sweepResults.map((r) => (
										<tr key={r.label} style={{ color: "#e6edf3" }}>
											<td style={{ padding: "3px 0" }}>{r.label}</td>
											<td style={{ padding: "3px 0" }}>{r.min_tree_distance.toFixed(1)}</td>
											<td style={{ padding: "3px 0" }}>{r.smooth_sigma.toFixed(1)}</td>
											<td style={{ padding: "3px 0" }}>{r.count}</td>
											<td style={{ padding: "3px 0" }}><button type="button" onClick={() => handleApplySweep(r)} style={{ border: "1px solid #30363d", borderRadius: "4px", padding: "1px 4px", fontSize: "9px", background: "#161b22", color: "#e6edf3", cursor: "pointer" }}>Apply</button></td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<div style={{ marginTop: "10px" }}>
						<div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#58a6ff", marginBottom: "6px", fontWeight: 600 }}>Marker</div>
						<div style={{ display: "grid", gap: "6px" }}>
							<div><div style={inputLabelStyle}>marker_radius</div><input type="number" step="0.1" value={markerSettings.marker_radius} onChange={(e) => updateMarkerSetting("marker_radius", Number(e.target.value))} style={inputStyle} /></div>
							<div><div style={inputLabelStyle}>marker_z_offset</div><input type="number" step="0.1" value={markerSettings.marker_z_offset} onChange={(e) => updateMarkerSetting("marker_z_offset", Number(e.target.value))} style={inputStyle} /></div>
						</div>
						<button type="button" onClick={handleClearMarkers} style={{ width: "100%", padding: "5px 8px", borderRadius: "6px", border: "1px solid #30363d", background: "#161b22", color: "#e6edf3", fontWeight: 600, fontSize: "11px", cursor: "pointer", marginTop: "6px" }}>
							Clear Markers
						</button>
					</div>
				</div>
			)}

			{/* ══ Stockpile Volume ══ */}
			<h3 style={headerStyle(volumeOpen, "#3fb950")} onClick={() => setVolumeOpen((v) => !v)}>
				<span style={{ fontSize: "9px" }}>{volumeOpen ? "▼" : "▶"}</span>
				Stockpile Volume
			</h3>
			{volumeOpen && (
				<div style={{ padding: "12px" }}>
					<div style={{ display: "grid", gap: "6px", marginBottom: "10px" }}>
						<div><div style={inputLabelStyle}>resolution (m)</div><input type="number" step="0.1" value={volumeParams.resolution} onChange={(e) => setVolumeParams((p) => ({ ...p, resolution: Number(e.target.value) }))} style={inputStyle} /></div>
						<div><div style={inputLabelStyle}>smooth_sigma</div><input type="number" step="0.1" value={volumeParams.smooth_sigma} onChange={(e) => setVolumeParams((p) => ({ ...p, smooth_sigma: Number(e.target.value) }))} style={inputStyle} /></div>
					</div>
					<button type="button" onClick={handleCalculateVolume} disabled={!jobId || isCalculatingVolume} style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #30363d", background: !jobId || isCalculatingVolume ? "#161b22" : "#1a4731", color: !jobId || isCalculatingVolume ? "#8b949e" : "#3fb950", fontWeight: 600, fontSize: "12px", cursor: !jobId || isCalculatingVolume ? "not-allowed" : "pointer" }}>
						{isCalculatingVolume ? "Menghitung..." : "Hitung Volume"}
					</button>
					{volumeResult && (
						<div style={{ marginTop: "8px", border: "1px solid #21262d", borderRadius: "6px", padding: "8px", background: "#0b0f14", fontSize: "11px" }}>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", marginBottom: "6px" }}>
								{[
									{ label: "Cut (m³)", value: volumeResult.volume_cut_m3.toFixed(2) },
									{ label: "Fill (m³)", value: volumeResult.volume_fill_m3.toFixed(2) },
									{ label: "Net (m³)", value: volumeResult.net_volume_m3.toFixed(2) },
									{ label: "Area (m²)", value: volumeResult.stockpile_area_m2.toFixed(2) },
									{ label: "Max H (m)", value: volumeResult.max_height_m.toFixed(2) },
									{ label: "Avg H (m)", value: volumeResult.avg_height_m.toFixed(2) },
								].map(({ label, value }) => (
									<div key={label} style={{ background: "#161b22", borderRadius: "4px", padding: "5px 6px" }}>
										<div style={{ fontSize: "9px", color: "#8b949e" }}>{label}</div>
										<div style={{ color: "#3fb950", fontWeight: 700, fontFamily: "monospace", fontSize: "12px" }}>{value}</div>
									</div>
								))}
							</div>
							<div style={{ background: "#1a1f26", borderRadius: "4px", padding: "6px", marginBottom: "6px", borderLeft: "3px solid #f0883e" }}>
								<div style={{ fontSize: "9px", color: "#8b949e", marginBottom: "2px" }}>Est. Solid Wood (60% packing)</div>
								<div style={{ color: "#f0883e", fontWeight: 700, fontFamily: "monospace", fontSize: "13px" }}>{(volumeResult.volume_cut_m3 * 0.6).toFixed(2)} m³</div>
								<div style={{ fontSize: "8px", color: "#6e7681", marginTop: "2px" }}>Envelope × 0.6 (typical for logs)</div>
							</div>
							<div style={{ color: "#8b949e", fontSize: "9px", lineHeight: 1.5 }}>
								<div>Ground pts: {volumeResult.ground_points_used.toLocaleString()}</div>
								<div>Res: {volumeResult.resolution} m | AOI: {volumeResult.using_aoi ? "ya" : "tidak"}</div>
							</div>
						</div>
					)}
					<button type="button" onClick={handleDownloadZip} disabled={isDownloadDisabled} style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #30363d", background: isDownloadDisabled ? "#161b22" : "#30363d", color: isDownloadDisabled ? "#8b949e" : "#e6edf3", fontWeight: 600, fontSize: "12px", cursor: isDownloadDisabled ? "not-allowed" : "pointer", marginTop: "8px" }}>
						{isDownloading ? "Mengunduh..." : "Download ZIP"}
					</button>
				</div>
			)}

			{/* ══ Status & Error ══ */}
			{(statusMessage || errorMessage) && (
				<div style={{ padding: "10px 12px", borderTop: "1px solid #21262d" }}>
					{statusMessage && <div style={{ fontSize: "10px", color: "#58a6ff" }}>{statusMessage}</div>}
					{errorMessage && (
						<div style={{ marginTop: statusMessage ? "6px" : 0, fontSize: "10px", color: "#ff7b72", border: "1px solid #5d1f1f", borderRadius: "6px", padding: "6px", background: "#1f0d0d" }}>
							<div style={{ fontWeight: 600, marginBottom: errorDetail ? "4px" : 0 }}>{errorMessage}</div>
							{errorDetail && <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#ffd3cf", fontSize: "9px" }}>{errorDetail}</pre>}
						</div>
					)}
				</div>
			)}
		</>
	);
}
