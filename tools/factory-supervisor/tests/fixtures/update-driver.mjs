// 시험용 운전기(update.test.mjs 가 자식 프로세스로 띄운다): 복사해 둔 감독 프로그램 폴더의 update.mjs 를 가짜 멈춤 조정자·가짜 시계로 돌려 본다.
// 환경: SUP_COPY(복사한 폴더), FACTORY_LAUNCHER=1, FACTORY_UPDATE_STATE(임시 파일), SCRIPT(JSON: 단계 목록)
// 단계: { dt: 분 단위 시계 이동, hard, soft, paused, autoUpdate, bundleMin, updateNow }  → 마지막에 JSON 으로 단계별 관찰 결과를 찍는다
import path from "node:path";
import { pathToFileURL } from "node:url";

const base = path.resolve(process.env.SUP_COPY);
const update = await import(pathToFileURL(path.join(base, "update.mjs")).href);
const logs = [];
const origLog = console.log;
console.log = (...a) => logs.push(a.join(" "));
let exited = false;
update._setExitForTest(() => {
  exited = true;
});

const fake = { soft: 0, paused: 0, requested: 0, persisted: 0, resumed: 0 };
const pauser = {
  pausedCount: () => fake.paused,
  softCount: () => fake.soft,
  requestPause() {
    fake.requested++;
    fake.paused += fake.soft; // 안전한 지점에서 곧바로 멈춘 것으로 본다
    fake.soft = 0;
  },
  persist() {
    fake.persisted++;
    return Array.from({ length: fake.paused }, (_, i) => ({ key: `u${i}` }));
  },
  resumeAll() {
    fake.resumed++;
    const n = fake.paused;
    fake.soft += fake.paused;
    fake.paused = 0;
    return n;
  },
};

const script = JSON.parse(process.env.SCRIPT);
const t0 = Date.now() + 11 * 60_000; // 처음 확인 주기(10분)가 지난 시각에서 시작
const out = [];
for (const s of script) {
  if (s.bundleMin !== undefined) update.setUpdateBundle(s.bundleMin);
  if (s.updateNow) update.requestUpdateNow();
  if (s.hard !== undefined) fake.hard = s.hard;
  if (s.soft !== undefined) fake.soft = s.soft;
  if (s.paused !== undefined) fake.paused = s.paused;
  const now = t0 + (s.dt ?? 0) * 60_000;
  const running = fake.soft + fake.paused + (fake.hard ?? 0);
  const before = logs.length;
  update.maybeUpdate({ running, autoUpdate: s.autoUpdate !== false, pauser, now });
  out.push({ name: s.name ?? null, exited, waiting: update.updateWaiting(), bundle: update.bundleStatus(now), fake: { ...fake }, logs: logs.slice(before) });
  if (exited) break;
}
origLog(JSON.stringify(out));
