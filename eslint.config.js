import js from "@eslint/js";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "test-results", "playwright-report"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, jsxA11y.flatConfigs.recommended],
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
      // This codebase wraps the control inside a native <label>, and the controls are
      // our own components (Input, Select, ...) rather than native tags, so the rule
      // needs to be told which components count as controls.
      "jsx-a11y/label-has-associated-control": ["error", {
        controlComponents: ["Input", "Textarea", "Select", "SelectTrigger", "Switch", "Checkbox", "RadioGroup"],
        depth: 4,
      }],
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
  {
    // Patient voicemail recordings are plain audio with no caption track to
    // attach, and none can be produced. In MessageTimeline the machine
    // transcription is rendered directly under the player as the text
    // alternative.
    files: ["src/hub/components/conversations/MessageTimeline.tsx"],
    rules: { "jsx-a11y/media-has-caption": "off" },
  },
);
