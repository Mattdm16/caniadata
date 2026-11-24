/* CAÑAIdata — consultora formal: expediente en el navegador, actas numeradas,
   hasta 3 seguimientos por acta y recomendaciones de la IA local (Ollama). */
$(function () {
  var AI_URL_DEFAULT = 'http://localhost:11434';
  var MODELO_DEFAULT = 'llama3.2:3b';
  var MAX_Q = 400, MAX_SEG = 3;
  var ZAFRA_CURSO = '2025-2026';

  var datos = [];
  var fuenteDatos = '';
  var stats = {};
  var actas = [];
  var actaSeq = 0;
  var trabajando = false;

  /* ---------- utilidades ---------- */
  function esc(s) { return $('<div>').text(String(s)).html(); }
  function fmt(n) { return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }); }
  function unique(arr, campo) {
    var v = [];
    arr.forEach(function (f) { if (v.indexOf(f[campo]) < 0) v.push(f[campo]); });
    return v;
  }
  function ahora() {
    return new Date().toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function aiUrl() { return (localStorage.getItem('canai_ia_url') || AI_URL_DEFAULT).replace(/\/+$/, ''); }
  function aiModel() { return localStorage.getItem('canai_ia_modelo') || MODELO_DEFAULT; }

  /* ---------- carga de datos ---------- */
  function parseCsv(texto) {
    var lineas = texto.trim().split(/\r?\n/);
    var filas = [];
    for (var i = 1; i < lineas.length; i++) {
      if (!lineas[i].trim()) continue;
      var c = lineas[i].split(',');
      if (c.length < 5) continue;
      filas.push({
        ingenio: c[0].trim(), zafra: c[1].trim(),
        rendimiento: parseFloat(c[2]), superficie: parseFloat(c[3]), produccion: parseFloat(c[4])
      });
    }
    return filas;
  }
  function usarDemo() { datos = DATOS_DEMO.slice(); fuenteDatos = 'ejemplo'; iniciar(); }
  function cargarDatos() {
    if (location.protocol === 'file:') { usarDemo(); return; }
    $.ajax({ url: 'datos.csv', dataType: 'text', timeout: 8000 })
      .done(function (t) {
        var f = parseCsv(t);
        if (f.length) { datos = f; fuenteDatos = 'datos.csv'; iniciar(); }
        else usarDemo();
      })
      .fail(usarDemo);
  }
  function iniciar() {
    $('#dataBadge').text(fuenteDatos === 'datos.csv'
      ? 'Datos: datos.csv · CONADESUCA'
      : 'Datos de ejemplo');
    $('#footModelo').text(aiModel());
    llenarFiltros();
    // Opciones recomendadas por defecto: panorama nacional, última zafra
    // completa (se evita la 2025-2026, en curso) e indicador de rendimiento.
    $('#ingenio').val('todos');
    if ($('#zafra option[value="2024-2025"]').length) $('#zafra').val('2024-2025');
    $('#indicador').val('rendimiento');
    // El expediente permanece vacío ("—") hasta la primera consulta.
    sondearIA();
  }

  /* ---------- filtros ---------- */
  function llenarFiltros() {
    var $i = $('#ingenio').empty().append('<option value="todos">Todos los ingenios</option>');
    unique(datos, 'ingenio').sort().forEach(function (n) { $i.append('<option>' + esc(n) + '</option>'); });
    var $z = $('#zafra').empty().append('<option value="todas">Todas las zafras</option>');
    unique(datos, 'zafra').sort().reverse().forEach(function (z) { $z.append('<option>' + esc(z) + '</option>'); });
    $('#cfgModelo').val(aiModel());
    $('#cfgUrl').val(aiUrl());
  }
  function filtrosSel() {
    return {
      ing: $('#ingenio').val() || 'todos',
      zaf: $('#zafra').val() || 'todas',
      ind: $('#indicador').val() || 'rendimiento'
    };
  }
  function filtradas() {
    var f = filtrosSel();
    return datos.filter(function (d) {
      return (f.ing === 'todos' || d.ingenio === f.ing) && (f.zaf === 'todas' || d.zafra === f.zaf);
    });
  }

  /* ---------- expediente ---------- */
  var IND = {
    rendimiento: { campo: 'rendimiento', unidad: 't/ha', corto: 'rendimiento' },
    superficie:  { campo: 'superficie', unidad: 'ha',   corto: 'superficie' },
    produccion:  { campo: 'produccion', unidad: 't',     corto: 'producción' }
  };
  function calcular() {
    var filas = filtradas();
    var f = filtrosSel();
    var ind = IND[f.ind];
    var vals = filas.map(function (d) { return d[ind.campo]; }).filter(isFinite);
    var prom = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0;
    var mejor = null;
    filas.forEach(function (d) {
      var v = d[ind.campo];
      if (isFinite(v) && (!mejor || v > mejor.v)) mejor = { v: v, ingenio: d.ingenio };
    });
    var zafras = unique(filas, 'zafra').sort();
    stats = {
      ingenios: unique(filas, 'ingenio').length,
      registros: filas.length,
      promedio: prom, mejor: mejor,
      unidad: ind.unidad, corto: ind.corto,
      periodo: zafras.length > 1 ? zafras[0] + ' a ' + zafras[zafras.length - 1] : (zafras[0] || '—'),
      parcial: f.zaf === 'todas' ? filas.some(function (d) { return d.zafra === ZAFRA_CURSO; }) : f.zaf === ZAFRA_CURSO,
      filtrosTxt: $('#ingenio option:selected').text() + ' · ' + $('#zafra option:selected').text() + ' · ' + $('#indicador option:selected').text()
    };
    pintarExpediente();
    marcarActasStale();
  }
  function pintarExpediente() {
    $('#statIngenios').text(stats.ingenios);
    $('#statPromedioLbl').text('Promedio · ' + stats.corto);
    $('#statPromedio').text(fmt(stats.promedio) + ' ' + stats.unidad);
    $('#statMejorLbl').text(stats.mejor ? 'Mejor · ' + stats.mejor.ingenio : 'Mejor registro');
    $('#statMejor').text(stats.mejor ? fmt(stats.mejor.v) + ' ' + stats.unidad : '—');
    $('#statPeriodo').text(stats.periodo);
    $('#baseDatos').text(stats.registros + ' registros · ' + stats.filtrosTxt +
      (stats.parcial ? ' · Incluye la zafra en curso 2025-2026 (cifras parciales).' : ''));
  }

  /* ---------- estado de la IA ---------- */
  function sondearIA() {
    $.ajax({ url: aiUrl() + '/api/tags', timeout: 8000 })
      .done(function () { $('#iaPill').removeClass('bad').addClass('ok'); $('#iaPillTxt').text('IA local disponible'); })
      .fail(function () { $('#iaPill').removeClass('ok').addClass('bad'); $('#iaPillTxt').text('IA local no disponible'); });
  }

  /* ---------- prompt de la consultora ---------- */
  function sysBase() {
    return 'Eres el analista senior de CAÑAIdata, una consultora mexicana especializada en la agroindustria de la caña de azúcar. ' +
      'Respondes en español formal y preciso. Tu informe usa texto plano, sin markdown, con estas secciones separadas por líneas en blanco: ' +
      'Resumen ejecutivo (máximo dos líneas). Hallazgos (citas las cifras del expediente). Recomendaciones (de 3 a 5, numeradas y accionables). ' +
      'Base de datos (una línea con filtros, periodo y registros). ' +
      'Reglas: usa ÚNICAMENTE las cifras del expediente; no inventes ninguna cifra nueva; si un dato no consta, decláralo. ' +
      'Si la zafra en curso 2025-2026 forma parte del análisis, advierte que son cifras parciales. ' +
      'Si la pregunta es ajena a la caña de azúcar o a los datos cargados, responde con cortesía profesional que esta consultora solo asesora ' +
      'sobre la producción de caña de azúcar a partir de los datos históricos cargados, sugiere dos o tres ejemplos de preguntas que sí puede responder, ' +
      'y no respondas la pregunta fuera de alcance.';
  }
  function expedienteTxt(f, pregunta) {
    return 'Filtros: ' + f.filtrosTxt + '\n' +
      'Ingenios analizados: ' + f.ingenios + '\n' +
      'Registros considerados: ' + f.registros + '\n' +
      'Promedio de ' + f.corto + ': ' + fmt(f.promedio) + ' ' + f.unidad + '\n' +
      (f.mejor ? 'Mejor ' + f.corto + ': ' + fmt(f.mejor.v) + ' ' + f.unidad + ' (' + f.mejor.ingenio + ')\n' : '') +
      'Periodo: ' + f.periodo + (f.parcial ? ' (incluye zafra en curso 2025-2026, cifras parciales)' : '') + '\n\n' +
      'Pregunta del cliente: ' + pregunta;
  }
  function llamarIA(messages, onOk, onErr) {
    $.ajax({
      url: aiUrl() + '/api/chat', method: 'POST', contentType: 'application/json', timeout: 180000,
      data: JSON.stringify({ model: aiModel(), stream: false, messages: messages })
    }).done(onOk).fail(onErr);
  }
  function errorIAHtml(xhr) {
    var causa = 'No fue posible establecer comunicación con la IA local (' + esc(aiUrl()) + '). ' +
      'Verifique que Ollama esté en ejecución' +
      (aiUrl().indexOf('localhost') < 0 ? ' y que el túnel permanezca activo' : '') +
      ' o actualice la dirección en Ajustes de la IA.';
    if (xhr.status === 404) {
      causa = 'Ollama no dispone del modelo "' + esc(aiModel()) + '". Ejecute en una terminal: ollama pull ' + esc(aiModel());
    }
    return '<strong>No fue posible emitir la recomendación.</strong><ol><li>' + causa + '</li>' +
      '<li>Compruebe el estado en Ajustes de la IA → Probar conexión.</li></ol>';
  }
  function formatearInforme(txt) {
    var html = esc(txt).replace(/\*\*/g, '').replace(/\*/g, '');
    var lineas = html.split('\n');
    var out = [], par = [];
    var SEC = /^(resumen ejecutivo|hallazgos|recomendaciones|base de datos)\s*:?\s*$/i;
    function vaciar() {
      if (!par.length) return;
      var t = par.join('<br>').trim();
      if (t) out.push('<p>' + t + '</p>');
      par = [];
    }
    lineas.forEach(function (ln) {
      var s = ln.trim();
      if (!s) { vaciar(); return; }
      var m = s.match(SEC);
      if (m) { vaciar(); out.push('<h4>' + m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + '</h4>'); return; }
      par.push(s);
    });
    vaciar();
    return out.join('') || '<p>(La IA devolvió una respuesta vacía; inténtelo de nuevo.)</p>';
  }

  /* ---------- actas ---------- */
  function actaHtml(a) {
    return '<article class="acta" id="acta-' + a.id + '">' +
      '<div class="acta-head"><span class="acta-num">Acta ' + a.id + '</span>' +
      '<span class="acta-meta">' + esc(a.filtrosTxt) + ' · ' + esc(a.fecha) + '</span></div>' +
      '<p class="acta-q">“' + esc(a.pregunta) + '”</p>' +
      '<div class="informe"></div>' +
      '<p class="acta-firma">Emitido por el analista senior de CAÑAIdata · Modelo local ' + esc(a.modelo) + ' · ' + a.registros + ' registros de respaldo.</p>' +
      '<div class="seguimiento"><p class="seg-count">Preguntas de seguimiento: 0 de ' + MAX_SEG + '</p>' +
      '<div class="seg-row"><input type="text" maxlength="400" placeholder="Pregunta de seguimiento sobre esta acta…" aria-label="Pregunta de seguimiento" />' +
      '<button type="button" class="seg-btn">Preguntar</button></div>' +
      '<div class="seg-list"></div></div></article>';
  }
  function setTrabajando(v) {
    trabajando = v;
    $('#consultBtn').prop('disabled', v || !preguntaValida()).text(v ? 'Elaborando informe…' : 'Generar recomendación');
    $('.seg-btn').prop('disabled', v);
    validarPregunta();
  }
  function marcarActasStale() {
    var f = filtrosSel();
    var firma = f.ing + '|' + f.zaf + '|' + f.ind;
    actas.forEach(function (a) {
      var $art = $('#acta-' + a.id);
      var stale = a.firma !== firma;
      $art.find('.seg-row input, .seg-btn').prop('disabled', stale || trabajando);
      $art.find('.seg-nota-stale').remove();
      if (stale && a.seguimientos.length < MAX_SEG) {
        $art.find('.seguimiento').append('<p class="seg-nota seg-nota-stale">Acta cerrada: los filtros cambiaron. Defina una nueva consulta para continuar.</p>');
      }
    });
  }

  function consultar() {
    var pregunta = $('#composerInput').val().trim();
    if (!pregunta || trabajando) {
      $('#composerInput').trigger('focus'); return;
    }
    calcular();
    actaSeq += 1;
    var f = filtrosSel();
    var a = {
      id: actaSeq, filtrosTxt: stats.filtrosTxt, pregunta: pregunta,
      fecha: ahora(), modelo: aiModel(), registros: stats.registros,
      firma: f.ing + '|' + f.zaf + '|' + f.ind,
      informeTxt: '', seguimientos: []
    };
    actas.push(a);
    $('#emptyState').remove();
    $('#thread').append(actaHtml(a));
    var $art = $('#acta-' + a.id);
    $art.find('.informe').html('<p class="msg-cargando">El analista está elaborando el informe<span class="puntos" aria-hidden="true"></span></p>');
    $art[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTrabajando(true);
    $('#composerHint').text('Elaborando el informe ejecutivo…');

    llamarIA(
      [{ role: 'system', content: sysBase() }, { role: 'user', content: expedienteTxt(stats, pregunta) }],
      function (r) {
        var txt = (r && r.message && r.message.content) || '';
        a.informeTxt = txt;
        $art.find('.informe').html(formatearInforme(txt));
        setTrabajando(false);
        marcarActasStale();
        $('#composerHint').text('La respuesta se genera con IA local, a partir de los datos cargados.');
      },
      function (xhr) {
        $art.find('.informe').html('<div class="msg-error">' + errorIAHtml(xhr) + '</div>');
        setTrabajando(false);
        marcarActasStale();
        $('#composerHint').text('La respuesta se genera con IA local, a partir de los datos cargados.');
      }
    );
  }

  function seguimiento(a, pregunta, $art) {
    if (trabajando || a.seguimientos.length >= MAX_SEG) return;
    var n = a.seguimientos.length + 1;
    var $list = $art.find('.seg-list');
    $list.append('<div class="seg-par"><strong>Seguimiento ' + n + ' — Cliente:</strong> ' + esc(pregunta) + '</div>');
    var $resp = $('<div class="seg-par"><strong>Consultora:</strong> <span class="msg-cargando">redactando<span class="puntos" aria-hidden="true"></span></span></div>');
    $list.append($resp);
    $art.find('.seg-count').text('Preguntas de seguimiento: ' + n + ' de ' + MAX_SEG);
    if (n >= MAX_SEG) {
      $art.find('.seg-row input, .seg-btn').prop('disabled', true);
      $list.append('<p class="seg-nota">Se alcanzó el límite de seguimientos de esta acta. Le invitamos a definir una nueva consulta en el paso 1.</p>');
    }
    setTrabajando(true);
    var hist = [{ role: 'system', content: sysBase() + ' Es una pregunta de seguimiento dentro de la misma acta: considere el informe ya emitido y el historial. Responda de forma directa y, si procede, añada una recomendación adicional numerada.' },
      { role: 'user', content: expedienteTxt(stats, a.pregunta) },
      { role: 'assistant', content: a.informeTxt || '(informe no disponible)' }];
    a.seguimientos.forEach(function (s) {
      hist.push({ role: 'user', content: 'Seguimiento: ' + s.q });
      hist.push({ role: 'assistant', content: s.a });
    });
    hist.push({ role: 'user', content: 'Seguimiento ' + n + ' de ' + MAX_SEG + ': ' + pregunta });
    llamarIA(hist,
      function (r) {
        var txt = (r && r.message && r.message.content) || '(La IA devolvió una respuesta vacía; inténtelo de nuevo.)';
        a.seguimientos.push({ q: pregunta, a: txt });
        $resp.html('<strong>Consultora:</strong> ' + esc(txt).replace(/\*\*/g, '').replace(/\n/g, '<br>'));
        setTrabajando(false);
        marcarActasStale();
      },
      function (xhr) {
        $resp.html(errorIAHtml(xhr));
        setTrabajando(false);
        marcarActasStale();
      });
  }

  /* ---------- validación de la pregunta ---------- */
  function preguntaValida() {
    var n = $('#composerInput').val().trim().length;
    return n > 0 && n <= MAX_Q;
  }
  function validarPregunta() {
    var n = $('#composerInput').val().trim().length;
    $('#qCount').text(n + ' / ' + MAX_Q).toggleClass('fuera', n > MAX_Q);
    if (!trabajando) $('#consultBtn').prop('disabled', !preguntaValida());
  }

  /* ---------- panel de ajustes ---------- */
  $('#cfgBtn').on('click', function () {
    var open = $('#iaConfig').toggleClass('open').hasClass('open');
    $(this).attr('aria-expanded', open ? 'true' : 'false');
    if (open) { $('#cfgUrl').val(aiUrl()); $('#cfgModelo').val(aiModel()); }
  });
  $('#cfgProbar').on('click', function () {
    var u = $('#cfgUrl').val().trim();
    if (!u) { $('#cfgStatus').text('Escriba la dirección de la IA primero.'); return; }
    $('#cfgStatus').text('Probando conexión…');
    $.ajax({ url: u + '/api/tags', timeout: 8000 })
      .done(function (r) {
        var modelos = (r.models || []).map(function (m) { return m.name; }).join(', ');
        $('#iaPill').removeClass('bad').addClass('ok'); $('#iaPillTxt').text('IA local disponible');
        $('#cfgStatus').text(modelos ? 'Conexión establecida. Modelos disponibles: ' + modelos
          : 'Conexión establecida, pero no hay modelos descargados. Ejecute: ollama pull ' + aiModel());
      })
      .fail(function () {
        $('#iaPill').removeClass('ok').addClass('bad'); $('#iaPillTxt').text('IA local no disponible');
        $('#cfgStatus').text('Sin comunicación con ' + u + '. Verifique que Ollama esté en ejecución y acepte este origen (instrucciones en el README).');
      });
  });
  $('#cfgGuardar').on('click', function () {
    var u = $('#cfgUrl').val().trim();
    var m = $('#cfgModelo').val().trim();
    if (!u) { $('#cfgStatus').text('Escriba la dirección de la IA primero.'); return; }
    localStorage.setItem('canai_ia_url', u);
    localStorage.setItem('canai_ia_modelo', m || MODELO_DEFAULT);
    $('#footModelo').text(m || MODELO_DEFAULT);
    $('#cfgStatus').text('Configuración guardada.');
    sondearIA();
  });

  /* ---------- eventos ---------- */
  $('#ingenio, #zafra, #indicador').on('change', calcular);
  $('#composerInput').on('input', validarPregunta);
  $('#consultBtn').on('click', consultar);
  $('.ejemplo').on('click', function () {
    $('#composerInput').val($(this).data('q')).trigger('focus');
    validarPregunta();
  });
  $('#thread').on('click', '.seg-btn', function () {
    var $art = $(this).closest('.acta');
    var a = actas.filter(function (x) { return x.id === Number($art.attr('id').replace('acta-', '')); })[0];
    if (!a) return;
    var q = $art.find('.seg-row input').val().trim();
    if (!q || q.length > MAX_Q) { $art.find('.seg-row input').trigger('focus'); return; }
    $art.find('.seg-row input').val('');
    seguimiento(a, q, $art);
  });
  $('#thread').on('keydown', '.seg-row input', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $(this).closest('.seg-row').find('.seg-btn').trigger('click'); }
  });

  validarPregunta();
  cargarDatos();
});
