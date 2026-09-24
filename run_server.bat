@echo off
rem Starts the LinkedIn AI Analyzer backend on its own port (8765) so other
rem local projects using port 8000 can't answer the extension's requests.
cd /d "%~dp0"
".venv\Scripts\python.exe" -m uvicorn main:app --reload --port 8765
