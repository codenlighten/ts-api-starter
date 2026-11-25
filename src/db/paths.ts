import { fileURLToPath } from "node:url";

// Works from src/db (tsx) and dist/db (compiled): both sit two levels below the repo root.
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));
