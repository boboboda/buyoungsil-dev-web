// 앱 공장 감독 프로그램: 서명 키가 앱 폴더 git 에 들어가지 않게 막는다
// - 일감을 시작할 때마다(새 앱·수정·출시 준비, 새 폴더 포함) 앱 폴더 .gitignore 에 키 파일 패턴이 없으면 덧붙인다(기존 내용 유지)
// - 앱 폴더를 커밋하기 전에, git add -A 가 넣을 파일(추적 중 + 무시되지 않은 새 파일) 중 키 파일이 있으면 커밋을 멈춘다
//   (이름 패턴, 또는 확장자 없는 파일의 머리가 JKS/JCEKS 매직·PKCS12 꼴). 파일은 머리 몇 바이트만 보고, 내용은 어디에도 보내지 않는다.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const KEY_IGNORE = ["*.jks", "*.keystore", "*.p12", "*.pfx", "key.properties", "secrets.env"];
const KEY_EXT = [".jks", ".keystore", ".p12", ".pfx"];
const KEY_NAMES = ["key.properties", "secrets.env"];

/** .gitignore 에 lines 중 없는 줄만 덧붙인다. 덧붙인 줄 목록을 돌려준다 */
export function addIgnoreLines(dir, lines) {
  const p = path.join(dir, ".gitignore");
  const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const cur = new Set(have.split(/\r?\n/).map((l) => l.trim()));
  const need = [...new Set(lines)].filter((l) => !cur.has(l));
  if (need.length) fs.appendFileSync(p, (have && !have.endsWith("\n") ? "\n" : "") + need.join("\n") + "\n");
  return need;
}

/** 파일 머리로 키 저장소 형식을 추정: "JKS" | "JCEKS" | "PKCS12" | null (1KB~1MB 일반 파일만, 링크는 안 따라감) */
export function keystoreHeader(file) {
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size < 1024 || st.size > 1024 * 1024) return null;
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(32);
    fs.readSync(fd, b, 0, 32, 0);
    const m = b.readUInt32BE(0);
    if (m === 0xfeedfeed) return "JKS";
    if (m === 0xcececece) return "JCEKS";
    // PKCS12(PFX): SEQUENCE { INTEGER 3, SEQUENCE { OID 1.2.840.113549.1.7.1 (pkcs7-data) ... } }
    const oid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
    if (b[0] === 0x30 && (b[1] === 0x82 || b[1] === 0x83 || b[1] === 0x80) && b.includes(Buffer.from([0x02, 0x01, 0x03])) && b.includes(oid)) return "PKCS12";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** 이 상대 경로가 키 파일인지(이름 패턴, 확장자 없으면 머리) */
export function isKeyFile(dir, rel) {
  const base = path.basename(rel).toLowerCase();
  if (KEY_NAMES.includes(base) || KEY_EXT.some((e) => base.endsWith(e))) return fs.existsSync(path.join(dir, rel));
  if (base.includes(".")) return false;
  return keystoreHeader(path.join(dir, rel)) !== null;
}

/**
 * git add -A 로 커밋에 들어갈 파일 중 키 파일(상대 경로). git 저장소가 아니거나 git 이 없으면 빈 배열.
 * 이미 스테이징된 것과 추적 중인 것(--cached), 무시되지 않은 새 파일(--others --exclude-standard)을 본다.
 */
export function keyFilesToCommit(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) return [];
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: dir, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return [];
  const files = [...new Set(r.stdout.split("\0").filter(Boolean))];
  return files.filter((rel) => isKeyFile(dir, rel)).slice(0, 20);
}
