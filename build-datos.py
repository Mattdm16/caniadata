# build-datos.py — Integra los resúmenes INFOCANA (CONADESUCA) en datos.csv
# Fuente: datos-raw/ (descargados de datos.gob.mx, licencia CC-BY 4.0)
#
# NOTA CLAVE: en INFOCANA los valores semanales son ACUMULADOS de la zafra
# (cada semana trae el total hasta esa fecha), por eso el valor anual es el
# MÁXIMO semanal (última semana), NO la suma.
#
# Genera datos.csv con una fila por ingenio y zafra:
#   ingenio, zafra, rendimiento_t_ha, superficie_ha, produccion_t
#     rendimiento_t_ha = cana_molida_bruta_final / superficie_final
#     superficie_ha     = superficie cosechada al cierre de la zafra
#     produccion_t      = azúcar total al cierre de la zafra
#
# También normaliza los nombres de ingenios (los archivos usan razones
# sociales distintas para el mismo molino a lo largo de los años).
import csv
import glob
import os
import re
import sys
import unicodedata
from collections import defaultdict

# La consola de Windows usa cp1252; evita fallos al imprimir nombres con
# caracteres de control heredados de los archivos fuente.
if sys.stdout.encoding and 'utf' not in sys.stdout.encoding.lower():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(BASE, 'datos-raw')
OUT = os.path.join(BASE, 'datos.csv')

# Alias explícitos (nombre normalizado -> nombre canónico)
ALIAS = {
    'pujiltic': 'la fe',                      # La Fe = ingenio de Pujiltic
    'tamazula saenz': 'tamazula',
    'presidente benito juarez santos': 'presidente benito juarez',
    'san gabriel a en p': 'san gabriel',
    'eldorado': 'el dorado',
    'ingeio el mante': 'el mante',            # typo en la fuente
    'azsuremex': 'tenosique',
    'azsuremex tenosique': 'tenosique',
    'santa rosalia de la chontalpa': 'santa rosalia',
}
# Nombres que se toman del paréntesis cuando existe
PARENTESIS_VALIDOS = {'tala', 'la margarita', 'la joya', 'pujiltic',
                      'la primavera', 'cuatotolapam'}
PREFIJOS = ['fideicomiso', 'ingenio', 'ingeio', 'central', 'cia', 'ciasa',
            'compania', 'comercializadora', 'grupo', 'azucarera', 'azucarero']
TOKENS_BASURA = {'siembra', 'zcmx'}


def sin_control(s):
    return ''.join(ch for ch in s if unicodedata.category(ch)[0] != 'C')


def sin_acentos(s):
    s = unicodedata.normalize('NFD', s)
    return ''.join(ch for ch in s if not unicodedata.combining(ch))


def normalizar(nombre):
    """Devuelve el nombre canónico en minúsculas, sin razón social ni acentos."""
    s = sin_acentos(sin_control(nombre.strip())).lower()
    s = s.replace('.', ' ').replace(',', ' ').replace('-', ' ')
    s = re.sub(r'\s+', ' ', s).strip()

    # contenido entre paréntesis: a veces lleva el nombre real del molino
    m = re.search(r'\(([^)]*)\)', s)
    if m:
        inner = m.group(1).strip()
        if inner in PARENTESIS_VALIDOS:
            s = inner
        else:
            s = re.sub(r'\([^)]*\)', '', s)
            s = re.sub(r'\s+', ' ', s).strip()

    # sufijo legal tipo "s.a. de c.v." / "s.a.p.i. de c.v."
    s = re.sub(r'\bs\s+a(\s+p(\s+i)?)?(\s+de\s+c\s+v)?\s*$', '', s).strip()

    toks = s.split()
    while toks and toks[0] in PREFIJOS:
        toks = toks[1:]
    while toks and toks[-1] == 'central':
        toks = toks[:-1]
    toks = [t for t in toks if t not in TOKENS_BASURA]
    if len(toks) > 1 and toks[0] == 'de':
        toks = toks[1:]
    toks = ['maria' if t == 'ma' else t for t in toks]  # "José Ma." = "José María"
    s = ' '.join(toks)
    return ALIAS.get(s, s)


def titulo(nombre):
    return ' '.join(w.capitalize() for w in nombre.split())


def leer_csv(ruta):
    for enc in ('utf-8-sig', 'cp1252'):
        try:
            with open(ruta, encoding=enc, newline='') as f:
                return list(csv.DictReader(f)), enc
        except UnicodeDecodeError:
            continue
    raise SystemExit('Encoding no soportado: ' + ruta)


def num(valor):
    try:
        return float((valor or '0').replace(',', '').strip())
    except ValueError:
        return 0.0


archivos = sorted(
    p for p in glob.glob(os.path.join(RAW, '*.csv'))
    if 'infocana' in os.path.basename(p).lower()
)
if not archivos:
    raise SystemExit('No se encontraron archivos INFOCANA en datos-raw/')

# (canonico, zafra) -> {'sup': max, 'cana': max, 'azu': max}
agg = defaultdict(lambda: {'sup': 0.0, 'cana': 0.0, 'azu': 0.0})
nombres_originales = defaultdict(set)

for ruta in archivos:
    filas, _ = leer_csv(ruta)
    for fila in filas:
        zaf = (fila.get('zafra') or '').strip()
        if not zaf:
            continue
        canon = normalizar(fila.get('ingenio') or '')
        if not canon or canon in ('total', 'nacional'):
            continue
        nombres_originales[canon].add((fila.get('ingenio') or '').strip())
        sup = num(fila.get('superficie_cosechada'))
        cana = num(fila.get('cana_molida_bruta'))
        azu = num(fila.get('azucar_total'))
        a = agg[(canon, zaf)]
        a['sup'] = max(a['sup'], sup)
        a['cana'] = max(a['cana'], cana)
        a['azu'] = max(a['azu'], azu)

filas_out = []
for (canon, zaf), v in sorted(agg.items(), key=lambda kv: (kv[0][1], kv[0][0])):
    if v['sup'] <= 0:
        continue
    filas_out.append((titulo(canon), zaf,
                      '%.2f' % (v['cana'] / v['sup']),
                      '%.1f' % v['sup'],
                      '%.1f' % v['azu']))

with open(OUT, 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f)
    w.writerow(['ingenio', 'zafra', 'rendimiento_t_ha', 'superficie_ha', 'produccion_t'])
    w.writerows(filas_out)

# ---------------------- reporte de validación ----------------------
print('Archivos INFOCANA leidos: %d' % len(archivos))
print('Ingenios canonicos: %d' % len({c for c, _ in agg}))
print('Zafras: %s' % sorted({z for _, z in agg}))
print('Filas escritas en datos.csv: %d' % len(filas_out))
print()
print('--- Ingenios canonicos ---')
for canon in sorted({c for c, _ in agg}):
    variantes = sorted(nombres_originales[canon])
    extra = ('  <- variantes: ' + ' | '.join(variantes[:4])) if len(variantes) > 1 else ''
    print('%s%s' % (titulo(canon), extra))
print()
print('--- Totales nacionales por zafra (validacion) ---')
por_zafra = defaultdict(lambda: [0.0, 0.0, 0])
for (canon, zaf), v in agg.items():
    if v['sup'] > 0:
        por_zafra[zaf][0] += v['sup']
        por_zafra[zaf][1] += v['azu']
        por_zafra[zaf][2] += 1
for zaf in sorted(por_zafra):
    sup, azu, n = por_zafra[zaf]
    print('%s: ingenios=%d  superficie=%.0f ha  azucar=%.0f t' % (zaf, n, sup, azu))
