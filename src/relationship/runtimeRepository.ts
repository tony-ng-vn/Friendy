/**
 * Runtime store selector for relationship persistence.
 *
 * Callers: app bootstrap, CLI entrypoints, and tests that need to swap stores without changing
 * agent code.
 *
 * `FRIENDY_RUNTIME_STORE=sqlite` opts into durable local state; anything else keeps the in-memory
 * MVP repository so unit tests and CI stay hermetic without a database file.
 */
import { createRelationshipRepository, type RelationshipRepository, type RepositorySeed } from "./repository";
import { createSqliteRelationshipRepository } from "./sqliteRepository";

/** Injectable env and optional seed data for store construction in tests. */
export type RuntimeRelationshipRepositoryInput = {
  env?: Partial<NodeJS.ProcessEnv>;
  seed?: RepositorySeed;
};

/**
 * Returns the configured relationship repository implementation.
 *
 * Switching stores is env-only so agent, tools, and transports share one factory and tests can
 * inject `env` without touching global `process.env`.
 */
export function createRuntimeRelationshipRepository({
  env = process.env,
  seed
}: RuntimeRelationshipRepositoryInput = {}): RelationshipRepository {
  if (env.FRIENDY_RUNTIME_STORE === "sqlite") {
    const path = env.FRIENDY_SQLITE_PATH;
    if (!path) {
      throw new Error("FRIENDY_RUNTIME_STORE=sqlite requires FRIENDY_SQLITE_PATH.");
    }
    return createSqliteRelationshipRepository({ path, seed });
  }

  return createRelationshipRepository(seed);
}
