' Task Scheduler wrapper: runs "node ai-limits.mjs all --once" with no console window.
' Register from Git Bash: see README.md, section "ai-limits all --once". Uses node from PATH.
' (ASCII only: wscript reads this file in the system code page.)
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node """ & dir & "\ai-limits.mjs"" all --once", 0, True
