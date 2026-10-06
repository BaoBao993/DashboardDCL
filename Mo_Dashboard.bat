@echo off
chcp 65001 > nul
cd /d "%~dp0"

:: Kiem tra neu cong 8000 chua chay thi bat server ngam bang pythonw (khong hien cua so den)
netstat -ano | findstr /R /C:":8000 .*LISTENING" > nul
if errorlevel 1 (
    start "" "C:\Users\Administrator\AppData\Local\Programs\Python\Python314\pythonw.exe" -m http.server 8000
    timeout /t 1 /nobreak > nul
)

:: Mo thang trinh duyet vao Dashboard
start "" "http://localhost:8000"
exit
