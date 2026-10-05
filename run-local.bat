@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/2] 데이터 수집 중...
python collect.py
echo [2/2] http://localhost:5190 에서 대시보드를 엽니다. (종료: Ctrl+C)
start "" http://localhost:5190
python -m http.server 5190 --directory docs
