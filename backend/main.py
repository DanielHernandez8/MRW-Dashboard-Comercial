from __future__ import annotations

import io
import json
import re
import unicodedata
import warnings
from calendar import month_name
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="MRW Commissions API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAPPING_FILE = Path(__file__).with_name("saved_mapping.json")

MONTHS_ES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]

MONTH_ALIAS = {
    "ene": "enero",
    "feb": "febrero",
    "mar": "marzo",
    "abr": "abril",
    "may": "mayo",
    "jun": "junio",
    "jul": "julio",
    "ago": "agosto",
    "sep": "septiembre",
    "set": "septiembre",
    "oct": "octubre",
    "nov": "noviembre",
    "dic": "diciembre",
}


def normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"
    )
    text = re.sub(r"\s+", " ", text)
    return text


def normalize_month(value: Any) -> str:
    raw = normalize_text(value)
    if not raw:
        return ""
    if raw in MONTHS_ES:
        return raw
    if raw in MONTH_ALIAS:
        return MONTH_ALIAS[raw]
    for idx, name in enumerate(MONTHS_ES, start=1):
        if raw == str(idx):
            return name
    for idx in range(1, 13):
        if raw == normalize_text(month_name[idx]):
            return MONTHS_ES[idx - 1]
    for month in MONTHS_ES:
        if raw.startswith(f"{month} ") or raw.startswith(f"{month}-") or raw.startswith(f"{month}/"):
            return month
    for alias, month in MONTH_ALIAS.items():
        if raw.startswith(f"{alias} ") or raw.startswith(f"{alias}-") or raw.startswith(f"{alias}/"):
            return month
    compact = re.fullmatch(r"(0?[1-9]|1[0-2])([/-]\d{2,4})?", raw)
    if compact:
        return MONTHS_ES[int(compact.group(1)) - 1]
    return raw


def extract_year(value: Any) -> int | None:
    if value is None:
        return None
    if hasattr(value, "year") and hasattr(value, "month"):
        try:
            year = int(value.year)
            if 1900 <= year <= 2100:
                return year
        except Exception:  # noqa: BLE001
            pass
    match = re.search(r"\b(19\d{2}|20\d{2}|21\d{2})\b", str(value))
    if match:
        return int(match.group(1))
    return None


def normalize_month_year(value: Any, fallback_year: int | None = None) -> str:
    month = normalize_month(value)
    if month not in MONTHS_ES:
        return ""
    year = extract_year(value) or fallback_year
    return f"{month} {year}" if year else month


def month_year_sort_key(label: str) -> tuple[int, int, str]:
    normalized = normalize_text(label)
    year = extract_year(normalized) or 0
    month = normalize_month(normalized)
    month_idx = MONTHS_ES.index(month) + 1 if month in MONTHS_ES else 99
    return (year, month_idx, normalized)


def find_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    normalized = {normalize_text(col): col for col in df.columns}
    for candidate in candidates:
        if candidate in normalized:
            return normalized[candidate]
    for key, original in normalized.items():
        for candidate in candidates:
            if candidate in key:
                return original
    return None


def parse_number(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    if normalize_text(text) in {"nan", "none", "null"}:
        return 0.0
    text = text.replace("€", "").replace(" ", "")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def month_columns(df: pd.DataFrame) -> list[str]:
    result: list[str] = []
    for col in df.columns:
        if normalize_month(col) in MONTHS_ES:
            result.append(col)
    return result


def clean_text_series(series: pd.Series) -> pd.Series:
    cleaned = series.fillna("").map(str).str.strip()
    cleaned = cleaned.replace(to_replace=r"(?i)^(nan|none|null)$", value="", regex=True)
    return cleaned


def read_excel_df(content: bytes, filename: str) -> pd.DataFrame:
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="El archivo debe ser Excel (.xlsx o .xls).")
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message="Workbook contains no default style, apply openpyxl's default",
                category=UserWarning,
            )
            return pd.read_excel(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"No pude leer el Excel: {exc}") from exc


def detect_mapping(df: pd.DataFrame) -> dict[str, Any]:
    salesperson_col = find_column(
        df,
        [
            "comercial",
            "nombre comercial",
            "vendedor",
            "agente",
            "salesperson",
            "asesor",
            "gestor",
        ],
    )
    client_col = find_column(
        df,
        [
            "cliente",
            "nombre cliente",
            "cuenta",
            "customer",
            "razon social",
            "empresa",
            "destinatario",
        ],
    )
    month_col = find_column(df, ["mes", "month"])
    revenue_col = find_column(
        df,
        ["facturacion bruta", "facturacion", "ventas", "importe", "total", "revenue"],
    )
    m_cols = month_columns(df)
    structure = "long" if month_col and revenue_col else "wide" if m_cols else "unknown"
    return {
        "structure": structure,
        "comercial": salesperson_col or "",
        "cliente": client_col or "",
        "mes": month_col or "",
        "facturacion": revenue_col or "",
        "month_columns": m_cols,
    }


