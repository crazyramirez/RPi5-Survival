' Survival OS portable (Windows): arranca el lanzador Node sin ventana de consola.
' Ubicacion: <raiz>\app\portable\win\survival-os.vbs
Dim fso, sh, root
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))))
sh.CurrentDirectory = root
sh.Run """" & root & "\runtime\win-x64\node.exe"" """ & root & "\app\portable\launcher.mjs""", 0, False
