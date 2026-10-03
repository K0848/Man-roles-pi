import { JsonlProductRepository } from "../../src/p1/product-repository.js";
import { JsonlSessionLog } from "../../src/p1/session-log.js";

const root = process.argv[2];
if (!root) throw new Error("reload child requires a data directory");
const events = await new JsonlProductRepository(root).readEvents();
const sessionEvents = await new JsonlSessionLog(root, "wang-yangming").read();
if (events.filter((event) => event.type === "accepted-turn").length !== 1) {
  throw new Error("reload child did not read exactly one accepted turn");
}
if (!sessionEvents.some((event) => event.type === "agent_end")) {
  throw new Error("reload child did not read agent_end");
}
console.log(JSON.stringify({ accepted: 1, sessionEvents: sessionEvents.length }));
