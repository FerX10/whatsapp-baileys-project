@echo off
REM ============================================
REM Script para ejecutar migración en Railway
REM desde Windows (sin PostgreSQL instalado)
REM ============================================

echo.
echo ============================================
echo   MIGRACIÓN RAILWAY - WhatsApp Baileys
echo ============================================
echo.

REM Verificar si psql está instalado
where psql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] PostgreSQL no esta instalado en tu sistema
    echo.
    echo Opciones:
    echo 1. Instalar PostgreSQL desde: https://www.postgresql.org/download/windows/
    echo 2. Usar Railway CLI (mas facil):
    echo    npm install -g @railway/cli
    echo    railway login
    echo    railway link
    echo    railway run psql $DATABASE_URL -f migrations/railway_deployment_fix.sql
    echo 3. Copiar y pegar el SQL manualmente en Railway Dashboard
    echo.
    pause
    exit /b 1
)

REM Solicitar DATABASE_URL
echo Por favor, proporciona la DATABASE_URL de Railway
echo.
echo Donde encontrarla:
echo 1. Ve a Railway Dashboard
echo 2. Click en PostgreSQL ^> Variables
echo 3. Copia el valor de DATABASE_URL
echo.
echo Ejemplo: postgresql://postgres:PASSWORD@shuttle.proxy.rlwy.net:41150/railway
echo.
set /p DATABASE_URL="Pega aqui la DATABASE_URL: "

if "%DATABASE_URL%"=="" (
    echo [ERROR] DATABASE_URL no puede estar vacia
    pause
    exit /b 1
)

echo.
echo ============================================
echo   EJECUTANDO MIGRACION...
echo ============================================
echo.

REM Ejecutar migración
psql "%DATABASE_URL%" -f railway_deployment_fix.sql

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo   MIGRACION COMPLETADA EXITOSAMENTE!
    echo ============================================
    echo.
    echo Proximos pasos:
    echo 1. Despliega el codigo actualizado en Railway
    echo 2. Escanea el QR de WhatsApp nuevamente
    echo 3. La sesion ahora persistira entre reinicios
    echo.
) else (
    echo.
    echo ============================================
    echo   ERROR EN LA MIGRACION
    echo ============================================
    echo.
    echo Revisa el error anterior y:
    echo 1. Verifica que la DATABASE_URL sea correcta
    echo 2. Verifica que tengas conexion a internet
    echo 3. Intenta copiar y pegar el SQL manualmente en Railway
    echo.
)

pause
