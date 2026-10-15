// serverctl 시험용 가짜 ssh: 진짜 서버 대신 이 PC 의 임시 폴더(FAKE_HOME)에서 원격 명령을 bash 로 돌린다.
// serverctl(FACTORY_TEST_MODE=1 + SERVERCTL_SSH)과 git push(GIT_SSH_COMMAND) 둘 다 이 스크립트를 부른다.
// 호스트는 FAKE_SSH_LOG 에 한 줄씩 남긴다(시험이 대상 서버를 확인). sudo·nginx·systemctl·certbot·docker 는 FAKE_BIN 의 가짜를 쓴다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
let i = 0;
while (i < args.length && args[i].startsWith("-")) i += ["-o", "-p", "-i", "-l"].includes(args[i]) ? 2 : 1;
const host = args[i];
const cmd = args.slice(i + 1).join(" ");
if (process.env.FAKE_SSH_LOG) fs.appendFileSync(process.env.FAKE_SSH_LOG, `${host}\n`);
const home = process.env.FAKE_HOME;
// 윈도우 명령줄로 넘기면 따옴표가 깨지므로, ssh 가 원격 셸에 주는 문자열을 파일에 써서 bash 로 돌린다
const script = path.join(os.tmpdir(), `fake-ssh-${process.pid}-${Date.now()}.sh`);
// Git Bash 는 시작할 때 자기 /usr/bin 을 PATH 앞에 넣으므로, 가짜 명령 폴더를 스크립트 안에서 다시 맨 앞에 둔다
const fb = String(process.env.FAKE_BIN).replace(/\\/g, "/");
fs.writeFileSync(script, `FB='${fb}'; command -v cygpath >/dev/null && FB=$(cygpath -u "$FB"); export PATH="$FB:$PATH"\n${cmd}\n`);
const r = spawnSync(process.env.FAKE_BASH, [script.replace(/\\/g, "/")], {
  cwd: home,
  stdio: "inherit",
  env: { ...process.env, HOME: home, PATH: `${process.env.FAKE_BIN}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` },
});
fs.rmSync(script, { force: true });
process.exit(r.status ?? 255);
