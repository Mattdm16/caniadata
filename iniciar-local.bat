@echo off
REM CAÑAData (maqueta) — servidor local en http://localhost:8080
cd /d "%~dp0"
echo ============================================
echo  CANAData — sirviendo en http://localhost:8080
echo  Cierra esta ventana para detener el servidor
echo ============================================
start "" "http://localhost:8080"
py -3 -m http.server 8080 2>nul || python -m http.server 8080 2>nul || (
  echo.
  echo [ERROR] No se encontro Python.
  echo Opcion rapida: abre el archivo index.html directamente en el navegador.
  pause
)
