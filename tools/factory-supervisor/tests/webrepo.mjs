// 감독 전용 저장소(tools/factory-supervisor 만 있는 clone)에서는 홈페이지 소스(lib/·app/·components/)가 없다.
// 일부 시험은 그 소스를 직접 읽어서(typescript 로 변환해 불러옴) 홈페이지 쪽 동작을 같이 시험하므로, 소스가 없으면 파일 전체를 건너뛴다.
// 홈페이지가 있는 저장소(selfdev)에서는 그대로 돈다. 감독 쪽만 보는 시험은 영향이 없다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 홈페이지 소스가 없으면 건너뛴다고 알리고 이 시험 파일을 정상 종료(0)한다. 첫 줄(import 바로 아래)에서 부른다 */
export function skipUnlessWebRepo(importMetaUrl) {
  const repo = path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "../../..");
  if (fs.existsSync(path.join(repo, "lib", "factory"))) return;
  console.log(`# 건너뜀: 홈페이지 소스(lib/factory)가 없는 감독 전용 저장소라 ${path.basename(fileURLToPath(importMetaUrl))} 를 돌리지 않아요(홈페이지가 있는 selfdev 에서 돌아요).`);
  process.exit(0);
}
