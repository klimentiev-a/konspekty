@echo off
chcp 65001 >nul
echo Установка (один раз). Нужен Python 3.10 или 3.11: https://www.python.org/downloads/
python -m venv venv || goto :err
call venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install coqui-tts torch torchaudio || goto :err
echo.
echo Готово. Дальше запускай run.bat
pause
exit /b
:err
echo Ошибка установки. Проверь, что установлен Python 3.10/3.11 и есть интернет.
pause
