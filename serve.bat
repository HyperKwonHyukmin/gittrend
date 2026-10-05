@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo http://localhost:5190 (수집 없이 화면만 열기, 종료: Ctrl+C)
start "" http://localhost:5190
python -m http.server 5190 --directory docs
