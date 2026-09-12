import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Named props interfaces follow the project convention, even without added fields.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
    },
  },
  {
    files: ["src/components/ui/*.tsx"],
    rules: {
      // shadcn intentionally colocates these helpers with their components.
      "react-refresh/only-export-components": ["warn", {
        allowConstantExport: true,
        allowExportNames: ["badgeVariants", "buttonVariants", "cardVariants", "useFormField", "navigationMenuTriggerStyle", "useSidebar", "toast", "toggleVariants"],
      }],
    },
  },
);
