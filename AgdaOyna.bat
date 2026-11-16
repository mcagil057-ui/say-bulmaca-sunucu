@echo off
chcp 65001 >nul
title Sayi Bulmaca - ag sunucusu
cd /d "%~dp0"

rem Node: once hemcan'in kendi kopyasi, yoksa sistemdeki
set "NODE=%~dp0..\.tools\node\node.exe"
if not exist "%NODE%" set "NODE=node"

echo.
echo  Sayi Bulmaca ayni Wi-Fi'daki herkes icin aciliyor.
echo  Telefonlarda asagidaki "Ayni Wi-Fi'dakiler" adresini acin.
echo  Kapatmak icin bu pencereyi kapatin.
echo.
rem Tarayici, sunucu acildiktan sonra acilsin
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"
"%NODE%" server.js
pause

