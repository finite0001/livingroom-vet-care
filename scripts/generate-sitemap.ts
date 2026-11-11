// Optional manual refresh; Vite also runs this for every dev/build entry point.
import { resolve } from "node:path";
import { generatePublicDiscovery } from "./public-discovery.ts";

generatePublicDiscovery(resolve("."));
