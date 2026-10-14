import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

// Unit tests: colocated under src/. No database, no network.
// - *.test.ts  run in Node (pure logic).
// - *.test.tsx run in jsdom (React components, with Testing Library).
// Security tests under tests/security that need no database or server run here too.
// A test marked `it.fails` there demonstrates an open finding in docs/SECURITY.md; it turns
// red when the code is fixed, and the fix converts it to a plain `it`.
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/components/ui/test-setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "security",
          environment: "node",
          include: ["tests/security/**/*.test.ts"],
        },
      },
    ],
  },
});
