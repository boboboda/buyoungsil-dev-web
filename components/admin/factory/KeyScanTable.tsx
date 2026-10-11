// components/admin/factory/KeyScanTable.tsx
// 키 점검 결과(앱별 .jks·.keystore 경로·별칭·SHA-1, key.properties 의 storeFile·keyAlias, git 추적 여부). 비밀번호는 없다.
import type { KeyScanApp } from "./releaseTypes";

export default function KeyScanTable({ apps }: { apps: KeyScanApp[] }) {
  if (apps.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-default-500">
            <th className="p-1">앱</th>
            <th className="p-1">키 파일 · 별칭 · SHA-1</th>
            <th className="p-1">key.properties</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.appSlug} className="border-t border-default-100 align-top">
              <td className="p-1 font-medium">{a.appSlug}</td>
              <td className="p-1">
                {a.keys.length === 0
                  ? "없음"
                  : a.keys.map((k) => (
                      <div key={k.path} className="mb-1">
                        <code className="break-all">{k.path}</code> ({k.type}){k.gitTracked ? " ⚠️ git 추적 중" : ""}
                        {k.note ? <span className="text-default-500"> — {k.note}</span> : null}
                        {k.aliases.map((x) => (
                          <div key={x.alias} className="pl-2 text-default-600">
                            {x.alias}: <code className="break-all">{x.sha1 ?? "지문 못 읽음"}</code>
                          </div>
                        ))}
                      </div>
                    ))}
              </td>
              <td className="p-1">
                {a.keyProperties.length === 0
                  ? "없음"
                  : a.keyProperties.map((k) => (
                      <div key={k.path} className="mb-1">
                        <code className="break-all">{k.path}</code>
                        {k.gitTracked ? (
                          <b className="text-danger"> ⚠️ git 추적 중(비밀번호가 커밋됐을 수 있어요)</b>
                        ) : k.gitTracked === false ? (
                          " · git 제외"
                        ) : (
                          ""
                        )}
                        <div className="pl-2 text-default-600">
                          storeFile: {k.storeFile ?? "-"} · keyAlias: {k.keyAlias ?? "-"}
                        </div>
                      </div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
