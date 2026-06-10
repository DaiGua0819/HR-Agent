@echo off
setlocal
set PROJECT_ROOT=C:\Users\Public\Documents\RecruitAgent\project
if not exist "%PROJECT_ROOT%\start_recruit_agent_vm.ps1" (
  echo Project is not ready: %PROJECT_ROOT%
  echo Run 01_prepare_recruit_agent_vm.ps1 first.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\start_recruit_agent_vm.ps1" -PublicWeb
echo.
echo Open http://127.0.0.1:8765/index.html inside the VM.
echo From local machine, open http://192.168.254.102:8765/index.html
pause
