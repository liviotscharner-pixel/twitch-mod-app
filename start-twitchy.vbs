' Twitchy launcher — starts Electron with project as app path (no console window)
Option Explicit
Dim sh, project, electron
Set sh = CreateObject("WScript.Shell")
project = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
electron = project & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = project
If CreateObject("Scripting.FileSystemObject").FileExists(electron) Then
  sh.Run """" & electron & """ .", 1, False
Else
  ' Fallback: npm start (shows brief console)
  sh.Run "cmd /c npm start", 1, False
End If
