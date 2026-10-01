@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 24.19 desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)
if not exist node_modules\exceljs\package.json (
  call npm.cmd ci --ignore-scripts
  if errorlevel 1 (
    echo No se pudieron instalar las dependencias. Revisa la conexion y la version de Node.
    pause
    exit /b 1
  )
)
echo Abre http://localhost:3000. Mantiene esta ventana abierta mientras usas la web.
node --env-file-if-exists=.env server.mjs
pause
