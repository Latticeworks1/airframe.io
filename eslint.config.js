import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Enforce the Rules of Hooks
      "react-hooks/rules-of-hooks": "error",
      // Warn on missing deps; the game loop's mutable refs are intentional
      "react-hooks/exhaustive-deps": "warn",
      // purity and set-state-in-effect: too strict for game-loop-inside-useEffect pattern
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",

      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { "allowEmptyCatch": true }],
      "no-useless-assignment": "off",
    }
  },
  {
    ignores: ["dist/**", "node_modules/**", "tools/generate-map-files.mjs"]
  }
);
