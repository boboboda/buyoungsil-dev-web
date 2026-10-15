// MCP JSON-RPC 껍데기(Streamable HTTP, 무상태). 도구 목록·안내문·도구 실행 함수를 받아 handleRpc 을 만든다.
// 도구 묶음(블로그 초안함 / 공장)은 이 파일을 모른다. lib/drafts/mcp.ts 가 묶어서 /api/mcp 에 연결한다.
export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

export type RpcOutcome = { status: number; body?: unknown };

export type RpcConfig = {
  tools: unknown[];
  instructions: string;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  serverName: string;
  serverVersion: string;
};

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

export function createRpcHandler(config: RpcConfig) {
  async function handleOne(msg: JsonRpcRequest): Promise<unknown | null> {
    const isNotification = msg.id === undefined || msg.id === null;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

    if (typeof msg.method !== "string") return isNotification ? null : fail(-32600, "Invalid Request");
    if (isNotification) return null; // notifications/initialized 등: 응답 없음

    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        const version = typeof asked === "string" && SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[1];
        return reply({
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: config.serverName, version: config.serverVersion },
          instructions: config.instructions,
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: config.tools });
      case "tools/call": {
        const name = msg.params?.name;
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (typeof name !== "string") return fail(-32602, "도구 이름이 필요해요");
        try {
          return reply(await config.callTool(name, args));
        } catch (error) {
          console.error("MCP 도구 오류:", error);
          return reply(text("서버에서 오류가 났어요. 잠시 뒤 다시 시도해 주세요.", true));
        }
      }
      default:
        return fail(-32601, `지원하지 않는 메서드예요: ${msg.method}`);
    }
  }

  return async function handleRpc(payload: unknown): Promise<RpcOutcome> {
    if (Array.isArray(payload)) {
      if (payload.length === 0) return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } } };
      const out = (await Promise.all(payload.map((m) => handleOne(m as JsonRpcRequest)))).filter((r) => r !== null);
      return out.length ? { status: 200, body: out } : { status: 202 };
    }
    if (!payload || typeof payload !== "object") {
      return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } } };
    }
    const result = await handleOne(payload as JsonRpcRequest);
    return result === null ? { status: 202 } : { status: 200, body: result };
  };
}
