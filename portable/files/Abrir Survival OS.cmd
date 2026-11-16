@echo off
rem Survival OS portable (Windows): abre la aplicacion sin ventana de consola.
rem Si algo falla aparece un aviso; los detalles quedan en data\logs\.
if not exist "%~dp0runtime\win-x64\node.exe" (
  echo No se encuentra runtime\win-x64\node.exe
  echo Copia la carpeta completa de Survival OS y vuelve a intentarlo.
  pause
  exit /b 1
)
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0app\portable\win\survival-os.vbs"
