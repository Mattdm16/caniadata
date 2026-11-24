/* CAÑAIdata — capa de interfaz. Los cálculos y controles de alcance están en
   analytics.js y se prueban con Node; Ollama solo redacta orientación cualitativa. */
$(function () {
  'use strict';

  var AI_URL_DEFAULT = 'http://localhost:11434';
  var MODELO_DEFAULT = 'llama3.2:3b';
  var MAX_Q = 400;
  var MAX_SEG = 3;
  var A = window.CanaAnalytics;
  var datos = [];
  var fuenteDatos = '';
  var stats = null;
  var memoryPrefs = Object.create(null);
  var actas = [];
  var actaSeq = 0;
  var trabajando = false;
  var yaAnalizo = false;

  function esc(value) { return $('<div>').text(String(value == null ? '' : value)).html(); }
  function fmt(value) {
    return Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function unique(arr, field) {
    var values = [];
    arr.forEach(function (item) { if (values.indexOf(item[field]) < 0) values.push(item[field]); });
    return values;
  }
  function fechaHora() {
    return new Intl.DateTimeFormat('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date());
  }
  function readPreference(key, fallback) {
    try { return localStorage.getItem(key) || memoryPrefs[key] || fallback; }
    catch (_) { return memoryPrefs[key] || fallback; }
  }
  function writePreference(key, value) {
    memoryPrefs[key] = value;
    try { localStorage.setItem(key, value); return true; }
    catch (_) { return false; }
  }
  function aiUrl() { return String(readPreference('canai_ia_url', AI_URL_DEFAULT)).trim().replace(/\/+$/, ''); }
  function aiModel() { return String(readPreference('canai_ia_modelo', MODELO_DEFAULT)).trim(); }
  function modeloValido(value) { return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value); }

  /* ---------- Carga y respaldo de datos ---------- */
  function updateDataBadge() {
    var official = fuenteDatos === 'csv';
    $('#dataBadge').text(official ? 'Datos: datos.csv · CONADESUCA' : 'Datos de ejemplo · no oficiales');
    $('#footSource').text(official
      ? 'Fuente: CONADESUCA vía datos.gob.mx (CC-BY 4.0)'
      : 'Datos de demostración — no representan cifras oficiales');
  }

  function activarDemo(reason) {
    datos = (window.DATOS_DEMO || []).slice();
    fuenteDatos = 'demo';
    updateDataBadge();
    llenarFiltros();
    $('#composerHint').text(reason || 'Se cargaron datos de ejemplo; no representan cifras oficiales.');
    sondearIA();
  }

  function cargarDatos() {
    if (!A) {
      $('#dataBadge').text('Error: módulo de análisis no disponible');
      $('#consultBtn').prop('disabled', true);
      return;
    }
    if (location.protocol === 'file:') {
      activarDemo('Abra el proyecto con iniciar-local.bat para cargar el CSV oficial.');
      return;
    }
    $.ajax({ url: './datos.csv', dataType: 'text', timeout: 10000, cache: false })
      .done(function (text) {
        try {
          var parsed = A.parseCsv(text);
          if (!parsed.length) throw new Error('datos.csv no contiene filas utilizables.');
          var validation = A.analizar(parsed, { ing: 'todos', zaf: 'todas', ind: 'rendimiento' }, A.ZAFRA_EN_CURSO);
          if (!validation.tieneDatos) throw new Error('datos.csv no contiene cifras válidas de rendimiento.');
          datos = parsed;
          fuenteDatos = 'csv';
          updateDataBadge();
          llenarFiltros();
          $('#composerHint').text('La IA propone orientación; las cifras y rankings se calculan directamente desde el CSV.');
          sondearIA();
        } catch (error) {
          activarDemo('No se pudo interpretar datos.csv (' + error.message + '). Se usan datos de ejemplo, no oficiales.');
        }
      })
      .fail(function () {
        activarDemo('No se pudo cargar datos.csv. Se usan datos de ejemplo, no oficiales.');
      });
  }

  function zafraCompletaRecomendada() {
    var years = unique(datos, 'zafra').sort().reverse();
    var completos = years.filter(function (z) { return z !== A.ZAFRA_EN_CURSO; });
    return completos[0] || years[0] || 'todas';
  }

  function llenarFiltros() {
    var $ingenio = $('#ingenio').empty().append($('<option>').val('todos').text('Todos los ingenios'));
    unique(datos, 'ingenio').sort(function (a, b) { return a.localeCompare(b, 'es'); }).forEach(function (name) {
      $ingenio.append($('<option>').val(name).text(name));
    });
    var $zafra = $('#zafra').empty().append($('<option>').val('todas').text('Todas las zafras'));
    unique(datos, 'zafra').sort().reverse().forEach(function (year) {
      $zafra.append($('<option>').val(year).text(year));
    });
    $('#ingenio').val('todos');
    $('#zafra').val(zafraCompletaRecomendada());
    $('#indicador').val('rendimiento');
    $('#cfgModelo').val(aiModel());
    $('#cfgUrl').val(aiUrl());
    $('#footModelo').text(aiModel());
    limpiarExpediente();
  }

  function filtrosActuales() {
    return {
      ing: $('#ingenio').val() || 'todos',
      zaf: $('#zafra').val() || 'todas',
      ind: $('#indicador').val() || 'rendimiento'
    };
  }

  function textoFiltros() {
    return $('#ingenio option:selected').text() + ' · ' +
      $('#zafra option:selected').text() + ' · ' +
      $('#indicador option:selected').text();
  }

  function actualizarExpediente(result) {
    stats = result;
    if (!result || !result.tieneDatos) {
      limpiarExpediente();
      if (result) {
        $('#baseDatos').text('0 registros con dato para el indicador seleccionado.');
      }
      return;
    }
    var ind = A.INDICADORES[result.indicador];
    $('#statIngenios').text(result.ingenios);
    $('#statPromedioLbl').text(result.promedioLabel);
    $('#statPromedio').text(fmt(result.promedio) + ' ' + result.unidad);
    $('#statMejorLbl').text(result.mejor
      ? 'Mayor registro · ' + result.mejor.ingenio
      : 'Mayor registro individual');
    $('#statMejor').text(result.mejor
      ? fmt(result.mejor.valor) + ' ' + result.unidad + ' · ' + result.mejor.zafra
      : 'Sin dato');
    $('#statPeriodo').text(result.periodo);

    var base = result.registros + ' registros válidos de ' + result.registrosSeleccionados +
      ' seleccionados · ' + textoFiltros();
    if (result.parcialUsado) base += ' · Incluye datos parciales de 2025-2026.';
    else if (result.zafraParcialSeleccionadaSinDato) base += ' · La zafra 2025-2026 está seleccionada, pero no hay producción reportada para este indicador.';
    if (result.registrosSinDato > 0 && result.indicador === 'produccion') {
      base += ' · ' + result.registrosSinDato + ' registros sin producción reportada fueron excluidos.';
    }
    $('#baseDatos').text(base);
    renderRanking(result, ind);
  }

  function limpiarExpediente() {
    $('#statIngenios').text('—');
    $('#statPromedioLbl').text('Promedio ponderado');
    $('#statPromedio').text('—');
    $('#statMejorLbl').text('Mayor registro individual');
    $('#statMejor').text('—');
    $('#statPeriodo').text('—');
    $('#baseDatos').text('—');
    $('#hallazgos').prop('hidden', true);
    $('#rankingIngenios').empty();
    stats = null;
  }

  function renderRanking(result, indicator) {
    var $hallazgos = $('#hallazgos');
    var $list = $('#rankingIngenios').empty();
    $('#hallazgosMetodo').text(result.metodo);
    var rankingTitle = result.indicador === 'produccion'
      ? 'Mayor producción acumulada por ingenio'
      : result.indicador === 'superficie'
        ? 'Mayor superficie media por ingenio'
        : 'Mayores rendimientos medios por ingenio';
    $('#hallazgosTitulo').text(rankingTitle);
    if (result.ranking.length) {
      result.ranking.forEach(function (item) {
        var periods = item.zafras.length + (item.zafras.length === 1 ? ' zafra' : ' zafras');
        var note = item.parcial ? ' · incluye dato parcial' : '';
        var value = fmt(item.valor) + ' ' + indicator.unidad;
        if (result.indicador === 'produccion') value = fmt(item.valor) + ' t acumuladas';
        var delta = result.indicador === 'rendimiento' && Number.isFinite(item.comparacionPct)
          ? ' · ' + (item.comparacionPct >= 0 ? '+' : '') + fmt(item.comparacionPct) + '% vs. promedio del conjunto' : '';
        $list.append($('<li>').html('<strong>' + esc(item.ingenio) + '</strong> — ' + esc(value) + esc(delta) +
          ' <span class="ranking-cobertura">(' + periods + note + ')</span>'));
      });
      $('#hallazgosNota').text(result.indicador === 'rendimiento'
        ? 'El mayor registro individual y el promedio por ingenio son medidas distintas; el promedio se pondera por hectáreas.'
        : 'Ranking calculado con los registros válidos del periodo; no se incluyen valores ausentes.');
      $hallazgos.prop('hidden', false);
    } else {
      $hallazgos.prop('hidden', true);
    }
  }

  function calcularActual() {
    return A.analizar(datos, filtrosActuales(), A.ZAFRA_EN_CURSO);
  }

  /* ---------- Estado de IA ---------- */
  function cambiarEstadoIA(state, text) {
    $('#iaPill').removeClass('ok bad').addClass(state);
    $('#iaPillTxt').text(text);
  }

  function sondearIA() {
    if (!validateAiUrl(aiUrl())) { cambiarEstadoIA('bad', 'Dirección de IA inválida'); return; }
    if (!modeloValido(aiModel())) { cambiarEstadoIA('bad', 'Modelo inválido'); return; }
    $.ajax({ url: aiUrl() + '/api/tags', dataType: 'json', timeout: 8000 })
      .done(function (response) {
        var models = (response.models || []).map(function (m) { return m.name; });
        var selected = aiModel();
        var installed = models.some(function (name) { return name === selected || name.indexOf(selected + ':') === 0; });
        if (installed) cambiarEstadoIA('ok', 'IA local disponible');
        else cambiarEstadoIA('bad', 'Modelo no disponible');
      })
      .fail(function () { cambiarEstadoIA('bad', 'IA local no disponible'); });
  }

  /* ---------- Prompts y validación de orientación IA ---------- */
  function systemPrompt() {
    return 'Eres un asistente de orientación agrícola para CAÑAIdata. La aplicación ya verificó que la pregunta corresponde a los datos de caña de azúcar. ' +
      'Los hallazgos numéricos, los promedios y los rankings se calculan en código y se muestran por separado; no los repitas ni calcules otros. ' +
      'Entrega hasta tres sugerencias cualitativas, en español formal, como líneas de trabajo que un equipo técnico puede evaluar. ' +
      'No afirmes que una práctica causó un rendimiento, no diagnostiques un ingenio, no nombres ingenios, no escribas cifras, porcentajes, años, unidades ni cantidades. ' +
      'No añadas resumen ejecutivo, rankings, datos nuevos ni una respuesta de rechazo. No uses numeración; separa las sugerencias con saltos de línea. ' +
      'Estas sugerencias son orientativas y no sustituyen evaluación agronómica de campo.';
  }

  function contextoIA(result, question) {
    var ranking = result.ranking.map(function (r) {
      return r.ingenio + ': ' + fmt(r.valor) + ' ' + result.unidad + ' (' + r.zafras.length + ' zafras' + (r.parcial ? ', incluye parcial' : '') + ')';
    }).join('\n');
    return 'Pregunta validada por la aplicación como consulta dentro del alcance.\n' +
      'Pregunta del cliente: ' + question + '\n' +
      'Indicador: ' + result.nombreIndicador + '\n' +
      'Periodo analizado: ' + result.periodo + (result.parcialUsado ? ' (incluye zafra en curso; parcial)' : '') + '\n' +
      'Ingenios con dato: ' + result.ingenios + '\n' +
      'Registros válidos: ' + result.registros + '\n' +
      'Promedio calculado: ' + fmt(result.promedio) + ' ' + result.unidad + '\n' +
      (result.mejor ? 'Mayor registro: ' + result.mejor.ingenio + ', ' + fmt(result.mejor.valor) + ' ' + result.unidad + ', zafra ' + result.mejor.zafra + '\n' : '') +
      'Ranking calculado por el sistema:\n' + ranking + '\n\n' +
      'No vuelvas a citar ni a reformular los hechos anteriores. Solo ofrece sugerencias cualitativas y verificables en campo.';
  }

  function validateAiUrl(value) {
    try {
      var u = new URL(value);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch (_) { return false; }
  }

  function llamarIA(messages, onDone, onFail) {
    $.ajax({
      url: aiUrl() + '/api/chat',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      timeout: 180000,
      data: JSON.stringify({
        model: aiModel(), stream: false,
        options: { temperature: 0.2, num_predict: 180 },
        messages: messages
      })
    }).done(onDone).fail(onFail);
  }

  function errorIAHtml(xhr, allowRetry) {
    var cause = 'No fue posible comunicarse con la IA local. Compruebe que Ollama esté abierto y que la dirección en Ajustes de la IA sea correcta.';
    if (xhr && xhr.status === 404) {
      cause = 'Ollama no encontró el modelo “' + esc(aiModel()) + '”. Compruebe el nombre del modelo instalado.';
    } else if (xhr && xhr.status === 0) {
      cause = 'La conexión fue bloqueada o no llegó a la IA. Compruebe Ollama, CORS y la dirección configurada.';
    } else if (xhr && xhr.status >= 500) {
      cause = 'Ollama devolvió un error interno (' + xhr.status + '). Espere un momento y reintente.';
    }
    return '<strong>No se generó la orientación de IA.</strong><p>' + cause + '</p>' +
      (allowRetry ? '<button type="button" class="retry-acta">Reintentar orientación</button>' : '');
  }

  function safeAdvice(text, names, allowRetry) {
    var check = A.validarOrientacionIA(text, names);
    if (!check.ok) {
      return '<div class="msg-policy" role="status"><strong>Orientación no mostrada.</strong><p>La respuesta de la IA contenía ' +
        esc(check.motivo) + '. Se ocultó para no confundir una sugerencia generada con un resultado calculado. Las cifras del expediente siguen disponibles arriba.</p>' +
        (allowRetry ? '<button type="button" class="retry-acta">Solicitar otra orientación</button>' : '') + '</div>';
    }
    var paragraphs = check.texto.split(/\n+/).map(function (line) { return line.trim().replace(/^[-•*]\s*/, ''); }).filter(Boolean);
    if (!paragraphs.length) return '<p>No se recibió una sugerencia utilizable. Puede reintentar.</p>';
    return paragraphs.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join('');
  }

  function rechazoIA(reason, statsResult) {
    if (reason === 'rechazo contradictorio') {
      return '<div class="msg-policy" role="status"><strong>La respuesta automática no fue coherente con la consulta.</strong><p>La aplicación clasificó su pregunta dentro del alcance, pero la IA la rechazó. Esa salida se ocultó; los hallazgos calculados arriba se mantienen. Puede reintentar o reformular la pregunta.</p><button type="button" class="retry-acta">Reintentar</button></div>';
    }
    return safeAdvice('', unique(datos, 'ingenio'));
  }

  function evidenceHtml(result) {
    var ind = A.INDICADORES[result.indicador];
    var html = '<section class="acta-evidence"><h4>Hallazgos calculados del expediente</h4>' +
      '<p><strong>' + esc(result.promedioLabel) + ':</strong> ' + fmt(result.promedio) + ' ' + esc(result.unidad) + '.</p>';
    if (result.mejor) {
      html += '<p><strong>Mayor registro individual:</strong> ' + esc(result.mejor.ingenio) + ', ' +
        fmt(result.mejor.valor) + ' ' + esc(result.unidad) + ' en la zafra ' + esc(result.mejor.zafra) + '.</p>';
    }
    if (result.ranking.length) {
      var rankingTitle = result.indicador === 'produccion'
        ? 'Mayor producción acumulada por ingenio en el periodo seleccionado:'
        : result.indicador === 'superficie'
          ? 'Mayor superficie media por ingenio en el periodo seleccionado:'
          : 'Mayores rendimientos medios por ingenio en el periodo seleccionado:';
      html += '<p><strong>' + esc(rankingTitle) + '</strong></p><ol>';
      result.ranking.forEach(function (r) {
        var delta = result.indicador === 'rendimiento' && Number.isFinite(r.comparacionPct)
          ? ' (' + (r.comparacionPct >= 0 ? '+' : '') + fmt(r.comparacionPct) + '% vs. promedio del conjunto)' : '';
        html += '<li>' + esc(r.ingenio) + ': ' + fmt(r.valor) + ' ' + esc(ind.unidad) + delta +
          ' · ' + r.zafras.length + (r.zafras.length === 1 ? ' zafra' : ' zafras') +
          (r.parcial ? ' (incluye zafra parcial)' : '') + '</li>';
      });
      html += '</ol>';
    }
    html += '<p class="method-note">Método: ' + esc(result.metodo) + '</p>';
    if (result.parcialUsado) html += '<p class="partial-note">Este análisis incluye registros parciales de la zafra ' + esc(A.ZAFRA_EN_CURSO) + '; compárelos con cautela.</p>';
    if (result.registrosSinDato > 0) html += '<p class="method-note">Se excluyeron ' + result.registrosSinDato + ' registros sin valor reportado para este indicador.</p>';
    html += '</section>';
    return html;
  }

  /* ---------- Actas ---------- */
  function actaHtml(a) {
    return '<article class="acta" id="acta-' + a.id + '">' +
      '<div class="acta-head"><span class="acta-num">Acta ' + a.id + '</span>' +
      '<span class="acta-meta">' + esc(a.filtrosTxt) + ' · ' + esc(a.fecha) + '</span></div>' +
      '<p class="acta-q">“' + esc(a.pregunta) + '”</p>' +
      evidenceHtml(a.result) +
      '<section class="ai-guidance"><h4>Orientación de la IA · propuesta para revisión técnica</h4>' +
      '<p class="ai-disclaimer">Las sugerencias son orientativas; no son hallazgos medidos ni demuestran causalidad.</p>' +
      '<div class="informe"><p class="msg-cargando">Elaborando sugerencias<span class="puntos" aria-hidden="true"></span></p></div></section>' +
      '<p class="acta-firma">Orientación generada por IA local · ' + esc(a.modelo) + ' · se usaron ' + a.registros + ' registros válidos del origen activo.</p>' +
      '<div class="seguimiento"><p class="seg-count">Preguntas de seguimiento: 0 de ' + MAX_SEG + '</p>' +
      '<div class="seg-row"><input type="text" maxlength="' + MAX_Q + '" placeholder="Pregunta de seguimiento sobre esta acta…" aria-label="Pregunta de seguimiento" />' +
      '<button type="button" class="seg-btn">Preguntar</button></div><div class="seg-list"></div></div></article>';
  }

  function setTrabajando(value) {
    trabajando = value;
    $('#consultBtn').prop('disabled', value || !preguntaValida()).text(value ? 'Elaborando orientación…' : 'Generar recomendación');
    $('#composerInput').prop('disabled', value);
    $('.seg-btn').prop('disabled', value);
    validarPregunta();
  }

  function marcarActasStale() {
    var f = filtrosActuales();
    var signature = f.ing + '|' + f.zaf + '|' + f.ind;
    actas.forEach(function (acta) {
      var $article = $('#acta-' + acta.id);
      var stale = acta.firma !== signature;
      $article.find('.seg-row input, .seg-btn').prop('disabled', stale || trabajando || acta.seguimientos.length >= MAX_SEG);
      $article.find('.seg-nota-stale').remove();
      if (stale && acta.seguimientos.length < MAX_SEG) {
        $article.find('.seguimiento').append('<p class="seg-nota seg-nota-stale">Acta cerrada: los filtros cambiaron. Abra una nueva consulta para continuar.</p>');
      }
    });
  }

  function mensajeSinDatos(result) {
    $('#emptyState').remove();
    var text;
    if (result.registrosSeleccionados === 0) {
      text = 'No hay registros para la combinación de filtros seleccionada.';
    } else if (result.indicador === 'produccion' && result.zafraParcialSeleccionadaSinDato) {
      text = 'La zafra en curso todavía no tiene producción de azúcar reportada. Esos ceros se tratan como datos pendientes, no como producción real igual a cero.';
    } else {
      text = 'Hay registros para los filtros, pero no contienen valores válidos para el indicador seleccionado.';
    }
    $('#thread').append('<div class="msg-policy" role="status"><strong>No hay base suficiente para emitir el análisis.</strong><p>' + esc(text) + ' Ajuste los filtros o elija otro indicador. No se envió la consulta a la IA.</p></div>');
    $('#composerHint').text('No se creó un acta porque no hay cifras válidas para estos filtros.');
  }

  function consultar() {
    var question = $('#composerInput').val().trim();
    if (!question || question.length > MAX_Q || trabajando) { $('#composerInput').trigger('focus'); return; }
    var classified = clasificar(question, false);
    if (!classified.ok) { mostrarAvisoPolitica(classified.tipo); return; }

    var result = calcularActual();
    actualizarExpediente(result);
    yaAnalizo = true;
    if (!result.tieneDatos) { mensajeSinDatos(result); return; }

    actaSeq += 1;
    var filters = filtrosActuales();
    var acta = {
      id: actaSeq,
      filtrosTxt: textoFiltros(),
      pregunta: question,
      fecha: fechaHora(),
      modelo: aiModel(),
      registros: result.registros,
      firma: filters.ing + '|' + filters.zaf + '|' + filters.ind,
      result: result,
      contexto: contextoIA(result, question),
      orientacion: '',
      seguimientos: []
    };
    actas.push(acta);
    $('#emptyState').remove();
    $('#thread').append(actaHtml(acta));
    var $article = $('#acta-' + acta.id);
    $article[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#composerHint').text('Las cifras se calcularon desde el CSV. La IA generará solo sugerencias cualitativas.');
    solicitarOrientacion(acta, $article);
  }

  function solicitarOrientacion(acta, $article) {
    if (trabajando) return;
    setTrabajando(true);
    $article.find('.informe').html('<p class="msg-cargando">Elaborando sugerencias<span class="puntos" aria-hidden="true"></span></p>');
    $('#composerHint').text('La IA está preparando orientación cualitativa; los resultados calculados no dependen de la respuesta del modelo.');
    llamarIA([
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: acta.contexto }
    ], function (response) {
      var text = response && response.message && response.message.content || '';
      var checked = A.validarOrientacionIA(text, unique(datos, 'ingenio'));
      if (!checked.ok) {
        var reasonHtml = checked.motivo === 'rechazo contradictorio'
          ? rechazoIA(checked.motivo, acta.result)
          : safeAdvice(text, unique(datos, 'ingenio'), true);
        $article.find('.informe').html(reasonHtml);
        acta.orientacion = '';
      } else {
        acta.orientacion = checked.texto;
        $article.find('.informe').html(renderAdvice(checked.texto));
      }
      setTrabajando(false);
      marcarActasStale();
      $('#composerHint').text('Las cifras son calculadas; la orientación de IA se presenta como propuesta cualitativa.');
    }, function (xhr) {
      $article.find('.informe').html(errorIAHtml(xhr, true));
      setTrabajando(false);
      marcarActasStale();
      $('#composerHint').text('No se generó orientación de IA. Los hallazgos calculados del expediente permanecen disponibles.');
    });
  }

  function renderAdvice(text) {
    var lines = String(text).split(/\n+/).map(function (line) { return line.trim().replace(/^[-•*]\s*/, ''); }).filter(Boolean);
    if (!lines.length) return '<p>No se recibió una sugerencia utilizable.</p>';
    return lines.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join('');
  }

  function mostrarAvisoPolitica(kind, $container) {
    var content;
    if (kind === 'dato-no-cargado') {
      content = '<strong>Indicador no disponible.</strong><p>Los costos no están integrados en el expediente actual. Esta versión permite analizar rendimiento de campo, superficie cosechada y producción de azúcar; no generará estimaciones de costos.</p>';
    } else {
      content = '<strong>Consulta fuera del alcance.</strong><p>CAÑAIdata responde únicamente sobre los indicadores de caña de azúcar y los periodos cargados. Pruebe con rendimiento de campo, superficie cosechada, producción de azúcar, comparación entre ingenios o evolución por zafra.</p>';
    }
    var html = '<div class="msg-policy" role="status">' + content + '</div>';
    if ($container) $container.append(html);
    else {
      $('#emptyState').remove();
      $('#thread').append(html);
    }
    $('#composerHint').text('La pregunta se revisó en la aplicación; no se envió a la IA.');
  }

  function clasificar(question, isFollowup) {
    return A.clasificarPregunta(question, { ingenios: unique(datos, 'ingenio'), seguimiento: Boolean(isFollowup) });
  }

  function seguimiento(acta, question, $article) {
    if (trabajando || acta.seguimientos.length >= MAX_SEG) return;
    var classified = clasificar(question, true);
    if (!classified.ok) {
      mostrarAvisoPolitica(classified.tipo, $article.find('.seg-list'));
      return;
    }
    var index = acta.seguimientos.length + 1;
    var $list = $article.find('.seg-list');
    var $turn = $('<div class="seg-turn"></div>');
    $turn.append('<p class="seg-par"><strong>Seguimiento ' + index + ' — Cliente:</strong> ' + esc(question) + '</p>');
    var $answer = $('<div class="seg-par"><strong>Consultora:</strong> <span class="msg-cargando">Elaborando<span class="puntos" aria-hidden="true"></span></span></div>');
    $turn.append($answer);
    $list.append($turn);
    $article.find('.seg-count').text('Preguntas de seguimiento: ' + acta.seguimientos.length + ' de ' + MAX_SEG + ' completadas · 1 en curso');
    setTrabajando(true);

    var messages = [
      { role: 'system', content: systemPrompt() + ' Es un seguimiento de un acta previa. Usa el expediente congelado y no reinterpretes los filtros actuales.' },
      { role: 'user', content: acta.contexto },
      { role: 'assistant', content: acta.orientacion || 'No se emitió orientación automática; usa solo los hallazgos medidos.' }
    ];
    acta.seguimientos.forEach(function (turn) {
      messages.push({ role: 'user', content: 'Seguimiento: ' + turn.pregunta });
      messages.push({ role: 'assistant', content: turn.respuesta });
    });
    messages.push({ role: 'user', content: 'Pregunta de seguimiento: ' + question });

    llamarIA(messages, function (response) {
      var text = response && response.message && response.message.content || '';
      var checked = A.validarOrientacionIA(text, unique(datos, 'ingenio'));
      if (!checked.ok) {
        $answer.html('<strong>Consultora:</strong> ' + safeAdvice(text, unique(datos, 'ingenio')));
        $article.find('.seg-count').text('Preguntas de seguimiento: ' + acta.seguimientos.length + ' de ' + MAX_SEG + ' completadas');
      } else {
        acta.seguimientos.push({ pregunta: question, respuesta: checked.texto });
        $answer.html('<strong>Consultora:</strong> ' + renderAdvice(checked.texto));
        $article.find('.seg-row input').val('');
        $article.find('.seg-count').text('Preguntas de seguimiento: ' + acta.seguimientos.length + ' de ' + MAX_SEG);
      }
      setTrabajando(false);
      marcarActasStale();
      if (acta.seguimientos.length >= MAX_SEG) {
        $article.find('.seg-row input, .seg-btn').prop('disabled', true);
        $list.append('<p class="seg-nota">Se alcanzó el límite de seguimientos. Abra una nueva consulta para continuar.</p>');
      }
    }, function (xhr) {
      $answer.html(errorIAHtml(xhr, false));
      $article.find('.seg-count').text('Preguntas de seguimiento: ' + acta.seguimientos.length + ' de ' + MAX_SEG + ' completadas');
      setTrabajando(false);
      marcarActasStale();
    });
  }

  /* ---------- Preguntas ---------- */
  function preguntaValida() {
    var n = $('#composerInput').val().trim().length;
    return n > 0 && n <= MAX_Q;
  }
  function validarPregunta() {
    var n = $('#composerInput').val().trim().length;
    $('#qCount').text(n + ' / ' + MAX_Q).toggleClass('fuera', n > MAX_Q);
    if (!trabajando) $('#consultBtn').prop('disabled', !preguntaValida());
  }

  /* ---------- Ajustes de IA ---------- */
  $('#cfgBtn').on('click', function () {
    var open = $('#iaConfig').toggleClass('open').hasClass('open');
    $(this).attr('aria-expanded', open ? 'true' : 'false');
    if (open) { $('#cfgUrl').val(aiUrl()); $('#cfgModelo').val(aiModel()); }
  });

  $('#cfgProbar').on('click', function () {
    var url = $('#cfgUrl').val().trim().replace(/\/+$/, '');
    if (!validateAiUrl(url)) { $('#cfgStatus').text('Escriba una dirección HTTP o HTTPS válida, sin usuario ni contraseña.'); return; }
    $('#cfgStatus').text('Probando conexión…');
    $.ajax({ url: url + '/api/tags', dataType: 'json', timeout: 8000 })
      .done(function (response) {
        var models = (response.models || []).map(function (m) { return m.name; });
        var model = $('#cfgModelo').val().trim() || MODELO_DEFAULT;
        var installed = models.some(function (name) { return name === model || name.indexOf(model + ':') === 0; });
        if (installed) {
          cambiarEstadoIA('ok', 'IA local disponible');
          $('#cfgStatus').text('Conexión establecida. Modelo disponible: ' + model);
        } else {
          cambiarEstadoIA('bad', 'Modelo no disponible');
          $('#cfgStatus').text(models.length
            ? 'Ollama responde, pero no aparece el modelo “' + model + '”. Modelos disponibles: ' + models.join(', ')
            : 'Ollama responde, pero no hay modelos descargados.');
        }
      })
      .fail(function () {
        cambiarEstadoIA('bad', 'IA local no disponible');
        $('#cfgStatus').text('Sin comunicación con la dirección indicada. Compruebe Ollama, CORS y la dirección configurada.');
      });
  });

  $('#cfgGuardar').on('click', function () {
    var url = $('#cfgUrl').val().trim().replace(/\/+$/, '');
    var model = $('#cfgModelo').val().trim();
    if (!validateAiUrl(url)) { $('#cfgStatus').text('Escriba una dirección HTTP o HTTPS válida, sin usuario ni contraseña.'); return; }
    if (!modeloValido(model)) { $('#cfgStatus').text('Indique un nombre de modelo válido, por ejemplo llama3.2:3b.'); return; }
    var savedUrl = writePreference('canai_ia_url', url);
    var savedModel = writePreference('canai_ia_modelo', model);
    var persistido = savedUrl && savedModel;
    $('#footModelo').text(model);
    $('#cfgStatus').text(persistido ? 'Configuración guardada.' : 'Configuración aplicada solo durante esta sesión; el navegador bloqueó el almacenamiento local.');
    sondearIA();
  });

  /* ---------- Eventos ---------- */
  $('#ingenio, #zafra, #indicador').on('change', function () {
    if (yaAnalizo) actualizarExpediente(calcularActual());
    else limpiarExpediente();
    marcarActasStale();
  });
  $('#composerInput').on('input', validarPregunta);
  $('#consultBtn').on('click', consultar);
  $('.ejemplo').on('click', function () {
    $('#composerInput').val($(this).data('q')).trigger('focus');
    validarPregunta();
  });
  $('#thread').on('click', '.seg-btn', function () {
    var $article = $(this).closest('.acta');
    var id = Number($article.attr('id').replace('acta-', ''));
    var acta = actas.filter(function (item) { return item.id === id; })[0];
    if (!acta) return;
    var question = $article.find('.seg-row input').val().trim();
    if (!question || question.length > MAX_Q) { $article.find('.seg-row input').trigger('focus'); return; }
    seguimiento(acta, question, $article);
  });
  $('#thread').on('keydown', '.seg-row input', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); $(this).closest('.seg-row').find('.seg-btn').trigger('click'); }
  });
  $('#thread').on('click', '.retry-acta', function () {
    var $article = $(this).closest('.acta');
    var id = Number($article.attr('id').replace('acta-', ''));
    var acta = actas.filter(function (item) { return item.id === id; })[0];
    if (acta && !trabajando) solicitarOrientacion(acta, $article);
  });

  limpiarExpediente();
  validarPregunta();
  cargarDatos();
});
