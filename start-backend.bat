@echo off
setlocal
cd /d "%~dp0accessmap\backend"

echo ==> Verificare Java si pornire Backend AccessMap (:8080)...

if not defined JAVA_HOME (
    for /d %%D in ("D:\App\PyCharm*") do (
        if exist "%%~fD\jbr\bin\java.exe" set "JAVA_HOME=%%~fD\jbr"
    )
)
if not defined JAVA_HOME (
    for /d %%D in ("D:\App\CLion*") do (
        if exist "%%~fD\jbr\bin\java.exe" set "JAVA_HOME=%%~fD\jbr"
    )
)
if not defined JAVA_HOME (
    for /d %%D in ("C:\Program Files\Java\*" "C:\Program Files\Eclipse Adoptium\*") do (
        if exist "%%~fD\bin\java.exe" set "JAVA_HOME=%%~fD"
    )
)

if defined JAVA_HOME (
    echo ==> JAVA_HOME = %JAVA_HOME%
) else (
    echo [AVERTISMENT] JAVA_HOME nu este setat manual. Se incearca java din PATH...
)

call mvnw.cmd spring-boot:run
pause
