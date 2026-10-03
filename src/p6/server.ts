import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type RemoteTurnRequest = { dilemmaId: string; personaId: string; operationId: string; messageId: string; text: string };
export type RemoteProjection = { dilemmaId: string; events: unknown[]; status: "ready" | "running" | "failed" };
export type RemoteApplication = {
  getProjection(dilemmaId: string): Promise<RemoteProjection>;
  submitTurn(input: RemoteTurnRequest): Promise<unknown>;
};

const INDEX_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>向古人问惑 · Pi</title><style>body{font-family:system-ui;margin:2rem;max-width:52rem}textarea{width:100%;min-height:7rem}button{margin:.5rem 0;padding:.5rem 1rem}pre{white-space:pre-wrap;background:#f5f5f5;padding:1rem}</style></head><body><h1>向古人问惑 · Pi</h1><p>这是 P6 的最小产品 Remote/UI 入口。</p><label>困惑 ID <input id="dilemma" value="demo"></label><br><label>人物 ID <input id="persona" value="wang-yangming"></label><br><textarea id="text">我最近有一个现实困惑。</textarea><br><button id="send">发送</button><pre id="output">等待操作</pre><script>const out=document.querySelector('#output');document.querySelector('#send').onclick=async()=>{const dilemma=document.querySelector('#dilemma').value;const body={dilemmaId:dilemma,personaId:document.querySelector('#persona').value,operationId:'ui-'+Date.now(),messageId:'msg-'+Date.now(),text:document.querySelector('#text').value};const r=await fetch('/api/conversations/'+encodeURIComponent(dilemma)+'/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});out.textContent=JSON.stringify(await r.json(),null,2)};</script></body></html>`;

export class P6Server {
  readonly server: Server;

  constructor(private readonly app: RemoteApplication) {
    this.server = createServer((request, response) => { void this.handle(request, response); });
  }

  listen(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(port, "127.0.0.1", () => {
        const address = this.server.address();
        resolve(typeof address === "object" && address !== null ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") return this.send(response, 200, INDEX_HTML, "text/html; charset=utf-8");
      if (request.method === "GET" && url.pathname === "/api/health") return this.json(response, 200, { ok: true, runtime: "pi" });
      const projectionMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/projection$/);
      if (request.method === "GET" && projectionMatch) return this.json(response, 200, await this.app.getProjection(decodeURIComponent(projectionMatch[1]!)));
      const turnMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/turn$/);
      if (request.method === "POST" && turnMatch) {
        const input = await readJson(request) as RemoteTurnRequest;
        if (input.dilemmaId !== decodeURIComponent(turnMatch[1]!)) return this.json(response, 400, { error: "dilemmaId mismatch" });
        return this.json(response, 200, await this.app.submitTurn(input));
      }
      return this.json(response, 404, { error: "not_found" });
    } catch (error) {
      return this.json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    this.send(response, status, JSON.stringify(body), "application/json; charset=utf-8");
  }

  private send(response: ServerResponse, status: number, body: string, contentType: string): void {
    response.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body) });
    response.end(body);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
