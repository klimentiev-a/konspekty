@echo off
chcp 65001 >nul
call venv\Scripts\activate.bat
set COQUI_TOS_AGREED=1
python app.py
pause
