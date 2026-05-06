//potreeViewer.tsx
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router";

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

type PotreeViewerProps = {
	pointcloudUrl?: string;
	className?: string;
	style?: CSSProperties;
	pointBudget?: number;
	showSidebar?: boolean;
	onAoiPolygonChange?: (polygon: AoiPolygon | null) => void;
	treeCentersGeojson?: GeoJsonFeatureCollection | null;
	markerRadius?: number;
	markerZOffset?: number;
};

type PotreePointCloudEvent = {
	pointcloud?: {
		material?: {
			size?: number;
			pointSizeType?: unknown;
			activeAttributeName?: string;
		};
	};
};

type PotreeMeasurement = {
	points?: Array<{
		position?: { x: number; y: number; z: number };
	}>;
	remove?: () => void;
};

type PotreeViewerInstance = {
	scene: {
		addPointCloud: (pointcloud: unknown) => void;
		removeMeasurement?: (measurement: PotreeMeasurement) => void;
		measurements?: PotreeMeasurement[];
		scene?: {
			add: (object: unknown) => void;
			remove: (object: unknown) => void;
		};
	};
	measuringTool?: {
		startInsertion: (options?: Record<string, unknown>) => PotreeMeasurement;
	};
	renderer?: {
		setAnimationLoop?: (callback: ((time: number) => void) | null) => void;
		dispose?: () => void;
		forceContextLoss?: () => void;
	};
	stats?: {
		dom?: HTMLElement;
	};
	setEDLEnabled: (enabled: boolean) => void;
	setFOV: (fov: number) => void;
	setPointBudget: (budget: number) => void;
	setDescription: (description: string) => void;
	loadGUI: (callback?: () => void) => void;
	fitToScreen: () => void;
};

type PotreeGlobal = {
	Viewer: new (renderArea: HTMLElement) => PotreeViewerInstance;
	PointSizeType: {
		ADAPTIVE: unknown;
	};
	loadPointCloud: (
		url: string,
		name: string,
		callback: (event: PotreePointCloudEvent) => void,
	) => void;
};

declare global {
	interface Window {
		Potree?: PotreeGlobal;
	}
}

const STYLE_URLS = [
	"/potree/build/potree/potree.css",
	"/potree/libs/jquery-ui/jquery-ui.min.css",
	"/potree/libs/openlayers3/ol.css",
	"/potree/libs/spectrum/spectrum.css",
	"/potree/libs/jstree/themes/mixed/style.css",
];

const SCRIPT_URLS = [
	"/potree/libs/jquery/jquery-3.1.1.min.js",
	"/potree/libs/spectrum/spectrum.js",
	"/potree/libs/jquery-ui/jquery-ui.min.js",
	"/potree/libs/other/BinaryHeap.js",
	"/potree/libs/tween/tween.min.js",
	"/potree/libs/d3/d3.js",
	"/potree/libs/proj4/proj4.js",
	"/potree/libs/openlayers3/ol.js",
	"/potree/libs/i18next/i18next.js",
	"/potree/libs/jstree/jstree.js",
	"/potree/build/potree/potree.js",
	"/potree/libs/plasio/js/laslaz.js",
];