def sanitize_mapping(mapping: dict[str, Any], available_columns: list[str]) -> dict[str, Any]:
    allowed = set(available_columns)

    def pick(col: Any) -> str:
        return col if isinstance(col, str) and col in allowed else ""

    month_cols_raw = mapping.get("month_columns", [])
    month_cols = []
    if isinstance(month_cols_raw, list):
        month_cols = [col for col in month_cols_raw if isinstance(col, str) and col in allowed]

    structure = mapping.get("structure", "unknown")
    if structure not in {"long", "wide", "unknown"}:
        structure = "unknown"

    return {
        "structure": structure,
        "comercial": pick(mapping.get("comercial")),
        "cliente": pick(mapping.get("cliente")),
        "mes": pick(mapping.get("mes")),
        "facturacion": pick(mapping.get("facturacion")),
        "month_columns": month_cols,
    }


def normalize_dataset(df: pd.DataFrame, mapping: dict[str, Any] | None = None) -> pd.DataFrame:
    detected = detect_mapping(df)
    columns = df.columns.astype(str).tolist()
    user_mapping = sanitize_mapping(mapping or {}, columns)

    salesperson_col = user_mapping["comercial"] or detected["comercial"]
    client_col = user_mapping["cliente"] or detected["cliente"]
    month_col = user_mapping["mes"] or detected["mes"]
    revenue_col = user_mapping["facturacion"] or detected["facturacion"]
    m_cols = user_mapping["month_columns"] or detected["month_columns"]
    structure = user_mapping["structure"]

    # Fallback defensivo para excels con cabeceras raras:
    # si detectamos columnas de meses pero no comercial/cliente, usamos las dos primeras columnas no-mes.
    if (not salesperson_col or not client_col) and detected["month_columns"]:
        month_set = set(detected["month_columns"])
        non_month = [str(c) for c in df.columns if str(c) not in month_set and normalize_text(c) != "total"]
        if len(non_month) >= 2:
            salesperson_col = salesperson_col or non_month[0]
            client_col = client_col or non_month[1]

    if not salesperson_col or not client_col:
        raise HTTPException(
            status_code=400,
            detail=(
                "No pude detectar columnas de comercial y cliente. "
                "Asegura cabeceras tipo 'Nombre Comercial' y 'Razón Social' o similar."
            ),
        )

    if structure == "unknown":
        structure = "long" if month_col and revenue_col else "wide"

    if structure == "long":
        if not month_col or not revenue_col:
            raise HTTPException(
                status_code=400,
                detail="Para formato long debes indicar las columnas de mes y facturacion.",
            )
        normalized = pd.DataFrame(
            {
                "comercial": clean_text_series(df[salesperson_col].ffill()),
                "cliente": clean_text_series(df[client_col]),
                "mes": df[month_col].map(normalize_month_year),
                "facturacion_bruta": df[revenue_col].map(parse_number),
            }
        )
    else:
        if not m_cols:
            raise HTTPException(
                status_code=400,
                detail="Para formato wide debes seleccionar columnas de meses.",
            )
        base = df[[salesperson_col, client_col]].copy()
        normalized = pd.concat(
            [
                pd.DataFrame(
                    {
                        "comercial": clean_text_series(base[salesperson_col].ffill()),
                        "cliente": clean_text_series(base[client_col]),
                        "mes": normalize_month_year(col),
                        "facturacion_bruta": df[col].map(parse_number),
                    }
                )
                for col in m_cols
            ],
            ignore_index=True,
        )

    normalized = normalized[normalized["comercial"] != ""]
    normalized = normalized[normalized["cliente"] != ""]
    normalized = normalized[normalized["mes"] != ""]
    normalized = normalized[normalized["facturacion_bruta"] > 0]
    return normalized


def rows_preview(df: pd.DataFrame, limit: int = 5) -> list[dict[str, str]]:
    preview = df.head(limit).copy()
    for col in preview.columns:
        preview[col] = preview[col].map(lambda value: "" if pd.isna(value) else str(value))
    return preview.to_dict(orient="records")


def dataframe_columns(df: pd.DataFrame) -> list[str]:
    return df.columns.astype(str).tolist()


