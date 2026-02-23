# MRW Comercial App

Aplicación web para analizar comisiones comerciales de MRW a partir de un Excel de ventas por cliente.

## Qué hace

- Subida de Excel (`.xlsx` o `.xls`).
- Inspección interna del Excel para generar desplegables de `comercial` y `mes`.
- Detección automática de dos formatos:
  - Formato largo: columnas tipo `Comercial`, `Cliente`, `Mes`, `Facturación`.
  - Formato ancho: columnas por mes (`Enero`, `Febrero`, ...), más `Comercial` y `Cliente`.
- Filtro por `comercial` y `mes`.
- Comisión configurable en `%`.
- Cálculo de:
  - Facturación bruta total.
  - Comisión total en euros.
  - Tabla detallada por cliente.
- Dashboard visual:
  - Tendencia mensual de comisión.
  - Donut de distribución por comercial.
  - Top clientes por comisión.
  - Comparativa entre los dos últimos periodos.
  - Alertas de caída por cliente.
  - Objetivos por comercial con % de cumplimiento.
  - Exportación CSV de filas filtradas.

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
3. Selecciona uno o varios `Comerciales` y uno o varios `Meses/Año` (por ejemplo `enero 2025`, `enero 2026`).
4. Ajusta `% Comision`.
5. Pulsa `Calcular comisiones`.

## Ejemplo de cálculo

Si un cliente factura `1000 EUR` y la comisión es `5%`, la comisión correcta es `50 EUR`.
