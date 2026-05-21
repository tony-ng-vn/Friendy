import { createRelationshipRepository, type RelationshipRepository, type RepositorySeed } from "./repository";
import { createSqliteRelationshipRepository } from "./sqliteRepository";

export type RuntimeRelationshipRepositoryInput = {
  env?: Partial<NodeJS.ProcessEnv>;
  seed?: RepositorySeed;
};

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
