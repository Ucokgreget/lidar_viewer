import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("potree", "routes/potree.tsx"),
] satisfies RouteConfig;