def build_filter_options(normalized: pd.DataFrame) -> dict[str, list[str]]:
    return {
        "comerciales": sorted(normalized["comercial"].dropna().unique().tolist()),
        "meses": sorted(normalized["mes"].dropna().unique().tolist(), key=month_year_sort_key),
    }


def parse_json_filter_list(raw_json: str | None, field_name: str) -> list[str]:
    if not raw_json:
        return []
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Filtro {field_name} invalido: {exc}") from exc
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def get_saved_mapping() -> dict[str, Any] | None:
    if not MAPPING_FILE.exists():
        return None
    try:
        data = json.loads(MAPPING_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        return None
    return None


def parse_mapping_json(mapping_json: str | None) -> dict[str, Any] | None:
    if not mapping_json:
        return None
    try:
        data = json.loads(mapping_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"JSON de mapping invalido: {exc}") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="El mapping debe ser un objeto JSON.")
    return data


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/commissions/mapping")
def mapping_get() -> dict[str, Any]:
    return {"mapping": get_saved_mapping()}


@app.post("/api/commissions/mapping/save")
def mapping_save(mapping: dict[str, Any]) -> dict[str, Any]:
    MAPPING_FILE.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": True}


@app.post("/api/commissions/inspect")
async def inspect(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(None),
) -> dict[str, Any]:
    filename = file.filename or ""
    content = await file.read()
    df = read_excel_df(content, filename)
    detected = detect_mapping(df)
    provided_mapping = parse_mapping_json(mapping_json)
    saved_mapping = get_saved_mapping()
    effective_input = provided_mapping or saved_mapping
    columns = dataframe_columns(df)
    effective_mapping = sanitize_mapping(effective_input or detected, columns)

    normalized = normalize_dataset(df, mapping=effective_mapping)
    options = build_filter_options(normalized)

    return {
        "filename": filename,
        "columns": columns,
        "detected_mapping": sanitize_mapping(detected, columns),
        "active_mapping": effective_mapping,
        "saved_mapping": sanitize_mapping(saved_mapping, columns) if saved_mapping else None,
        "rows_detected": int(len(normalized)),
        "preview_rows": rows_preview(df, 5),
        "options": options,
    }


@app.post("/api/commissions/analyze")
async def analyze(
    file: UploadFile = File(...),
    commission_rate: float = Form(5.0),
    comercial: str | None = Form(None),
    mes: str | None = Form(None),
    comerciales_json: str | None = Form(None),
    meses_json: str | None = Form(None),
    mapping_json: str | None = Form(None),
) -> dict[str, Any]:
    if commission_rate < 0:
        raise HTTPException(status_code=400, detail="La comision no puede ser negativa.")

    filename = file.filename or ""
    content = await file.read()
    df = read_excel_df(content, filename)
    provided_mapping = parse_mapping_json(mapping_json)
    saved_mapping = get_saved_mapping()
    mapping = provided_mapping or saved_mapping

    normalized = normalize_dataset(df, mapping=mapping)
    options = build_filter_options(normalized)

    comerciales = parse_json_filter_list(comerciales_json, "comerciales_json")
    meses = parse_json_filter_list(meses_json, "meses_json")

    if not comerciales and comercial:
        comerciales = [comercial]
    if not meses and mes:
        meses = [mes]

    if comerciales:
        target_comerciales = {normalize_text(c) for c in comerciales}
        normalized = normalized[normalized["comercial"].map(normalize_text).isin(target_comerciales)]
    if meses:
        target_meses = {normalize_text(m) for m in meses}
        normalized = normalized[normalized["mes"].map(normalize_text).isin(target_meses)]

    normalized = normalized.copy()
    normalized["comision_eur"] = normalized["facturacion_bruta"] * (commission_rate / 100.0)
    total_facturacion = round(float(normalized["facturacion_bruta"].sum()), 2)
    total_comision = round(float(normalized["comision_eur"].sum()), 2)

    rows = []
    for _, row in normalized.iterrows():
        rows.append(
            {
                "comercial": row["comercial"],
                "cliente": row["cliente"],
                "mes": row["mes"],
                "facturacion_bruta": round(float(row["facturacion_bruta"]), 2),
                "comision_eur": round(float(row["comision_eur"]), 2),
            }
        )

    return {
        "commission_rate": commission_rate,
        "filters": {
            "comercial": comercial or "",
            "mes": mes or "",
            "comerciales": comerciales,
            "meses": meses,
        },
        "totals": {
            "facturacion_bruta": total_facturacion,
            "comision_eur": total_comision,
            "registros": len(rows),
        },
        "options": options,
        "rows": rows,
    }
