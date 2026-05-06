//routes/potree-viewer.tsx
import { useState } from "react";
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
	if (!raw) {
		return { message: "Request gagal.", detail: null };
	}

	try {
		const parsed = JSON.parse(raw) as { detail?: unknown };
		const detailText = JSON.stringify(parsed, null, 2);
		if (parsed?.detail !== undefined) {
			const detailMessage = typeof parsed.detail === "string"
				? parsed.detail
				: JSON.stringify(parsed.detail);
			return {
				message: detailMessage,
				detail: detailText,
			};
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

	const jobId = loaderData.jobId ?? null;
	const hasAoi = Boolean(aoiPolygon && aoiPolygon.length >= 3);
	const aoiStatus = aoiPolygon && aoiPolygon.length >= 3
		? `${aoiPolygon.length} titik`
		: "belum ada";

	const inputLabelStyle = {
		fontSize: "11px",
		color: "#8b949e",
		marginBottom: "4px",
	};
	const inputStyle = {
		width: "100%",
		background: "#0d1117",
		border: "1px solid #30363d",
		borderRadius: "6px",
		color: "#e6edf3",
		padding: "4px 6px",
		fontSize: "12px",
		fontFamily: "monospace",
	};
	const presetButtonStyle = {
		border: "1px solid #30363d",
		borderRadius: "6px",
		padding: "4px 6px",
		fontSize: "11px",
		fontWeight: 600,
		background: "#161b22",
		color: "#e6edf3",
		cursor: "pointer",
	};

	const updateCountParam = (key: keyof TreeCountParams, value: number) => {
		setCountParams((prev) => ({ ...prev, [key]: value }));
	};

	const updateMarkerSetting = (key: keyof MarkerSettings, value: number) => {
		setMarkerSettings((prev) => ({ ...prev, [key]: value }));
	};

	const handleCountTrees = async () => {
		setErrorMessage(null);
		setErrorDetail(null);
		setStatusMessage(null);
		setTreeCountResult(null);
		setTreeCentersGeojson(null);

		if (!jobId) {
			setErrorMessage("job_id tidak ditemukan di URL.");
			return;
		}

		if (!hasAoi) {
			setErrorMessage("AOI belum disimpan. Klik Gambar AOI, buat polygon, lalu klik Simpan AOI.");
			setErrorDetail(null);
			return;
		}

		const formData = new FormData();
		formData.append("chm_res", String(countParams.chm_res));
		formData.append("min_tree_distance", String(countParams.min_tree_distance));
		formData.append("tree_count_min_h", String(countParams.tree_count_min_h));
		formData.append("smooth_sigma", String(countParams.smooth_sigma));
		formData.append("chunk_size", String(countParams.chunk_size));
		formData.append("aoi_polygon", JSON.stringify(aoiPolygon));

		console.log("Sending AOI polygon:", aoiPolygon);

		setIsCounting(true);
		try {
			const response = await fetch(`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}/geojson`,
				{
					method: "POST",
					body: formData,
				},
			);

			if (!response.ok) {
				const { message, detail } = await readErrorPayload(response);
				setErrorMessage(message);
				setErrorDetail(detail && detail !== message ? detail : null);
				return;
			}

			const payload = (await response.json()) as TreeCountGeojsonResponse;
			setTreeCountResult({ count: payload.count, usingAoi: payload.using_aoi });
			setTreeCentersGeojson(payload.geojson ?? null);
			setStatusMessage("Tree centers berhasil dimuat.");
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message);
				setErrorDetail(null);
			} else {
				setErrorMessage("Gagal menghitung pohon.");
				setErrorDetail(null);
			}
		} finally {
			setIsCounting(false);
		}
	};

	const handleRunSweep = async () => {
		setErrorMessage(null);
		setErrorDetail(null);
		setStatusMessage(null);
		setSweepResults([]);

		if (!jobId) {
			setErrorMessage("job_id tidak ditemukan di URL.");
			return;
		}

		if (!hasAoi) {
			setErrorMessage("AOI belum disimpan. Klik Gambar AOI, buat polygon, lalu klik Simpan AOI.");
			return;
		}

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

				const response = await fetch(
					`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}/geojson`,
					{
						method: "POST",
						body: formData,
					},
				);

				if (!response.ok) {
					const { message, detail } = await readErrorPayload(response);
					setErrorMessage(message);
					setErrorDetail(detail && detail !== message ? detail : null);
					return;
				}

				const payload = (await response.json()) as TreeCountGeojsonResponse;
				results.push({
					label: preset.label,
					min_tree_distance: preset.min_tree_distance,
					smooth_sigma: preset.smooth_sigma,
					count: payload.count,
					geojson: payload.geojson,
					using_aoi: payload.using_aoi,
					chm_res: countParams.chm_res,
					tree_count_min_h: countParams.tree_count_min_h,
				});
			}

			setSweepResults(results);
			setStatusMessage("Sweep selesai.");
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message);
				setErrorDetail(null);
			} else {
				setErrorMessage("Gagal menjalankan sweep.");
				setErrorDetail(null);
			}
		} finally {
			setIsSweepRunning(false);
		}
	};

	const handleDownloadZip = async () => {
		setErrorMessage(null);
		setErrorDetail(null);
		setStatusMessage(null);

		if (!jobId) {
			setErrorMessage("job_id tidak ditemukan di URL.");
			return;
		}

		const formData = new FormData();
		formData.append("chm_res", String(countParams.chm_res));
		formData.append("min_tree_distance", String(countParams.min_tree_distance));
		formData.append("tree_count_min_h", String(countParams.tree_count_min_h));
		formData.append("smooth_sigma", String(countParams.smooth_sigma));
		formData.append("chunk_size", String(countParams.chunk_size));

		if (aoiPolygon && aoiPolygon.length >= 3) {
			formData.append("aoi_polygon", JSON.stringify(aoiPolygon));
		}

		setIsDownloading(true);
		try {
			const response = await fetch(`http://localhost:8000/count-trees/${encodeURIComponent(jobId)}`,
				{
					method: "POST",
					body: formData,
				},
			);

			if (!response.ok) {
				const { message, detail } = await readErrorPayload(response);
				setErrorMessage(message);
				setErrorDetail(detail && detail !== message ? detail : null);
				return;
			}

			const blob = await response.blob();
			const fallbackName = `tree_centers_${jobId}.zip`;
			const filename = getFilenameFromDisposition(response.headers.get("content-disposition"), fallbackName);
			const url = window.URL.createObjectURL(blob);

			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			window.URL.revokeObjectURL(url);

			setStatusMessage("ZIP hasil perhitungan diunduh.");
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message);
				setErrorDetail(null);
			} else {
				setErrorMessage("Gagal mengunduh ZIP.");
				setErrorDetail(null);
			}
		} finally {
			setIsDownloading(false);
		}
	};

	const isButtonDisabled = !jobId || isCounting || isSweepRunning;
	const isSweepDisabled = !jobId || isCounting || isSweepRunning;
	const isDownloadDisabled = !jobId || isDownloading;

	const handleApplySweep = (result: SweepResult) => {
		setErrorMessage(null);
		setErrorDetail(null);
		setStatusMessage(`Menggunakan ${result.label}.`);
		setCountParams((prev) => ({
			...prev,
			chm_res: result.chm_res,
			min_tree_distance: result.min_tree_distance,
			tree_count_min_h: result.tree_count_min_h,
			smooth_sigma: result.smooth_sigma,
		}));
		setTreeCountResult({ count: result.count, usingAoi: result.using_aoi });
		setTreeCentersGeojson(result.geojson);
	};

	const handleClearMarkers = () => {
		setTreeCentersGeojson(null);
		setStatusMessage("Markers dibersihkan.");
	};

	return (
		<div style={{ position: "relative", width: "100%", height: "100vh" }}>
			<PotreeViewer
				pointcloudUrl={loaderData.src}
				onAoiPolygonChange={setAoiPolygon}
				treeCentersGeojson={treeCentersGeojson}
				markerRadius={markerSettings.marker_radius}
				markerZOffset={markerSettings.marker_z_offset}
				style={{ width: "100%", height: "100%" }}
			/>
			<div
				style={{
					position: "absolute",
					top: "60px",
					right: "16px",
					zIndex: 20,
					background: "#0d1117",
					border: "1px solid #30363d",
					borderRadius: "12px",
					padding: "12px",
					minWidth: "280px",
					color: "#e6edf3",
					fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
					boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
				}}
			>
				<div
					style={{
						fontSize: "11px",
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						color: "#58a6ff",
						marginBottom: "10px",
						fontWeight: 700,
					}}
				>
					Tree Count
				</div>
				<div style={{ fontSize: "12px", marginBottom: "6px" }}>
					<span style={{ color: "#8b949e" }}>Job ID:</span>{" "}
					<span style={{ fontFamily: "monospace" }}>{jobId ?? "-"}</span>
				</div>
				<div style={{ fontSize: "12px", marginBottom: "12px" }}>
					<span style={{ color: "#8b949e" }}>AOI:</span>{" "}
					<span>{aoiStatus}</span>
				</div>
				<div style={{ fontSize: "12px", marginBottom: "12px" }}>
					<span style={{ color: "#8b949e" }}>Count:</span>{" "}
					<span>{treeCountResult ? treeCountResult.count : "-"}</span>
				</div>
				<div style={{ marginBottom: "12px" }}>
					<div
						style={{
							fontSize: "11px",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							color: "#58a6ff",
							marginBottom: "6px",
							fontWeight: 600,
						}}
					>
						CHM Params
					</div>
					<div style={{ display: "grid", gap: "8px" }}>
						<div>
							<div style={inputLabelStyle}>chm_res</div>
							<input
								type="number"
								step="0.1"
								value={countParams.chm_res}
								onChange={(event) => updateCountParam("chm_res", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
						<div>
							<div style={inputLabelStyle}>min_tree_distance</div>
							<input
								type="number"
								step="0.1"
								value={countParams.min_tree_distance}
								onChange={(event) => updateCountParam("min_tree_distance", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
						<div>
							<div style={inputLabelStyle}>tree_count_min_h</div>
							<input
								type="number"
								step="0.1"
								value={countParams.tree_count_min_h}
								onChange={(event) => updateCountParam("tree_count_min_h", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
						<div>
							<div style={inputLabelStyle}>smooth_sigma</div>
							<input
								type="number"
								step="0.1"
								value={countParams.smooth_sigma}
								onChange={(event) => updateCountParam("smooth_sigma", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
					</div>
				</div>
				<div style={{ marginBottom: "12px" }}>
					<div
						style={{
							fontSize: "11px",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							color: "#58a6ff",
							marginBottom: "6px",
							fontWeight: 600,
						}}
					>
						Preset
					</div>
					<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
						{COUNT_PRESETS.map((preset) => (
							<button
								key={preset.label}
								type="button"
								style={presetButtonStyle}
								onClick={() => {
									updateCountParam("min_tree_distance", preset.min_tree_distance);
									updateCountParam("smooth_sigma", preset.smooth_sigma);
								}}
							>
								{preset.label}
							</button>
						))}
					</div>
				</div>
				<button
					type="button"
					onClick={handleCountTrees}
					disabled={isButtonDisabled}
					style={{
						width: "100%",
						padding: "8px 12px",
						borderRadius: "8px",
						border: "1px solid #30363d",
						background: isButtonDisabled ? "#161b22" : "#1f6feb",
						color: isButtonDisabled ? "#8b949e" : "#ffffff",
						fontWeight: 600,
						cursor: isButtonDisabled ? "not-allowed" : "pointer",
						transition: "background 0.2s ease",
					}}
				>
					{isCounting ? "Menghitung..." : "Hitung Pohon"}
				</button>
				<button
					type="button"
					onClick={handleRunSweep}
					disabled={isSweepDisabled}
					style={{
						width: "100%",
						padding: "8px 12px",
						borderRadius: "8px",
						border: "1px solid #30363d",
						background: isSweepDisabled ? "#161b22" : "#238636",
						color: isSweepDisabled ? "#8b949e" : "#ffffff",
						fontWeight: 600,
						cursor: isSweepDisabled ? "not-allowed" : "pointer",
						transition: "background 0.2s ease",
						marginTop: "8px",
					}}
				>
					{isSweepRunning ? "Sweep berjalan..." : "Run Sweep"}
				</button>
				{sweepResults.length > 0 && (
					<div
						style={{
							marginTop: "10px",
							border: "1px solid #21262d",
							borderRadius: "8px",
							padding: "8px",
							background: "#0b0f14",
						}}
					>
						<div
							style={{
								fontSize: "11px",
								textTransform: "uppercase",
								letterSpacing: "0.08em",
								color: "#58a6ff",
								marginBottom: "6px",
								fontWeight: 600,
							}}
						>
							Sweep Results
						</div>
						<div style={{ overflowX: "auto" }}>
							<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
								<thead>
									<tr style={{ textAlign: "left", color: "#8b949e" }}>
										<th style={{ paddingBottom: "4px" }}>Label</th>
										<th style={{ paddingBottom: "4px" }}>Min Dist</th>
										<th style={{ paddingBottom: "4px" }}>Sigma</th>
										<th style={{ paddingBottom: "4px" }}>Count</th>
										<th style={{ paddingBottom: "4px" }} />
									</tr>
								</thead>
								<tbody>
									{sweepResults.map((result) => (
										<tr key={result.label} style={{ color: "#e6edf3" }}>
											<td style={{ padding: "4px 0" }}>{result.label}</td>
											<td style={{ padding: "4px 0" }}>{result.min_tree_distance.toFixed(1)}</td>
											<td style={{ padding: "4px 0" }}>{result.smooth_sigma.toFixed(1)}</td>
											<td style={{ padding: "4px 0" }}>{result.count}</td>
											<td style={{ padding: "4px 0" }}>
												<button
													type="button"
													onClick={() => handleApplySweep(result)}
													style={{
														border: "1px solid #30363d",
														borderRadius: "6px",
														padding: "2px 6px",
														fontSize: "10px",
														background: "#161b22",
														color: "#e6edf3",
														cursor: "pointer",
													}}
												>
													Apply
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				)}
				<div style={{ marginTop: "12px" }}>
					<div
						style={{
							fontSize: "11px",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
							color: "#58a6ff",
							marginBottom: "6px",
							fontWeight: 600,
						}}
					>
						Marker
					</div>
					<div style={{ display: "grid", gap: "8px" }}>
						<div>
							<div style={inputLabelStyle}>marker_radius</div>
							<input
								type="number"
								step="0.1"
								value={markerSettings.marker_radius}
								onChange={(event) => updateMarkerSetting("marker_radius", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
						<div>
							<div style={inputLabelStyle}>marker_z_offset</div>
							<input
								type="number"
								step="0.1"
								value={markerSettings.marker_z_offset}
								onChange={(event) => updateMarkerSetting("marker_z_offset", Number(event.target.value))}
								style={inputStyle}
							/>
						</div>
					</div>
					<button
						type="button"
						onClick={handleClearMarkers}
						style={{
							width: "100%",
							padding: "6px 10px",
							borderRadius: "8px",
							border: "1px solid #30363d",
							background: "#161b22",
							color: "#e6edf3",
							fontWeight: 600,
							cursor: "pointer",
							transition: "background 0.2s ease",
							marginTop: "8px",
						}}
					>
						Clear Markers
					</button>
				</div>
				<button
					type="button"
					onClick={handleDownloadZip}
					disabled={isDownloadDisabled}
					style={{
						width: "100%",
						padding: "8px 12px",
						borderRadius: "8px",
						border: "1px solid #30363d",
						background: isDownloadDisabled ? "#161b22" : "#30363d",
						color: isDownloadDisabled ? "#8b949e" : "#e6edf3",
						fontWeight: 600,
						cursor: isDownloadDisabled ? "not-allowed" : "pointer",
						transition: "background 0.2s ease",
						marginTop: "8px",
					}}
				>
					{isDownloading ? "Mengunduh..." : "Download ZIP"}
				</button>
				{statusMessage && (
					<div
						style={{
							marginTop: "10px",
							fontSize: "11px",
							color: "#58a6ff",
						}}
					>
						{statusMessage}
					</div>
				)}
				{errorMessage && (
					<div
						style={{
							marginTop: "10px",
							fontSize: "11px",
							color: "#ff7b72",
							border: "1px solid #5d1f1f",
							borderRadius: "8px",
							padding: "8px",
							background: "#1f0d0d",
						}}
					>
						<div style={{ fontWeight: 600, marginBottom: errorDetail ? "6px" : 0 }}>
							{errorMessage}
						</div>
						{errorDetail && (
							<pre
								style={{
									margin: 0,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									color: "#ffd3cf",
								}}
							>
								{errorDetail}
							</pre>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
