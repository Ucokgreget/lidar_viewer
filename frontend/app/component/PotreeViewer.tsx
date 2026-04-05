import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

type PotreeViewerProps = {
	pointcloudUrl?: string;
	className?: string;
	style?: CSSProperties;
	pointBudget?: number;
	showSidebar?: boolean;
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

type PotreeViewerInstance = {
	scene: {
		addPointCloud: (pointcloud: unknown) => void;
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
}: PotreeViewerProps) {
	const renderAreaRef = useRef<HTMLDivElement | null>(null);
	const sidebarRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let disposed = false;

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

			const viewer = new Potree.Viewer(renderAreaRef.current);
			viewer.setEDLEnabled(true);
			viewer.setFOV(60);
			viewer.setPointBudget(pointBudget);
			viewer.setDescription("");

			// Initialize Potree GUI once viewer is ready.
			viewer.loadGUI(() => {
				if (disposed) return;

				const anyViewer = viewer as unknown as {
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

				viewer.scene.addPointCloud(pointcloud);
				viewer.fitToScreen();
			});
		};

		initialize().catch((error) => {
			if (!disposed) {
				console.error("Failed to initialize Potree viewer:", error);
			}
		});2

		return () => {
			disposed = true;

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
			className={`potree_container ${className ?? ""}`}
			style={{
				width: "100%",
				height: "100%",
				position: "relative",
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
	);
}
