import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("potree", "routes/potree.tsx"),
	route("classification", "routes/classification.tsx"),
] satisfies RouteConfig;
