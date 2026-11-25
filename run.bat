@echo off
title EduPulse Smart OS - Python Flask + SQLite3 Server
cd /d "%~dp0"
py -m pip install -q -r requirements.txt || python -m pip install -q -r requirements.txt
start "" "http://localhost:8000"
py server.py || python server.py
pause
