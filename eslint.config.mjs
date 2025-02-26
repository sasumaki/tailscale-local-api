import globals from "globals"
import pluginJs from "@eslint/js"
import tseslint from "typescript-eslint"

export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { ignores: ["dist/*", "node_modules/*"] },
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TODO: Refactor later to get rid of "any"'s
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-escape": "off",
    },
  },
]