// Modern dark theme overrides for Potree's built-in UI
const POTREE_THEME_CSS = `
	:root {
		--color-0: #0d1117;
		--color-1: #30363d;
		--color-2: #21262d;
		--color-3: #388bfd;
		--color-4: #58a6ff;
		--bg-color: #0d1117;
		--bg-color-2: #161b22;
		--bg-light-color: #1c2128;
		--bg-dark-color: #0d1117;
		--bg-hover-color: #21262d;
		--font-color: #8b949e;
		--font-color-2: #e6edf3;
		--border-color: #30363d;
	}

	#potree_sidebar_container {
		border-right: 1px solid #21262d !important;
		background-color: #0d1117 !important;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
	}

	#sidebar_root {
		color: #8b949e !important;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
	}

	.potree_sidebar_brand {
		padding: 12px 16px;
		border-bottom: 1px solid #21262d;
	}

	.accordion > h3 {
		background: #161b22 !important;
		border: none !important;
		border-bottom: 1px solid #21262d !important;
		color: #e6edf3 !important;
		font-size: 0.75rem !important;
		letter-spacing: 0.06em !important;
		text-transform: uppercase !important;
		font-weight: 600 !important;
		padding: 10px 16px 10px 36px !important;
		text-shadow: none !important;
		box-shadow: none !important;
		border-radius: 0 !important;
	}

	.accordion > h3:hover {
		background: #1c2128 !important;
		filter: none !important;
	}

	.accordion > h3.ui-state-active {
		background: #1c2128 !important;
		color: #58a6ff !important;
	}

	.accordion-content, .pv-menu-list {
		background: transparent !important;
		border: none !important;
	}

	.pv-menu-list > * {
		margin: 2px 12px !important;
		color: #8b949e;
	}

	.ui-slider {
		background-color: #21262d !important;
		border: 1px solid #30363d !important;
		border-radius: 4px !important;
		height: 4px !important;
		margin-top: 6px !important;
		margin-bottom: 12px !important;
	}

	.ui-slider-handle {
		border: 2px solid #58a6ff !important;
		background: #0d1117!important;
		border-radius: 50% !important;
		width: 12px !important;
		height: 12px !important;
		top: -5px !important;
	}

	.ui-slider-range {
		background: #388bfd !important;
	}

	.ui-state-default {
		background: #30363d !important;
		border: 1px solid #21262d !important;
		color: #e6edf3 !important;
		border-radius: 4px !important;
	}

	.ui-state-active {
		background: #388bfd !important;
		color: #ffffff !important;
		border-color: #58a6ff !important;
	}

	.divider {
		color: #58a6ff !important;
		font-size: 0.7rem !important;
		letter-spacing: 0.08em !important;
		text-transform: uppercase !important;
		font-weight: 600 !important;
		margin: 12px 0 4px !important;
		padding: 0 12px !important;
	}

	.divider > span:before, .divider > span:after {
		background: #21262d !important;
	}

	.jstree-default .jstree-clicked,
	.jstree-default .jstree-hovered {
		background-color: #1c2128 !important;
		border-radius: 4px !important;
	}

	.jstree-anchor {
		color: #8b949e !important;
	}

	.potree-panel {
		background-color: #161b22 !important;
		border: 1px solid #21262d !important;
		border-radius: 6px !important;
	}

	.potree-panel-heading {
		background-color: #0d1117 !important;
		border-radius: 6px 6px 0 0 !important;
	}

	a:hover, a:visited, a:link, a:active {
		color: #58a6ff !important;
	}

	#potree_sidebar_container {
		scrollbar-color: #30363d #0d1117 !important;
	}

	::-webkit-scrollbar {
		width: 4px !important;
		background-color: #0d1117 !important;
	}

	::-webkit-scrollbar-thumb {
		background-color: #30363d !important;
		border-radius: 4px !important;
	}

	.button-icon:hover {
		filter: drop-shadow(0px 0px 4px #58a6ff) !important;
	}

	input[type="checkbox"] {
		accent-color: #388bfd;
	}
`;

const scriptPromises = new Map<string, Promise<void>>();

function ensureStyles(): void {
	if (typeof document === "undefined") return;

	for (const href of STYLE_URLS) {
		const selector = `link[data-potree-style="${href}"]`;
		const exists = document.querySelector(selector);
		if (exists) continue;

		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		link.setAttribute("data-potree-style", href);
		document.head.appendChild(link);
	}

	// Inject custom theme overrides
	const themeId = "potree-custom-theme";
	if (!document.getElementById(themeId)) {
		const style = document.createElement("style");
		style.id = themeId;
		style.textContent = POTREE_THEME_CSS;
		document.head.appendChild(style);
	}
}

