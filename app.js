/* CAÑAIdata — lógica real: carga CSV, estadísticas en el navegador y consulta a Ollama.
   La IA corre en la laptop del equipo (Ollama), conectada por localhost o por túnel. */
$(function () {
  var AI_URL_DEFAULT = 'http://localhost:11434';
  var MODELO_DEFAULT = 'llama3.2:3b';

  var datos = [];        // filas activas: {ingenio, zafra, rendimiento, superficie, produccion}
  var fuenteDatos = '';
  var stats = {};

  /* ---------- utilidades ---------- */
  function esc(s) { return $('<div>').text(String(s)).html(); }
  function fmt(n) { return Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 }); }
  function unique(arr, campo) {
    var v = [];
    arr.forEach(function (f) { if (v.indexOf(f[campo]) < 0) v.push(f[campo]); });
    return v;
  }

  /* ---------- configuración de IA (persistente en el navegador) ---------- */
  function aiUrl() { return localStorage.getItem('canai_ia_url') || AI_URL_DEFAULT; }
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
        ingenio: c[0].trim(),
        zafra: c[1].trim(),
        rendimiento: parseFloat(c[2]),
        superficie: parseFloat(c[3]),
        produccion: parseFloat(c[4])
      });
    }
    return filas;
  }

  function usarDemo() {
    datos = DATOS_DEMO.slice();
    fuenteDatos = 'ejemplo';
    iniciar();
  }

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
      ? 'Datos: datos.csv'
      : 'Datos de ejemplo — reemplaza datos.csv por el CSV real');
    llenarFiltros();
    calcular();
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

  function filtradas() {
    var ing = $('#ingenio').val() || 'todos';
    var zaf = $('#zafra').val() || 'todas';
    return datos.filter(function (f) {
      return (ing === 'todos' || f.ingenio === ing) && (zaf === 'todas' || f.zafra === zaf);
    });
  }

  /* ---------- estadísticas ---------- */
  var IND = {
    rendimiento: { campo: 'rendimiento', unidad: 't/ha', corto: 'rendimiento' },
    superficie:  { campo: 'superficie', unidad: 'ha',   corto: 'superficie' },
    produccion:  { campo: 'produccion', unidad: 't',     corto: 'producción' }
  };

  function calcular() {
    var filas = filtradas();
    var ind = IND[$('#indicador').val() || 'rendimiento'];
    var vals = filas.map(function (f) { return f[ind.campo]; }).filter(function (v) { return isFinite(v); });

    var prom = vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : 0;
    var mejor = null;
    filas.forEach(function (f) {
      var v = f[ind.campo];
      if (isFinite(v) && (!mejor || v > mejor.v)) mejor = { v: v, ingenio: f.ingenio };
    });
    var zafras = unique(filas, 'zafra').sort();

    stats = {
      ingenios: unique(filas, 'ingenio').length,
      registros: filas.length,
      promedio: prom,
      mejor: mejor,
      unidad: ind.unidad,
      corto: ind.corto,
      periodo: zafras.length > 1 ? zafras[0] + ' a ' + zafras[zafras.length - 1] : (zafras[0] || '—')
    };
    pintarStats();
  }

  function pintarStats() {
    $('#statIngenios').text(stats.ingenios);
    $('#statPromedioLbl').text('Promedio · ' + stats.corto);
    $('#statPromedio').text(fmt(stats.promedio) + ' ' + stats.unidad);
    $('#statMejorLbl').text(stats.mejor ? 'Mejor · ' + esc(stats.mejor.ingenio) : 'Mejor · —');
    $('#statMejor').text(stats.mejor ? fmt(stats.mejor.v) + ' ' + stats.unidad : '—');
    $('#statPeriodo').text(stats.periodo);
  }

  /* ---------- hilo de mensajes ---------- */
  function addMsg(kind, html) {
    $('#emptyState').remove();
    $('#thread').append($('<div class="msg"></div>').addClass(kind).html(html));
    var t = $('#thread');
    t.scrollTop(t[0].scrollHeight);
  }

  /* ---------- consulta a la IA ---------- */
  function consultar() {
    var pregunta = $('#composerInput').val().trim();
    if (!pregunta) { $('#composerInput').trigger('focus'); return; }

    $('.stage').removeClass('initial');
    calcular();

    var ing = $('#ingenio option:selected').text();
    var zaf = $('#zafra option:selected').text();
    var ind = $('#indicador option:selected').text();

    addMsg('msg--user', '<strong>Consulta</strong> · ' + esc(ing) + ' · ' + esc(zaf) + ' · ' + esc(ind) + '<br>' + esc(pregunta));

    var resumen =
      'Filtros: ingenio=' + ing + ', zafra=' + zaf + ', indicador=' + ind + '\n' +
      'Ingenios analizados: ' + stats.ingenios + '\n' +
      'Registros considerados: ' + stats.registros + '\n' +
      'Promedio de ' + stats.corto + ': ' + fmt(stats.promedio) + ' ' + stats.unidad + '\n' +
      (stats.mejor ? 'Mejor ' + stats.corto + ': ' + fmt(stats.mejor.v) + ' ' + stats.unidad + ' (' + stats.mejor.ingenio + ')\n' : '') +
      'Periodo: ' + stats.periodo + '\n\n' +
      'Pregunta del usuario: ' + pregunta;

    var sys = 'Eres un asesor agrícola mexicano experto en caña de azúcar. ' +
      'Responde en español, claro y directo: primero un resumen de dos líneas de los datos entregados ' +
      'y después de 3 a 5 recomendaciones accionables numeradas. ' +
      'Usa únicamente los datos entregados; no inventes cifras nuevas.';

    $('#consultBtn, #sendBtn').prop('disabled', true);
    $('#composerHint').text('Consultando a la IA…');
    addMsg('msg--loading', 'Analizando datos y generando recomendación…');

    $.ajax({
      url: aiUrl() + '/api/chat',
      method: 'POST',
      contentType: 'application/json',
      timeout: 180000,
      data: JSON.stringify({
        model: aiModel(),
        stream: false,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: resumen }
        ]
      })
    })
      .done(function (r) {
        $('#thread .msg--loading').remove();
        var txt = (r && r.message && r.message.content) || '';
        addMsg('msg--ia', txt
          ? '<strong>Recomendación de la IA</strong><br>' + esc(txt).replace(/\*\*/g, '').replace(/\n/g, '<br>')
          : '<strong>Recomendación de la IA</strong><br>(La IA devolvió una respuesta vacía; intenta de nuevo.)');
      })
      .fail(function (xhr) {
        $('#thread .msg--loading').remove();
        var causa = 'No pude conectar con la IA (' + esc(aiUrl()) + '). ' +
          'Revisa que Ollama esté corriendo' +
          (aiUrl().indexOf('localhost') < 0 ? ' y que el túnel siga activo' : '') +
          ', o cambia la URL en ⚙ Configurar IA.';
        if (xhr.status === 404) {
          causa = 'Ollama no tiene el modelo "' + esc(aiModel()) + '". Ejecuta en una terminal: ollama pull ' + esc(aiModel());
        }
        addMsg('msg--ia', '<strong>No se pudo generar la recomendación.</strong><br>' + causa);
      })
      .always(function () {
        $('#consultBtn, #sendBtn').prop('disabled', false);
        $('#composerHint').text('La respuesta se genera con IA local.');
      });
  }

  /* ---------- panel ⚙ Configurar IA ---------- */
  $('#cfgBtn').on('click', function () {
    $('#cfgUrl').val(aiUrl());
    $('#cfgModelo').val(aiModel());
    $('.ia-config').toggleClass('open');
  });

  $('#cfgProbar').on('click', function () {
    var u = $('#cfgUrl').val().trim().replace(/\/+$/, '');
    if (!u) { $('#cfgStatus').text('Escribe la URL de la IA primero.'); return; }
    $('#cfgStatus').text('Probando conexión…');
    $.ajax({ url: u + '/api/tags', timeout: 8000 })
      .done(function (r) {
        var modelos = (r.models || []).map(function (m) { return m.name; }).join(', ');
        $('#cfgStatus').text(modelos
          ? 'Conexión OK. Modelos disponibles: ' + modelos
          : 'Conexión OK, pero no hay modelos descargados. Ejecuta: ollama pull ' + aiModel());
      })
      .fail(function () {
        $('#cfgStatus').text('Sin conexión con ' + u +
          '. ¿Está corriendo Ollama y acepta este origen? (instrucciones en el README)');
      });
  });

  $('#cfgGuardar').on('click', function () {
    var u = $('#cfgUrl').val().trim().replace(/\/+$/, '');
    var m = $('#cfgModelo').val().trim();
    if (!u) { $('#cfgStatus').text('Escribe la URL de la IA primero.'); return; }
    localStorage.setItem('canai_ia_url', u);
    localStorage.setItem('canai_ia_modelo', m || MODELO_DEFAULT);
    $('#cfgStatus').text('Guardado. Ya puedes consultar.');
  });

  /* ---------- eventos ---------- */
  $('#ingenio, #zafra, #indicador').on('change', calcular);
  $('#consultBtn').on('click', consultar);
  $('#sendBtn').on('click', consultar);
  $('#composerInput').on('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); consultar(); }
  });

  cargarDatos();
});
