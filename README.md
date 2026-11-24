# CAÑAIdata — Análisis y recomendaciones de caña de azúcar con IA local

Web estática (HTML + CSS + jQuery) que consulta datos históricos de producción de caña
de azúcar. Las cifras y rankings se calculan determinísticamente en el navegador; Ollama
solo propone orientación cualitativa. Para la demo, la página debe abrirse en la misma
laptop donde corre Ollama. No expongas el puerto de Ollama directamente a internet: la API
local no incorpora autenticación.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La vista (filtros, resultados, chat de recomendación) |
| `styles.css` | Estilos |
| `app.js` | Interfaz, actas, estados y conexión con Ollama |
| `analytics.js` | Parser CSV, métricas determinísticas y control de alcance, compartidos con las pruebas |
| `tests/` | Pruebas de cálculos, clasificación, respuestas seguras y CSV oficial |
| `datos-demo.js` | Datos de ejemplo (respaldo no oficial si falla el CSV) |
| `datos.csv` | Datos actuales (mismo formato que el CSV real) |
| `iniciar-local.bat` | Servidor local en http://localhost:8080 |

## 1. Correr en local

El servidor web y Ollama corren localmente. La página carga jQuery y la tipografía desde CDN, así que necesita internet mientras esos recursos sigan externos.

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

## 3. Usar Ollama desde la web pública en la misma laptop

La página pública puede llamar a `http://localhost:11434` únicamente cuando se abre en el
mismo equipo donde Ollama está corriendo. `localhost` siempre se refiere a la computadora
que usa el navegador. En otra computadora sin Ollama, la interfaz y los datos cargan, pero
la IA local no estará disponible.

En Windows, permite solo los orígenes que usas (sin comodín):

```
setx OLLAMA_ORIGINS "http://localhost:*,https://mattdm16.github.io"
```

Cierra Ollama desde el icono de la bandeja y vuelve a abrirlo para que lea el cambio. En la
web: **Ajustes de la IA → Probar conexión**. La dirección por defecto es
`http://localhost:11434`.

**Seguridad:** `OLLAMA_ORIGINS` es una regla CORS, no autenticación. No uses `*`, no expongas
el puerto `11434` directamente a internet ni publiques un túnel abierto hacia Ollama. Para
acceso remoto desde otra PC se requiere una capa privada/autenticada, que no forma parte de
esta demo.

## 4. Datos reales (CONADESUCA)

`datos.csv` ya está generado con datos oficiales: **691 filas, 58 ingenios,
14 zafras (2012-2013 a 2025-2026)**, integradas desde los resúmenes INFOCANA
guardados en `datos-raw/` (14 CSV, licencia CC-BY 4.0, datos.gob.mx).

Formato (una fila por ingenio y zafra):

```
ingenio,zafra,rendimiento_t_ha,superficie_ha,produccion_t
Atencingo,2024-2025,100.22,17144.3,219154.4
```

- `rendimiento_t_ha` = caña molida bruta / superficie cosechada al cierre de la zafra.
- `produccion_t` = azúcar total al cierre de la zafra.
- En INFOCANA las cifras semanales son acumuladas; el integrador toma el valor máximo de la zafra, no la suma.
- Los nombres de ingenios se normalizaron; la fuente puede usar razones sociales distintas para el mismo molino.
- El rendimiento promedio del conjunto filtrado se pondera por superficie: `suma(rendimiento × hectáreas) / suma(hectáreas)`. El ranking por ingenio usa el mismo método y muestra su cobertura de zafras.
- El mayor registro individual se presenta separado del promedio por ingenio e incluye su zafra; no deben confundirse ambas medidas.
- La zafra **2025-2026 está en curso**. La interfaz solo la advierte cuando sus registros válidos entran en el cálculo. Ceros de producción en esa zafra se tratan como aún no reportados, no como producción real igual a cero.
- `datos-raw/` también incluye costos de producción, balances mensuales de azúcar y sustentabilidad para indicadores futuros, pero esos temas no se consultan todavía en la app.

Para regenerar `datos.csv` (zafra nueva o datos actualizados):

```
python build-datos.py
```

El script imprime una validación por zafra (ingenios, superficie, azúcar).
Pruebas locales de cálculos, CSV, reglas de alcance y cifras integradas:

```
node tests/analytics.test.js
node tests/real-data.test.js
```

## 5. Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| "No pude conectar con la IA" | Abre Ollama en la misma laptop y comprueba que Ajustes de la IA use `http://localhost:11434`. |
| "Sin comunicación" al Probar | Define `OLLAMA_ORIGINS` con el origen exacto (sin `*`), cierra y vuelve a abrir Ollama. Recuerda que CORS no es autenticación. |
| "Modelo no disponible" | Ejecuta `ollama list`; si falta, usa `ollama pull llama3.2:3b` y vuelve a probar. |
| El navegador pide permiso de red local | Es normal si la web HTTPS llama al Ollama de esta misma laptop; permite solo en tu equipo de confianza. |
| Abro la web en otra PC y no hay IA | Es lo esperado: en esa PC `localhost` significa esa misma PC. Ollama debe correr en el equipo que usa el navegador o configurarse una solución privada autenticada. |
