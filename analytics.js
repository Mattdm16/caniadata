/* CAÑAIdata analytics: cálculos deterministas y reglas de alcance.
   Compartido por navegador y Node para poder probar cifras sin llamar a la IA. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CanaAnalytics = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZAFRA_EN_CURSO = '2025-2026';
  var INDICADORES = {
    rendimiento: { campo: 'rendimiento', unidad: 't/ha', nombre: 'rendimiento de campo', promedio: 'Rendimiento medio ponderado por superficie' },
    superficie: { campo: 'superficie', unidad: 'ha', nombre: 'superficie cosechada', promedio: 'Superficie media por registro' },
    produccion: { campo: 'produccion', unidad: 't', nombre: 'producción de azúcar', promedio: 'Producción acumulada en el periodo' }
  };

  function parseCsv(texto) {
    if (typeof texto !== 'string' || !texto.trim()) throw new Error('El CSV está vacío.');
    var rows = [], row = [], cell = '', quoted = false;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (quoted) {
        if (ch === '"' && texto[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell.length === 0) {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n' || ch === '\r') {
        row.push(cell); cell = '';
        if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
        row = [];
        if (ch === '\r' && texto[i + 1] === '\n') i++;
      } else {
        cell += ch;
      }
    }
    if (quoted) throw new Error('El CSV contiene un campo entrecomillado sin cerrar.');
    row.push(cell);
    if (row.some(function (v) { return v.trim() !== ''; })) rows.push(row);
    if (rows.length < 2) throw new Error('El CSV no contiene registros.');

    var headers = rows.shift().map(function (h) { return h.replace(/^\uFEFF/, '').trim().toLowerCase(); });
    var required = ['ingenio', 'zafra', 'rendimiento_t_ha', 'superficie_ha', 'produccion_t'];
    var idx = {};
    required.forEach(function (name) {
      idx[name] = headers.indexOf(name);
      if (idx[name] < 0) throw new Error('Falta la columna requerida: ' + name);
    });

    function numberAt(cells, index) {
      var raw = (cells[index] || '').trim();
      if (!raw) return null;
      var n = Number(raw.replace(/,/g, ''));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }

    return rows.reduce(function (out, cells, rowIndex) {
      if (cells.length < headers.length) {
        throw new Error('La fila ' + (rowIndex + 2) + ' tiene menos campos que el encabezado.');
      }
      var ingenio = (cells[idx.ingenio] || '').trim();
      var zafra = (cells[idx.zafra] || '').trim();
      if (!ingenio || !zafra) return out;
      out.push({
        ingenio: ingenio,
        zafra: zafra,
        rendimiento: numberAt(cells, idx.rendimiento_t_ha),
        superficie: numberAt(cells, idx.superficie_ha),
        produccion: numberAt(cells, idx.produccion_t)
      });
      return out;
    }, []);
  }

  function valorValido(row, indicador) {
    var value = row[indicador.campo];
    if (!Number.isFinite(value) || value <= 0) return false;
    if (indicador.campo === 'rendimiento' && (!Number.isFinite(row.superficie) || row.superficie <= 0)) return false;
    // En la fuente, producción=0 en la zafra abierta significa aún sin reporte,
    // no que el ingenio haya producido exactamente cero toneladas.
    if (indicador.campo === 'produccion' && row.zafra === ZAFRA_EN_CURSO && value === 0) return false;
    return true;
  }

  function medir(rows, indicador) {
    if (indicador === 'rendimiento') {
      var area = rows.reduce(function (s, r) { return s + r.superficie; }, 0);
      return area > 0 ? rows.reduce(function (s, r) { return s + r.rendimiento * r.superficie; }, 0) / area : null;
    }
    if (indicador === 'superficie') {
      return rows.length ? rows.reduce(function (s, r) { return s + r.superficie; }, 0) / rows.length : null;
    }
    if (indicador === 'produccion') {
      return rows.length ? rows.reduce(function (s, r) { return s + r.produccion; }, 0) : null;
    }
    return null;
  }

  function analizar(data, filters, zafraEnCurso) {
    filters = filters || {};
    var key = filters.ind || 'rendimiento';
    var indicador = INDICADORES[key];
    if (!indicador) throw new Error('Indicador de análisis desconocido: ' + key);
    var selected = (data || []).filter(function (r) {
      return (filters.ing === 'todos' || !filters.ing || r.ingenio === filters.ing) &&
        (filters.zaf === 'todas' || !filters.zaf || r.zafra === filters.zaf);
    });
    var valid = selected.filter(function (r) { return valorValido(r, indicador); });
    var overall = medir(valid, key);
    var groups = Object.create(null);
    valid.forEach(function (r) {
      if (!groups[r.ingenio]) groups[r.ingenio] = [];
      groups[r.ingenio].push(r);
    });
    var ranking = Object.keys(groups).map(function (name) {
      var group = groups[name];
      return {
        ingenio: name,
        valor: medir(group, key),
        comparacionPct: key === 'rendimiento' && overall > 0 ? (medir(group, key) / overall - 1) * 100 : null,
        registros: group.length,
        zafras: group.map(function (r) { return r.zafra; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(),
        area: group.reduce(function (s, r) { return s + (r.superficie || 0); }, 0),
        parcial: group.some(function (r) { return r.zafra === (zafraEnCurso || ZAFRA_EN_CURSO); })
      };
    }).filter(function (g) { return Number.isFinite(g.valor); }).sort(function (a, b) {
      return b.valor - a.valor || a.ingenio.localeCompare(b.ingenio, 'es');
    });
    var best = valid.reduce(function (current, r) {
      var v = r[indicador.campo];
      return !current || v > current.valor ? { ingenio: r.ingenio, zafra: r.zafra, valor: v } : current;
    }, null);
    var years = valid.map(function (r) { return r.zafra; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    var partialUsed = valid.some(function (r) { return r.zafra === (zafraEnCurso || ZAFRA_EN_CURSO); });
    var selectedPartial = selected.some(function (r) { return r.zafra === (zafraEnCurso || ZAFRA_EN_CURSO); });
    return {
      indicador: key,
      nombreIndicador: indicador.nombre,
      unidad: indicador.unidad,
      promedioLabel: indicador.promedio,
      promedio: overall,
      ingenios: Object.keys(groups).length,
      registros: valid.length,
      registrosSeleccionados: selected.length,
      registrosSinDato: selected.length - valid.length,
      mejor: best,
      ranking: ranking.slice(0, 3),
      zafras: years,
      periodo: years.length > 1 ? years[0] + ' a ' + years[years.length - 1] : (years[0] || '—'),
      parcialUsado: partialUsed,
      zafraParcialSeleccionadaSinDato: selectedPartial && !partialUsed,
      tieneDatos: valid.length > 0,
      metodo: key === 'rendimiento'
        ? 'Promedio del conjunto filtrado ponderado por superficie: suma(rendimiento × hectáreas) ÷ suma(hectáreas). Ranking por ingenio con el mismo método.'
        : key === 'superficie'
          ? 'Promedio simple de hectáreas por registro ingenio-zafra; ranking por promedio de cada ingenio.'
          : 'Producción acumulada de los registros con dato; los ceros de la zafra en curso se excluyen como dato aún no reportado.'
    };
  }

  function normalizarTexto(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿¡]/g, '').replace(/\s+/g, ' ').trim();
  }

  var ALCANCE = /\b(cana|azucar|ingenio|ingenios|zafra|zafras|rendimiento|superficie|produccion|cosecha|campo|historico|promedio|tendencia|comparar|comparacion|variacion|hectarea|hectareas|tonelada|toneladas|molida|karbe|eficiencia|fabrica|cultivo|agroindustrial|registro|registros|manejo|practica|practicas|agronomico|agronomia|suelo|variedad|fertilizacion|riego|t\/ha)\b/;
  var SEGUIMIENTO_CONTEXTUAL = /^(y\s+)?(por que|porque|como|cual|cuanto|que|explica|amplia|detalla|profundiza|muestrame|dame|entonces|eso|ese|esa|esos|esas|lo anterior|el primero|el segundo|el tercero|la diferencia|en comparacion)\b/;
  var FUERA_DE_PRODUCTO = /\b(futbol|politica|elecciones|pelicula|receta|programar|codigo|videojuego|capital de|poema|musica)\b/;
  var DATO_NO_CARGADO = /\b(costos?|gastos?|precios?|presupuesto|inversion|deuda)\b/;
  var INYECCION = /\b(ignora|ignorar|olvida|desobedece|revela|muestra|ignore|forget|disobey|reveal)\b.{0,60}\b(instrucciones|reglas|prompt|sistema|system|instructions|rules)\b|\b(actua como|pretende ser|finge que eres|act as|pretend to be)\b/;

  function contieneFrase(texto, frase) {
    var escaped = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(texto);
  }

  function clasificarPregunta(question, options) {
    options = options || {};
    var q = normalizarTexto(question);
    if (!q) return { ok: false, tipo: 'vacia' };
    if (q.length > 400) return { ok: false, tipo: 'larga' };
    if (INYECCION.test(q) || FUERA_DE_PRODUCTO.test(q)) return { ok: false, tipo: 'fuera-de-alcance' };
    if (DATO_NO_CARGADO.test(q)) return { ok: false, tipo: 'dato-no-cargado' };
    var nombres = (options.ingenios || []).map(normalizarTexto).filter(function (n) { return n.length >= 4; });
    var citaIngenio = nombres.some(function (name) { return contieneFrase(q, name); });
    if (ALCANCE.test(q) || citaIngenio || (options.seguimiento && SEGUIMIENTO_CONTEXTUAL.test(q))) {
      return { ok: true, tipo: 'caña' };
    }
    return { ok: false, tipo: 'fuera-de-alcance' };
  }

  var REFUSAS_CONTRADICTORIAS = /\b(no puedo ayudarte|no puedo responder|fuera de alcance|solo puedo|no estoy capacitado|no estoy en condiciones|i cannot|i can't|outside my scope|outside the scope|not able to answer)\b/i;
  var AFIRMACIONES_CAUSALES = /\b(se debe a|puede deberse a|podria deberse a|debido a|causado por|causa[n]?|provoca[n]?|gracias a|atribuible a|explica[n]? el rendimiento|factor determinante)\b/i;

  function validarOrientacionIA(text, ingenios) {
    var value = String(text || '').trim();
    if (!value) return { ok: false, motivo: 'vacía' };
    if (REFUSAS_CONTRADICTORIAS.test(value)) return { ok: false, motivo: 'rechazo contradictorio' };
    if (/\d|%/.test(value)) return { ok: false, motivo: 'incluye cifras o porcentajes no autorizados' };
    if (AFIRMACIONES_CAUSALES.test(normalizarTexto(value))) return { ok: false, motivo: 'afirma causalidad no demostrada por los datos' };
    var clean = normalizarTexto(value);
    var found = (ingenios || []).some(function (name) {
      var n = normalizarTexto(name);
      return n.length >= 5 && contieneFrase(clean, n);
    });
    if (found) return { ok: false, motivo: 'menciona un ingenio como afirmación de la IA' };
    return { ok: true, texto: value };
  }

  /* ---------- Interpretación de la pregunta (sin adivinar) ---------- */

  var PATRON_INDICADOR = {
    rendimiento: [/\brendimiento\b/, /t\s*\/\s*ha/, /toneladas?\s+por\s+hectarea/, /por\s+hectarea/, /\brinde\b/, /\brinden\b/, /productividad del campo/],
    superficie: [/\bsuperficie\b/, /\bhectareas?\b/, /\bha\b/, /extension/, /area\s+(cosechada|cultivada|sembrada|de cultivo)/, /cuantas?\s+hectareas?/],
    produccion: [/\bproduccion\b/, /azucar\s+total/, /cuant[oa]\s+azucar/, /\bprodujo\b/, /\bprodujeron\b/, /\bproducido\b/, /\bmolienda\b/, /toneladas?(?!\s+por\s+hectarea)/]
  };

  // Devuelve 'rendimiento' | 'superficie' | 'produccion', o null si la
  // pregunta no señala un único indicador (caso ambiguo: hay que preguntar).
  function detectarIndicador(question) {
    var q = normalizarTexto(question);
    if (!q) return null;
    var sinTHa = q.replace(/t\s*\/\s*ha/g, ' ').replace(/toneladas?\s+por\s+hectarea/g, ' ').replace(/por\s+hectarea/g, ' ');
    var hits = [];
    if (PATRON_INDICADOR.rendimiento.some(function (re) { return re.test(q); })) hits.push('rendimiento');
    if (PATRON_INDICADOR.superficie.some(function (re) { return re.test(sinTHa); })) hits.push('superficie');
    if (PATRON_INDICADOR.produccion.some(function (re) { return re.test(sinTHa); })) hits.push('produccion');
    return hits.length === 1 ? hits[0] : null;
  }

  // Extrae ingenios y zafras nombrados literalmente en el texto.
  // Solo acepta zafras completas ("2024-2025", "2024/25"); un año suelto
  // como "2024" es ambiguo (2023-2024 o 2024-2025) y no se interpreta.
  function extraerMenciones(question, ingenios, zafras) {
    var q = normalizarTexto(question);
    var out = { ingenios: [], zafras: [] };
    (ingenios || []).forEach(function (name) {
      var n = normalizarTexto(name);
      if (n.length >= 4 && contieneFrase(q, n) && out.ingenios.indexOf(name) < 0) out.ingenios.push(name);
    });
    var rangos = q.match(/\b((?:19|20)\d{2})\s*[-–\/]\s*(\d{2}|\d{4})\b/g) || [];
    rangos.forEach(function (m) {
      var partes = m.split(/[-–\/]/).map(function (s) { return s.trim(); });
      var fin = partes[1].length === 2 ? partes[0].slice(0, 2) + partes[1] : partes[1];
      var zafra = partes[0] + '-' + fin;
      if ((zafras || []).indexOf(zafra) >= 0 && out.zafras.indexOf(zafra) < 0) out.zafras.push(zafra);
    });
    return out;
  }

  var MARCA_TODOS_INGENIOS = /\b(todos los ingenios|cada ingenio|en general|a nivel nacional|comparar|comparacion|entre ingenios|entre los ingenios)\b/;
  var MARCA_TODAS_ZAFRAS = /\b(todas las zafras|historico|historica|evolucion|tendencia|en general|a nivel nacional)\b/;

  // Cruza filtros manuales con lo mencionado en la pregunta.
  // Devuelve { ing, zaf, conflictos } donde cada conflicto es
  // { tipo: 'ing'|'zaf', actual, propuesto } ('todos'/'todas' = ampliar).
  // Sin conflicto no se adivina nada: lo más específico gana en silencio.
  function resolverFiltros(filtro, menciones, pregunta) {
    var q = normalizarTexto(pregunta);
    var resultado = { ing: filtro.ing, zaf: filtro.zaf, conflictos: [] };
    var mIng = (menciones && menciones.ingenios) || [];
    var mZaf = (menciones && menciones.zafras) || [];
    var conflictoIng = null;
    var conflictoZaf = null;

    if (mIng.length === 1 && filtro.ing !== 'todos' && filtro.ing !== mIng[0]) {
      conflictoIng = { tipo: 'ing', actual: filtro.ing, propuesto: mIng[0] };
    } else if (mIng.length > 1 && filtro.ing !== 'todos') {
      conflictoIng = { tipo: 'ing', actual: filtro.ing, propuesto: 'todos' };
    } else if (mIng.length === 1 && filtro.ing === 'todos') {
      resultado.ing = mIng[0];
    } else if (!mIng.length && filtro.ing !== 'todos' && MARCA_TODOS_INGENIOS.test(q)) {
      conflictoIng = { tipo: 'ing', actual: filtro.ing, propuesto: 'todos' };
    }

    if (mZaf.length === 1 && filtro.zaf !== 'todas' && filtro.zaf !== mZaf[0]) {
      conflictoZaf = { tipo: 'zaf', actual: filtro.zaf, propuesto: mZaf[0] };
    } else if (mZaf.length > 1 && filtro.zaf !== 'todas') {
      conflictoZaf = { tipo: 'zaf', actual: filtro.zaf, propuesto: 'todas' };
    } else if (mZaf.length === 1 && filtro.zaf === 'todas') {
      resultado.zaf = mZaf[0];
    } else if (!mZaf.length && filtro.zaf !== 'todas' && MARCA_TODAS_ZAFRAS.test(q)) {
      conflictoZaf = { tipo: 'zaf', actual: filtro.zaf, propuesto: 'todas' };
    }

    if (conflictoIng) resultado.conflictos.push(conflictoIng);
    if (conflictoZaf) resultado.conflictos.push(conflictoZaf);
    return resultado;
  }

  // ¿La pregunta pide orientación (consejo, causas, acciones)?
  // Si solo pide cifras o comparaciones, la respuesta son los datos.
  var PIDE_ORIENTACION = /\b(recomienda|recomendacion|sugier|sugerencia|consejo|aconseja|deberia|deberian|conviene|que hacer|que le conviene|por que|causa|mejorar|practica|practicas|que harias|acciones|orientacion|evaluable|replicable|que puedo hacer)\b/;
  function necesitaRecomendacion(question) {
    return PIDE_ORIENTACION.test(normalizarTexto(question));
  }

  return {
    ZAFRA_EN_CURSO: ZAFRA_EN_CURSO,
    INDICADORES: INDICADORES,
    parseCsv: parseCsv,
    analizar: analizar,
    clasificarPregunta: clasificarPregunta,
    validarOrientacionIA: validarOrientacionIA,
    detectarIndicador: detectarIndicador,
    extraerMenciones: extraerMenciones,
    resolverFiltros: resolverFiltros,
    necesitaRecomendacion: necesitaRecomendacion
  };
}));