function loadScript(src: string): Promise<void> {
	if (typeof document === "undefined") {
		return Promise.resolve();
	}

	const cached = scriptPromises.get(src);
	if (cached) return cached;

	const promise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-potree-script="${src}"]`,
		);

		if (existing) {
			if (existing.getAttribute("data-loaded") === "true") {
				resolve();
				return;
			}

			const onLoad = () => {
				existing.setAttribute("data-loaded", "true");
				resolve();
			};
			const onError = () => reject(new Error(`Failed to load script: ${src}`));

			existing.addEventListener("load", onLoad, { once: true });
			existing.addEventListener("error", onError, { once: true });
			return;
		}

		const script = document.createElement("script");
		script.src = src;
		script.async = false;
		script.setAttribute("data-potree-script", src);

		script.onload = () => {
			script.setAttribute("data-loaded", "true");
			resolve();
		};
		script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

		document.body.appendChild(script);
	});

	scriptPromises.set(src, promise);
	return promise;
}

export default function PotreeViewer({
	pointcloudUrl = "/pointclouds/tes/metadata.json",
	className,
	style,
	pointBudget = 2_000_000,
	showSidebar = true,
	onAoiPolygonChange,
	treeCentersGeojson = null,
	markerRadius = 2.0,
	markerZOffset = 4.0,
}: PotreeViewerProps) {
	const renderAreaRef = useRef<HTMLDivElement | null>(null);
	const sidebarRef = useRef<HTMLDivElement | null>(null);
	const viewerRef = useRef<PotreeViewerInstance | null>(null);
	const aoiMeasurementRef = useRef<PotreeMeasurement | null>(null);
	const treeCentersGeojsonRef = useRef<GeoJsonFeatureCollection | null>(null);
	const markerGroupRef = useRef<unknown | null>(null);

	const safeMarkerRadius = Number.isFinite(markerRadius) && markerRadius > 0 ? markerRadius : 2.0;
	const safeMarkerZOffset = Number.isFinite(markerZOffset) ? markerZOffset : 4.0;

	const clearTreeMarkers = () => {
		const viewer = viewerRef.current;
		const group = markerGroupRef.current as {
			userData?: {
				sharedGeometry?: { dispose?: () => void };
				sharedMaterial?: { dispose?: () => void } | Array<{ dispose?: () => void }>;
			};
			traverse?: (cb: (child: any) => void) => void;
		} | null;
		const scene = viewer?.scene?.scene;
		if (scene && group) {
			scene.remove(group);
		}

		const sharedGeometry = group?.userData?.sharedGeometry;
		const sharedMaterial = group?.userData?.sharedMaterial;
		if (sharedGeometry?.dispose) {
			sharedGeometry.dispose();
		}
		if (sharedMaterial) {
			if (Array.isArray(sharedMaterial)) {
				sharedMaterial.forEach((material) => material?.dispose?.());
			} else {
				sharedMaterial.dispose?.();
			}
		}

		if (!sharedGeometry && !sharedMaterial && group?.traverse) {
			group.traverse((child: any) => {
				if (child?.geometry?.dispose) {
					child.geometry.dispose();
				}
				if (child?.material) {
					if (Array.isArray(child.material)) {
						child.material.forEach((material: any) => material?.dispose?.());
					} else {
						child.material.dispose?.();
					}
				}
			});
		}

		markerGroupRef.current = null;
	};

	const renderTreeMarkers = (geojson: GeoJsonFeatureCollection) => {
		const viewer = viewerRef.current;
		const scene = viewer?.scene?.scene;
		if (!scene) {
			return;
		}

		clearTreeMarkers();

		const THREE = (window as any).THREE;
		if (!THREE || !geojson?.features?.length) {
			return;
		}
		const group = new THREE.Group();
		group.name = "tree-center-markers";
		group.renderOrder = 999;

		const geometry = new THREE.SphereGeometry(safeMarkerRadius, 16, 16);
		const material = new THREE.MeshBasicMaterial({
			color: 0xffff00,
			depthTest: false,
		});
		material.depthWrite = false;
		group.userData = {
			sharedGeometry: geometry,
			sharedMaterial: material,
		};

		for (const feature of geojson.features) {
			if (feature.geometry?.type !== "Point") continue;
			const coords = feature.geometry.coordinates;
			if (!Array.isArray(coords) || coords.length < 2) continue;

			const x = Number(coords[0]);
			const y = Number(coords[1]);
			const z = Number(coords[2] ?? 0);
			if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

			const marker = new THREE.Mesh(geometry, material);
			marker.position.set(x, y, z + safeMarkerZOffset);
			marker.name = `tree-center-${feature.properties?.id ?? ""}`;
			marker.renderOrder = 999;
			group.add(marker);
		}

		scene.add(group);
		markerGroupRef.current = group;
	};

	const clearAoi = () => {
		const measurement = aoiMeasurementRef.current;
		if (measurement) {
			measurement.remove?.();
			viewerRef.current?.scene.removeMeasurement?.(measurement);
		}

		aoiMeasurementRef.current = null;
		onAoiPolygonChange?.(null);
	};

	const startAoi = () => {
		const activeViewer = viewerRef.current;
		if (!activeViewer?.measuringTool?.startInsertion) {
			return;
		}

		clearAoi();
		const measurement = activeViewer.measuringTool.startInsertion({
			showDistances: false,
			showArea: true,
			closed: true,
			name: "AOI",
		});
		aoiMeasurementRef.current = measurement;
	};

	const saveAoi = () => {
		const activeViewer = viewerRef.current;
		const measurements = activeViewer?.scene?.measurements;
		const measurement = aoiMeasurementRef.current
			?? (measurements && measurements.length
				? measurements[measurements.length - 1]
				: undefined);

		console.log("AOI measurement object:", measurement);

		const points = measurement?.points ?? [];
		if (points.length < 3) {
			onAoiPolygonChange?.(null);
			return;
		}

		const polygon: AoiPolygon = points
			.map((point) => point.position)
			.filter((position): position is { x: number; y: number; z: number } => Boolean(position))
			.map((position) => [Number(position.x), Number(position.y)]);

		if (polygon.length < 3) {
			onAoiPolygonChange?.(null);
			return;
		}

		console.log("Extracted AOI polygon:", polygon);
		onAoiPolygonChange?.(polygon);
	};

	const aoiButtonStyle: CSSProperties = {
		background: "#161b22",
		color: "#e6edf3",
		border: "1px solid #30363d",
		borderRadius: "6px",
		fontSize: "11px",
		padding: "4px 8px",
		cursor: "pointer",
		fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
	};

	const aoiDangerButtonStyle: CSSProperties = {
		...aoiButtonStyle,
		borderColor: "#8b949e",
		color: "#8b949e",
	};

	useEffect(() => {
		treeCentersGeojsonRef.current = treeCentersGeojson;
		if (!treeCentersGeojson) {
			clearTreeMarkers();
			return;
		}

		renderTreeMarkers(treeCentersGeojson);
	}, [treeCentersGeojson, safeMarkerRadius, safeMarkerZOffset]);

	useEffect(() => {
		let disposed = false;
		let viewer: PotreeViewerInstance | null = null;

		if (typeof window === "undefined" || typeof document === "undefined") {
			return;
		}

		const initialize = async () => {
			ensureStyles();

			for (const src of SCRIPT_URLS) {
				await loadScript(src);
			}

			if (disposed) return;
			if (!renderAreaRef.current || !sidebarRef.current) return;

			const Potree = window.Potree;
			if (!Potree) {
				throw new Error("Potree global not available after script loading.");
			}

			viewer = new Potree.Viewer(renderAreaRef.current);
			viewerRef.current = viewer;
			const activeViewer = viewer;
			activeViewer.setEDLEnabled(true);
			activeViewer.setFOV(60);
			activeViewer.setPointBudget(pointBudget);
			activeViewer.setDescription("");

			// Initialize Potree GUI once viewer is ready.
			activeViewer.loadGUI(() => {
				if (disposed) return;

				const anyViewer = activeViewer as unknown as {
					setLanguage?: (lang: string) => void;
					toggleSidebar?: () => void;
				};

				anyViewer.setLanguage?.("en");

				if (!showSidebar) {
					anyViewer.toggleSidebar?.();
				}
			});

			Potree.loadPointCloud(pointcloudUrl, "PointCloud", (event) => {
				if (disposed) return;

				const pointcloud = event.pointcloud;
				if (!pointcloud || !pointcloud.material) return;

				pointcloud.material.size = 1;
				pointcloud.material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
				pointcloud.material.activeAttributeName = "classification";

				activeViewer.scene.addPointCloud(pointcloud);
				activeViewer.fitToScreen();
			});

			const pendingGeojson = treeCentersGeojsonRef.current;
			if (pendingGeojson) {
				renderTreeMarkers(pendingGeojson);
			}
		};

		initialize().catch((error) => {
			if (!disposed) {
				console.error("Failed to initialize Potree viewer:", error);
			}
		});

		return () => {
			disposed = true;
			clearTreeMarkers();

			if (viewer) {
				// Stop Potree render loop and release WebGL resources on route leave.
				viewer.renderer?.setAnimationLoop?.(null);
				viewer.renderer?.dispose?.();
				viewer.renderer?.forceContextLoss?.();
				viewer.stats?.dom?.remove();
				viewer = null;
			}

			viewerRef.current = null;
			aoiMeasurementRef.current = null;
			treeCentersGeojsonRef.current = null;

			// Clear render/sidebar content to avoid stale DOM when remounting.
			if (renderAreaRef.current) {
				renderAreaRef.current.innerHTML = "";
			}
			if (sidebarRef.current) {
				sidebarRef.current.innerHTML = "";
			}
		};
	}, [pointcloudUrl, pointBudget, showSidebar]);

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: "#0d1117",
			}}
		>
			{/* Minimal top navbar */}
			<div
				style={{
					height: "44px",
					minHeight: "44px",
					background: "#0d1117",
					borderBottom: "1px solid #21262d",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "0 16px",
					zIndex: 1000,
					flexShrink: 0,
				}}
			>
				<Link
					to="/potree"
					style={{
						display: "flex",
						alignItems: "center",
						gap: "10px",
						textDecoration: "none",
					}}
				>
					{/* Lidar icon */}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="12" cy="12" r="2" />
						<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
						<path d="M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
					</svg>
					<span style={{ color: "#e6edf3", fontSize: "13px", fontWeight: 600, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", letterSpacing: "0.01em" }}>
						Lidar Viewer
					</span>
				</Link>

				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
						<button type="button" onClick={startAoi} style={aoiButtonStyle}>
							Gambar AOI
						</button>
						<button type="button" onClick={saveAoi} style={aoiButtonStyle}>
							Simpan AOI
						</button>
						<button type="button" onClick={clearAoi} style={aoiDangerButtonStyle}>
							Clear AOI
						</button>
					</div>
					<span style={{ color: "#30363d", fontSize: "11px", fontFamily: "monospace" }}>
						{pointcloudUrl.split("/").pop()}
					</span>
					<Link
						to="/potree"
						style={{
							color: "#8b949e",
							fontSize: "12px",
							fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
							textDecoration: "none",
							padding: "4px 10px",
							border: "1px solid #30363d",
							borderRadius: "6px",
							transition: "border-color 0.15s, color 0.15s",
						}}
						onMouseEnter={e => {
							(e.target as HTMLElement).style.borderColor = "#58a6ff";
							(e.target as HTMLElement).style.color = "#e6edf3";
						}}
						onMouseLeave={e => {
							(e.target as HTMLElement).style.borderColor = "#30363d";
							(e.target as HTMLElement).style.color = "#8b949e";
						}}
					>
						← Kembali
					</Link>
				</div>
			</div>

			{/* Potree container below navbar */}
			<div
				className={`potree_container ${className ?? ""}`}
				style={{
					flex: 1,
					position: "relative",
					overflow: "hidden",
					...style,
				}}
			>
				<div
					id="potree_render_area"
					ref={renderAreaRef}
					style={{
						position: "absolute",
						inset: 0,
					}}
				/>
				<div
					id="potree_sidebar_container"
					ref={sidebarRef}
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						bottom: 0,
						display: showSidebar ? "block" : "none",
						zIndex: 10,
					}}
				/>
			</div>
		</div>
	);
}
