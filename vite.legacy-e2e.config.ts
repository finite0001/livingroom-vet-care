/** Mocked legacy browser suite only; production and genuine proofs stay unchanged. */
import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import original from "./vite.config";

export default defineConfig(environment => mergeConfig(original(environment), {
  plugins: [{
    name: "synthetic-legacy-stock-transport",
    enforce: "pre",
    transform(code: string, id: string) {
      if (id.split("?")[0] !== path.resolve(__dirname, "src/hub/components/layout/AppShell.tsx")) return null;
      const before = 'from "../../features/controlled-drugs/entry/ControlledStockEntryProvider"';
      if (code.split(before).length !== 2) throw new Error("Exact original entry-provider import required");
      return { code: code.replace(before, 'from "/tests/fixtures/legacy-stock-entry-provider.tsx"'), map: null };
    },
  }],
}));
