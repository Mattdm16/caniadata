# CAÑAIdata — Análisis y recomendaciones de caña de azúcar con IA local

Web pública (HTML + CSS + jQuery) que consulta datos históricos de producción de caña
de azúcar y genera recomendaciones con **IA local (Ollama)** corriendo en la laptop del
equipo, conectada por localhost o por **túnel** para que cualquier visitante pueda usarla.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La vista (filtros, resultados, chat de recomendación) |
| `styles.css` | Estilos |
| `app.js` | Lógica: carga CSV, estadísticas y consulta a Ollama (AJAX) |
| `datos-demo.js` | Datos de EJEMPLO (respaldo si no hay `datos.csv`) |
| `datos.csv` | Datos actuales (mismo formato que el CSV real) |
| `iniciar-local.bat` | Servidor local en http://localhost:8080 |

## 1. Correr en local (demo sin internet)

1. Instalar Python y Ollama: <https://ollama.com/download>
2. Descargar el modelo:
   ```
   ollama pull llama3.2:3b
   ```
3. Doble clic en `iniciar-local.bat` → abrir <http://localhost:8080>
4. Escribir la pregunta y pulsar **Consultar con IA**.

## 2. Publicar en GitHub Pages (gratis)

1. Crea el repositorio en GitHub (ej. `canaiadata`, Private o Public).
2. Desde esta carpeta:
   ```
   git init -b main
   git add .
   git commit -m "CAÑAIdata: web con IA local"
   git remote add origin https://github.com/TUUSUARIO/canaiadata.git
   git push -u origin main
   ```
   (si GitHub pide identidad la primera vez:
   `git config --global user.name "Tu Nombre"` y
   `git config --global user.email "tu@correo.com"`)
3. En GitHub: **Settings → Pages → Branch: main, carpeta / (root) → Save**.
4. En 1-2 min queda en: `https://TUUSUARIO.github.io/canaiadata/`

## 3. Activar la IA desde tu laptop (modo túnel — cualquiera puede consultar)

**Una sola vez en la laptop con Ollama:**

1. Permitir que Ollama reciba pedidos de la web (CORS):
   ```
   setx OLLAMA_ORIGINS "*"
   ```
   Luego clic derecho en el ícono de Ollama (bandeja) → **Quit**, y volver a abrir Ollama.
2. Descargar `cloudflared` (sin cuenta, gratis):
   <https://github.com/cloudflare/cloudflared/releases> → `cloudflared-windows-amd64.exe`.
3. Con Ollama corriendo, abrir una terminal donde tengas el .exe y ejecutar:
   ```
   .\cloudflared-windows-amd64.exe tunnel --url http://localhost:11434
   ```
4. Copia la URL que imprime, algo como `https://xxxxx.trycloudflare.com`.
   ⚠ Esa URL **cada vez que reinicies el túnel** — vuelve al paso 3 y copia la nueva.

**En la página (cualquier visitante):**

1. Botón **⚙ Configurar IA** (junto al de enviar) → pegar la URL del túnel → **Guardar**.
2. **Probar conexión** debe decir `Conexión OK. Modelos disponibles: llama3.2:3b…`
3. **Consultar con IA**. ✅

Nota: la laptop con Ollama debe estar **encendida y con el túnel activo** mientras alguien
consulte. En la misma laptop puedes dejar `http://localhost:11434` (funciona sin túnel).

## 4. Datos reales (CONADESUCA)

Reemplaza `datos.csv` respetando el encabezado exacto:

```
ingenio,zafra,rendimiento_t_ha,superficie_ha,produccion_t
Atencingo,2024-2025,108.11,20400,241668
...
```

- Una fila por ingenio y zafra; punto decimal, sin comillas.
- Si la página se abre como archivo (`file://`) usa los datos de ejemplo; sírvela con
  `iniciar-local.bat` o GitHub Pages para que lea el CSV.

## 5. Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| "No pude conectar con la IA" | Ollama no corre o el túnel se apagó. Reabre Ollama / repite el túnel y pega la URL nueva en ⚙ |
| "Sin conexión" al Probar | Falta `OLLAMA_ORIGINS` — ejecuta el `setx`, cierra y reabre Ollama |
| "Ollama no tiene el modelo" | `ollama pull llama3.2:3b` (o cambia el nombre en ⚙) |
| El navegador pide permiso para "acceder a dispositivos locales" | Es normal en modo localhost → **Permitir** |
| Primer clic tarda ~30 s en la web | El hosting gratis duerme la página; al entrar alguien se despierta |
