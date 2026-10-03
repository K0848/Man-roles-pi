import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import { createNodeSqliteFactory, SqliteSessionRepo } from "@earendil-works/pi-session-backend-sqlite-node";
import { DeleteCheckpoint } from "../../src/p5/delete-checkpoint.js";

describe("P5 official Pi SQLite Session backend", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("persists a branch, rejects live duplicate open, cold-reopens, and deletes after close", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p5-sqlite-"));
    roots.push(root);
    const repo = new SqliteSessionRepo({ directory: root, databaseFactory: createNodeSqliteFactory() });
    const session = await repo.create({ id: "p5-session" }, BACKGROUND_CONTEXT);
    const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
    await branch.appendMessage({ role: "user", content: "cold recovery message", timestamp: Date.now() }, BACKGROUND_CONTEXT);
    const metadata = session.metadata;
    await expect(repo.open(metadata, BACKGROUND_CONTEXT)).rejects.toThrow();
    await expect(repo.delete(metadata, BACKGROUND_CONTEXT)).rejects.toThrow();
    await session.close(BACKGROUND_CONTEXT);
    await repo.close(BACKGROUND_CONTEXT);

    const reopenedRepo = new SqliteSessionRepo({ directory: root, databaseFactory: createNodeSqliteFactory() });
    const listed = await reopenedRepo.list(undefined, BACKGROUND_CONTEXT);
    expect(listed).toHaveLength(1);
    const reopened = await reopenedRepo.open(listed[0]!, BACKGROUND_CONTEXT);
    const reopenedBranch = await reopened.branch("main", BACKGROUND_CONTEXT);
    expect(reopenedBranch).toBeDefined();
    expect((await reopenedBranch!.findEntries({ order: "oldestFirst" }, BACKGROUND_CONTEXT)).some((entry) => entry.type === "message" && entry.message.role === "user" && entry.message.content === "cold recovery message")).toBe(true);
    await reopened.close(BACKGROUND_CONTEXT);
    await reopenedRepo.delete(listed[0]!, BACKGROUND_CONTEXT);
    await reopenedRepo.close(BACKGROUND_CONTEXT);

    const finalRepo = new SqliteSessionRepo({ directory: root, databaseFactory: createNodeSqliteFactory() });
    expect(await finalRepo.list(undefined, BACKGROUND_CONTEXT)).toHaveLength(0);
    await finalRepo.close(BACKGROUND_CONTEXT);
  });

  it("resumes deletion from the same checkpoint after an interruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p5-delete-"));
    roots.push(root);
    const repo = new SqliteSessionRepo({ directory: root, databaseFactory: createNodeSqliteFactory() });
    const first = await repo.create({ id: "delete-a" }, BACKGROUND_CONTEXT);
    const second = await repo.create({ id: "delete-b" }, BACKGROUND_CONTEXT);
    const targets = [first.metadata, second.metadata];
    await first.close(BACKGROUND_CONTEXT);
    await second.close(BACKGROUND_CONTEXT);
    await repo.close(BACKGROUND_CONTEXT);

    const deletionRepo = new SqliteSessionRepo({ directory: root, databaseFactory: createNodeSqliteFactory() });
    const checkpoint = new DeleteCheckpoint(root);
    await expect(checkpoint.run("delete-op", deletionRepo, targets, BACKGROUND_CONTEXT, 1)).rejects.toThrow("injected deletion interruption");
    expect((await checkpoint.read()).filter((event) => event.type === "session-deleted")).toHaveLength(1);
    await checkpoint.run("delete-op", deletionRepo, targets, BACKGROUND_CONTEXT);
    expect((await checkpoint.read()).filter((event) => event.type === "session-deleted")).toHaveLength(2);
    expect(await deletionRepo.list(undefined, BACKGROUND_CONTEXT)).toHaveLength(0);
    await deletionRepo.close(BACKGROUND_CONTEXT);
  });
});
