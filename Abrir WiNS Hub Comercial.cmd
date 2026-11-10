@echo off
rem Sobe o WiNS Hub Comercial (janela minimizada) e abre no navegador.
rem Pra desligar, feche a janela "WiNS Hub Comercial" na barra de tarefas.
cd /d "%~dp0"
set DISABLE_TELEMETRY=1
start "WiNS Hub Comercial" /min wins-hub.exe -web -addr 127.0.0.1:8080 -c 4 -data-folder webdata
timeout /t 3 /nobreak >nul
start "" http://localhost:8080
