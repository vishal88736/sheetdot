import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "cloudflare-workers-test-shim",
      resolveId(id) {
        if (id === "cloudflare:workers") {
          return "\0cloudflare:workers";
        }
        return null;
      },
      load(id) {
        if (id === "\0cloudflare:workers") {
          return "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";
        }
        return null;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
