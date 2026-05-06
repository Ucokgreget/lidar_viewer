import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("potree", "routes/potree.tsx"),
	route("potree/view", "routes/potree-viewer.tsx"),
	route("classification", "routes/classification.tsx"),
	route("conversion", "routes/conversion.tsx"),
] satisfies RouteConfig;
