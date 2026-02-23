# MRW Comercial App

Aplicacion web para analizar comisiones comerciales de MRW a partir de un Excel de ventas por cliente.

## Que hace

- Subida de Excel (`.xlsx` o `.xls`).
- Inspeccion interna del Excel para generar desplegables de `comercial` y `mes`.
- Deteccion automatica de dos formatos:
  - Formato largo: columnas tipo `Comercial`, `Cliente`, `Mes`, `Facturacion`.
  - Formato ancho: columnas por mes (`Enero`, `Febrero`, ...), mas `Comercial` y `Cliente`.
- Filtro por `comercial` y `mes`.
- Comision configurable en `%`.
- Calculo de:
  - Facturacion bruta total.
  - Comision total en euros.
  - Tabla detallada por cliente.
- Dashboard visual:
  - Tendencia mensual de comision.
  - Donut de distribucion por comercial.
  - Top clientes por comision.
  - Comparativa entre los dos ultimos periodos.
  - Alertas de caida por cliente.
  - Objetivos por comercial con % de cumplimiento.
  - Exportacion CSV de filas filtradas.

## Estructura

- `backend/`: API FastAPI para leer Excel y calcular comisiones.
- `frontend/`: interfaz React + Vite.

## Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API disponible en `http://127.0.0.1:8000`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend disponible en `http://127.0.0.1:5173`.

## Flujo de uso

1. Selecciona el Excel.
2. Pulsa `Cargar archivo`.
3. Selecciona uno o varios `Comerciales` y uno o varios `Meses/Ano` (por ejemplo `enero 2025`, `enero 2026`).
4. Ajusta `% Comision`.
5. Pulsa `Calcular comisiones`.

### Estructura esperada del Excel

La app soporta dos estructuras:

- Formato largo:
  - Columnas equivalentes a `Comercial`, `Cliente`, `Mes`, `Facturacion` (tambien funcionan nombres similares).
  - Cada fila representa un cliente en un mes.
- Formato ancho:
  - Columnas equivalentes a `Comercial` y `Cliente`.
  - Una columna por mes (por ejemplo `Enero 2025`, `Febrero 2025`, etc.).
  - Cada fila representa un cliente con sus importes repartidos por columnas mensuales.

La deteccion de columnas es flexible: puedes adaptar la app a distintos archivos y necesidades de cada empresa mediante el mapping de columnas, sin cambiar el flujo general de uso.

## Ejemplo de calculo

Si un cliente factura `1000 EUR` y la comision es `5%`, la comision correcta es `50 EUR`.

## LIVE DEMO
https://mrw-dashboard-comercial.vercel.app

##Levantar Backend
https://mrw-dashboard-comercial.onrender.com

