import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChoiceController } from "../../src/p4/choice-controller.js";
import { StateAnalysisController } from "../../src/p4/state-analysis-controller.js";

describe("P4 waiting-user and detached state analysis", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("answers or cancels one pending choice idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p4-choice-"));
    roots.push(root);
    const choices = new ChoiceController(root);
    await choices.ask("choice-1", "wang-yangming", "选择一个方向");
    const answered = await choices.answer("choice-1", ["先试一周"]);
    const repeatedCancel = await choices.cancel("choice-1");
    expect(answered.type).toBe("choice-answered");
    expect(repeatedCancel).toEqual(answered);
    expect((await choices.read()).filter((event) => event.type === "choice-answered")).toHaveLength(1);
  });

  it("retries detached state analysis without rerunning persona output", async () => {
    const root = await mkdtemp(join(tmpdir(), "man-roles-pi-p4-state-"));
    roots.push(root);
    const analysis = new StateAnalysisController(root);
    const failed = await analysis.run("state-1", async () => { throw new Error("provider unavailable"); });
    const completed = await analysis.run("state-1", async () => "candidate B");
    expect(failed.type).toBe("state-analysis-failed");
    expect(completed.type).toBe("state-analysis-completed");
    expect(completed.attempt).toBe(2);
    expect((await analysis.read()).filter((event) => event.type === "state-analysis-claimed")).toHaveLength(2);
  });
});
