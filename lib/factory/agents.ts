// 에이전트 블록 정의(4-2)를 통제실에 읽기 전용으로 보여 주려고 읽는다.
// 정의 파일은 감독 프로그램 폴더(tools/factory-supervisor/agents/)에 있고, 감독 프로그램이 쓰는 검사(agentspec.mjs)를 그대로 쓴다.
// 서버는 정의를 고치지 않는다. 거절된 정의는 거절 이유와 함께 목록에 나온다(감독 프로그램은 그 종류를 예전 코드 그대로 돌린다).
import path from "node:path";

import { parseAgentDir, summarizeAgent, summarizeFlow } from "../../tools/factory-supervisor/agentspec.mjs";

export interface AgentSummary {
  id: string;
  kind: string;
  label: string;
  summary: string;
  migrated: boolean;
  engines: string[];
  workspace: string;
  tools: string[];
  blockedTools: string[];
  readOnly: boolean;
  network: string;
  hooks: string[];
  keys: string;
  prompt: string;
  after: string[];
  next: string[];
}

export interface FlowSummary {
  id: string;
  label: string;
  jobKind: string;
  steps: { id: string; label: string; optional: boolean; when: string | null; agent: string | null; gate: string | null; variants: { when: string; agent: string }[]; agentLabel: string | null }[];
}

export interface AgentsView {
  agents: AgentSummary[];
  flows: FlowSummary[];
  errors: { file: string; message: string }[];
}

export const AGENTS_DIR = path.join(process.cwd(), "tools", "factory-supervisor", "agents");

const ORDER = ["C1", "A1", "A2", "A3", "A4", "R1", "L1", "T", "M1", "H1"];

/** 정의 폴더를 읽어 통제실 표시용으로 요약한다. 못 읽어도 던지지 않는다(오류로 돌려준다) */
export function readAgentsView(dir: string = AGENTS_DIR): AgentsView {
  try {
    const r = parseAgentDir(dir);
    const agents = [...r.agents.values()].map((s) => summarizeAgent(s) as AgentSummary).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const flows = r.flows.map((f) => summarizeFlow(f, r.agents) as FlowSummary);

    return { agents, flows, errors: r.errors };
  } catch {
    return { agents: [], flows: [], errors: [{ file: "agents", message: "정의 폴더를 읽지 못했어요." }] };
  }
}
