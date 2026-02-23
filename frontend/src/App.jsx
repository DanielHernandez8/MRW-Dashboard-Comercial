import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const MONTHS = [
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
  "diciembre"
];
const DONUT_COLORS = ["#0f6fff", "#00a676", "#f59e0b", "#ef4444", "#7c3aed", "#06b6d4", "#8b5cf6", "#84cc16"];
const CLIENT_EXPIRY_STORAGE_KEY = "mrw_client_expiry_dates_v1";

function money(value) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2
  }).format(value || 0);
}

function parseMesYear(label) {
  const text = String(label || "").toLowerCase().trim();
  const match = text.match(/^([a-záéíóúñ]+)\s+(\d{4})$/i);
  if (!match) return { key: Number.MAX_SAFE_INTEGER, month: "", year: 0 };
  const month = match[1].normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const year = Number(match[2]);
  const monthIdx = MONTHS.indexOf(month);
  return { key: year * 100 + (monthIdx >= 0 ? monthIdx + 1 : 99), month, year };
}

function downloadCsv(filename, rows) {
  const header = ["Comercial", "Cliente", "Mes", "Facturacion", "Comision"];
  const lines = [header.join(";")];
  for (const row of rows) {
    lines.push(
      [
        row.comercial,
        row.cliente,
        row.mes,
        String(row.facturacion_bruta).replace(".", ","),
        String(row.comision_eur).replace(".", ",")
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";")
    );
  }
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseIsoDate(value) {
  if (!value || typeof value !== "string") return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getExpiryInfo(expiryDate) {
  const targetDate = parseIsoDate(expiryDate);
  if (!targetDate) {
    return { monthsRemaining: null, status: "sin-fecha", label: "Sin fecha" };
  }
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((targetDate - todayDate) / 86400000);

  if (diffDays < 0) {
    return { monthsRemaining: 0, status: "vencida", label: "Vencida" };
  }

  let monthsRemaining = (targetDate.getFullYear() - todayDate.getFullYear()) * 12 + (targetDate.getMonth() - todayDate.getMonth());
  if (targetDate.getDate() < todayDate.getDate()) monthsRemaining -= 1;
  if (monthsRemaining < 0) monthsRemaining = 0;

  if (diffDays <= 30) {
    return { monthsRemaining, status: "por-vencer", label: "Por vencer" };
  }
  return { monthsRemaining, status: "activa", label: "Activa" };
}

function MultiTagPicker({ title, options, values, onChange, emptyText }) {
  function toggle(value) {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    onChange([...values, value]);
  }
  return (
    <section className="picker">
      <div className="picker-head">
        <h3>{title}</h3>
        <div className="picker-actions">
          <button type="button" className="link-btn" onClick={() => onChange(options)}>
            Seleccionar todo
          </button>
          <button type="button" className="link-btn" onClick={() => onChange([])}>
            Limpiar
          </button>
        </div>
      </div>
      {options.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="chip-grid">
          {options.map((item) => (
            <button key={item} type="button" className={`chip ${values.includes(item) ? "active" : ""}`} onClick={() => toggle(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SparkLine({ points, onPointClick, activeLabel }) {
  const width = 580;
  const height = 210;
  const pad = 26;
  const maxY = Math.max(1, ...points.map((p) => p.comision));
  const minX = 0;
  const maxX = Math.max(1, points.length - 1);
  const mapped = points.map((p, idx) => {
    const x = pad + ((idx - minX) / (maxX - minX || 1)) * (width - pad * 2);
    const y = height - pad - (p.comision / maxY) * (height - pad * 2);
    return { ...p, x, y };
  });
  const path = mapped.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${width} ${height}`} className="line-svg" role="img">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#d0dbed" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#d0dbed" />
        <path d={path} fill="none" stroke="#0f6fff" strokeWidth="3" />
        {mapped.map((p) => (
          <g key={p.label}>
            <circle
              cx={p.x}
              cy={p.y}
              r={activeLabel === p.label ? 6 : 4.3}
              className={`line-point ${activeLabel === p.label ? "active" : ""}`}
              onClick={() => onPointClick(p.label)}
            />
          </g>
        ))}
      </svg>
      <div className="line-labels">
        {points.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`line-label ${activeLabel === p.label ? "active" : ""}`}
            onClick={() => onPointClick(p.label)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [commissionRate, setCommissionRate] = useState(5);
  const [selectedComerciales, setSelectedComerciales] = useState([]);
  const [selectedMeses, setSelectedMeses] = useState([]);
  const [inspectData, setInspectData] = useState(null);
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState("");
  const [drillComercial, setDrillComercial] = useState("");
  const [drillMes, setDrillMes] = useState("");
  const [drillCliente, setDrillCliente] = useState("");
  const [objectives, setObjectives] = useState({});
  const [clientExpiryDates, setClientExpiryDates] = useState(() => {
    try {
      const saved = localStorage.getItem(CLIENT_EXPIRY_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });

  const options = useMemo(() => inspectData?.options || { comerciales: [], meses: [] }, [inspectData]);

  const filteredRows = useMemo(() => {
    const rows = result?.rows || [];
    return rows.filter((r) => {
      if (drillComercial && r.comercial !== drillComercial) return false;
      if (drillMes && r.mes !== drillMes) return false;
      if (drillCliente && r.cliente !== drillCliente) return false;
      return true;
    });
  }, [result, drillComercial, drillMes, drillCliente]);

  const summary = useMemo(() => {
    const totals = filteredRows.reduce(
      (acc, r) => {
        acc.facturacion += r.facturacion_bruta;
        acc.comision += r.comision_eur;
        return acc;
      },
      { facturacion: 0, comision: 0 }
    );
    return { ...totals, registros: filteredRows.length };
  }, [filteredRows]);

  const timeline = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const prev = map.get(row.mes) || { label: row.mes, facturacion: 0, comision: 0 };
      prev.facturacion += row.facturacion_bruta;
      prev.comision += row.comision_eur;
      map.set(row.mes, prev);
    }
    return Array.from(map.values()).sort((a, b) => parseMesYear(a.label).key - parseMesYear(b.label).key);
  }, [filteredRows]);

  const byComercial = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      map.set(row.comercial, (map.get(row.comercial) || 0) + row.comision_eur);
    }
    const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
    return Array.from(map.entries())
      .map(([name, value], idx) => ({
        name,
        value,
        percent: total ? (value / total) * 100 : 0,
        color: DONUT_COLORS[idx % DONUT_COLORS.length]
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows]);

  const donutStyle = useMemo(() => {
    if (byComercial.length === 0) return { background: "#eef2f7" };
    let cursor = 0;
    const parts = byComercial.map((item) => {
      const start = cursor;
      cursor += item.percent;
      return `${item.color} ${start}% ${cursor}%`;
    });
    return { background: `conic-gradient(${parts.join(",")})` };
  }, [byComercial]);

  const byCliente = useMemo(() => {
    const map = new Map();
    for (const row of filteredRows) {
      const prev = map.get(row.cliente) || { cliente: row.cliente, facturacion: 0, comision: 0 };
      prev.facturacion += row.facturacion_bruta;
      prev.comision += row.comision_eur;
      map.set(row.cliente, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.comision - a.comision);
  }, [filteredRows]);

  const byClienteWithExpiry = useMemo(() => {
    return byCliente.map((row) => {
      const expiryDate = clientExpiryDates[row.cliente] || "";
      const expiryInfo = getExpiryInfo(expiryDate);
      return { ...row, expiryDate, ...expiryInfo };
    });
  }, [byCliente, clientExpiryDates]);

  const topClientes = useMemo(() => {
    const max = Math.max(1, ...(byCliente.slice(0, 10).map((c) => c.comision) || [1]));
    return byCliente.slice(0, 10).map((c) => ({ ...c, ratio: c.comision / max }));
  }, [byCliente]);

  const clienteMonthly = useMemo(() => {
    if (!drillCliente) return [];
    return timeline.map((t) => ({
      mes: t.label,
      facturacion: t.facturacion,
      comision: t.comision
    }));
  }, [drillCliente, timeline]);

  const groupedByComercial = useMemo(() => {
    const groups = new Map();
    for (const row of filteredRows) {
      const key = row.comercial;
      if (!groups.has(key)) groups.set(key, { comercial: key, facturacion: 0, comision: 0, clientes: new Map() });
      const group = groups.get(key);
      group.facturacion += row.facturacion_bruta;
      group.comision += row.comision_eur;
      const c = group.clientes.get(row.cliente) || { cliente: row.cliente, facturacion: 0, comision: 0 };
      c.facturacion += row.facturacion_bruta;
      c.comision += row.comision_eur;
      group.clientes.set(row.cliente, c);
    }
    return Array.from(groups.values())
      .map((g) => ({
        comercial: g.comercial,
        facturacion: g.facturacion,
        comision: g.comision,
        clientes: Array.from(g.clientes.values()).sort((a, b) => b.comision - a.comision)
      }))
      .sort((a, b) => b.comision - a.comision);
  }, [filteredRows]);

  const objectivesView = useMemo(() => {
    return byComercial.map((item) => {
      const goal = Number(objectives[item.name] || 0);
      const percent = goal > 0 ? Math.min(999, (item.value / goal) * 100) : 0;
      return { ...item, goal, percent };
    });
  }, [byComercial, objectives]);

  const periodComparison = useMemo(() => {
    if (timeline.length < 2) return null;
    let previous;
    let current;
    if (selectedMeses.length >= 2) {
      const sortedSelected = [...selectedMeses].sort((a, b) => parseMesYear(a).key - parseMesYear(b).key);
      const previousLabel = sortedSelected[0];
      const currentLabel = sortedSelected[sortedSelected.length - 1];
      previous = timeline.find((t) => t.label === previousLabel);
      current = timeline.find((t) => t.label === currentLabel);
      if (!previous || !current) return null;
    } else {
      previous = timeline[0];
      current = timeline[timeline.length - 1];
    }
    const delta = current.comision - previous.comision;
    const pct = previous.comision ? (delta / previous.comision) * 100 : 0;
    return { current, previous, delta, pct };
  }, [timeline, selectedMeses]);

  const alerts = useMemo(() => {
    if (timeline.length < 2) return [];
    let prev;
    let cur;
    if (selectedMeses.length >= 2) {
      const sortedSelected = [...selectedMeses].sort((a, b) => parseMesYear(a).key - parseMesYear(b).key);
      prev = sortedSelected[0];
      cur = sortedSelected[sortedSelected.length - 1];
    } else {
      cur = timeline[timeline.length - 1].label;
      prev = timeline[timeline.length - 2].label;
    }
    const curMap = new Map();
    const prevMap = new Map();
    for (const row of filteredRows) {
      if (row.mes === cur) curMap.set(row.cliente, (curMap.get(row.cliente) || 0) + row.facturacion_bruta);
      if (row.mes === prev) prevMap.set(row.cliente, (prevMap.get(row.cliente) || 0) + row.facturacion_bruta);
    }
    const drops = [];
    for (const [cliente, prevVal] of prevMap.entries()) {
      const curVal = curMap.get(cliente) || 0;
      const delta = curVal - prevVal;
      if (delta < 0) drops.push({ cliente, delta, prevVal, curVal, pct: prevVal ? (delta / prevVal) * 100 : 0 });
    }
    return drops.sort((a, b) => a.delta - b.delta).slice(0, 5);
  }, [filteredRows, timeline, selectedMeses]);

  const pagination = useMemo(() => {
    const totalRows = byClienteWithExpiry.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    return {
      safePage,
      totalPages,
      totalRows,
      rows: byClienteWithExpiry.slice(start, end),
      start: totalRows === 0 ? 0 : start + 1,
      end: Math.min(end, totalRows)
    };
  }, [byClienteWithExpiry, page, pageSize]);

  const expirySummary = useMemo(() => {
    return byClienteWithExpiry.reduce(
      (acc, row) => {
        if (row.status === "vencida") acc.vencidas += 1;
        else if (row.status === "por-vencer") acc.porVencer += 1;
        else if (row.status === "activa") acc.activas += 1;
        else acc.sinFecha += 1;
        return acc;
      },
      { vencidas: 0, porVencer: 0, activas: 0, sinFecha: 0 }
    );
  }, [byClienteWithExpiry]);

  const hasDrillFilters = Boolean(drillComercial || drillMes || drillCliente);

  function updateClientExpiry(cliente, value) {
    setClientExpiryDates((prev) => {
      const next = { ...prev };
      if (!value) delete next[cliente];
      else next[cliente] = value;
      return next;
    });
  }

  function resetForNewFile(nextFile) {
    setFile(nextFile);
    setInspectData(null);
    setResult(null);
    setSelectedComerciales([]);
    setSelectedMeses([]);
    setDrillComercial("");
    setDrillMes("");
    setDrillCliente("");
    setObjectives({});
    setError("");
    setPage(1);
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  function clearAllDrillFilters() {
    setDrillComercial("");
    setDrillMes("");
    setDrillCliente("");
  }

  async function loadDemoFile() {
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/commissions/demo-file`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || "No se pudo descargar el fichero de prueba.");
      }
      const blob = await response.blob();
      const demoFile = new File([blob], "demo_comerciales.xlsx", {
        type: blob.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      resetForNewFile(demoFile);
    } catch (err) {
      setError(err.message || "Error inesperado al cargar fichero de prueba.");
    }
  }

  async function loadExcel(fileToLoad = file) {
    if (!fileToLoad) {
      setError("Debes seleccionar un Excel.");
      return;
    }
    const data = new FormData();
    data.append("file", fileToLoad);
    setInspecting(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/commissions/inspect`, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo cargar el Excel.");
      setInspectData(payload);
      setSelectedComerciales([]);
      setSelectedMeses([]);
    } catch (err) {
      setInspectData(null);
      setError(err.message || "Error inesperado al cargar Excel.");
    } finally {
      setInspecting(false);
    }
  }

  async function analyze(event) {
    if (event) event.preventDefault();
    if (!file) {
      setError("Debes seleccionar un Excel.");
      return;
    }
    const data = new FormData();
    data.append("file", file);
    data.append("commission_rate", String(commissionRate));
    data.append("comerciales_json", JSON.stringify(selectedComerciales));
    data.append("meses_json", JSON.stringify(selectedMeses));
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/commissions/analyze`, { method: "POST", body: data });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "No se pudo analizar el Excel.");
      setResult(payload);
      setDrillComercial("");
      setDrillMes("");
      setDrillCliente("");
      setPage(1);
    } catch (err) {
      setResult(null);
      setError(err.message || "Error inesperado durante el analisis.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!file) return;
    loadExcel(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    if (!file || !inspectData || inspecting) return;
    const t = setTimeout(() => {
      analyze();
    }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectData, commissionRate, selectedComerciales, selectedMeses]);

  useEffect(() => {
    localStorage.setItem(CLIENT_EXPIRY_STORAGE_KEY, JSON.stringify(clientExpiryDates));
  }, [clientExpiryDates]);

  return (
    <main className="layout">
      <section className="hero">
        <div className="brand-head">
          <img src="/mrw-logo.png" alt="MRW" className="brand-mark" />
        </div>
        <p className="eyebrow">MRW Comercial</p>
        <h1>Panel de comisiones</h1>
        <p className="subtitle">Dashboard completo con tendencias, filtros cruzados, alertas y detalle paginado.</p>
      </section>

      <section className="panel top-card">
        <form onSubmit={analyze} className="top-form">
          <div className="upload-wrap">
            <p className="upload-label">Archivo Excel</p>
            <div className="upload-box">
              <div className="upload-meta">
                <strong>{file ? file.name : "Ningun archivo seleccionado"}</strong>
                <span>Formatos: .xlsx, .xls</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden-file-input" onChange={(e) => resetForNewFile(e.target.files?.[0] || null)} />
              <button type="button" className="secondary" onClick={pickFile}>
                Elegir archivo
              </button>
              <button type="button" className="secondary" onClick={loadDemoFile}>
                Cargar fichero de prueba
              </button>
            </div>
          </div>

          <label>
            Comision (%)
            <input type="number" min="0" step="0.01" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} />
          </label>

          <button type="button" className="secondary" disabled>
            {inspecting ? "Cargando archivo..." : loading ? "Actualizando..." : "Auto"}
          </button>
          <button type="submit" disabled style={{ opacity: 0.6 }}>
            En caliente
          </button>
        </form>

        {inspectData && (
          <p className="loaded-meta">
            Archivo: <strong>{inspectData.filename}</strong> | Filas: <strong>{inspectData.rows_detected}</strong>
          </p>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      <section className="filters-grid">
        <div className="panel">
          <MultiTagPicker title="Comerciales" options={options.comerciales} values={selectedComerciales} onChange={setSelectedComerciales} emptyText="Primero carga el archivo para ver comerciales." />
        </div>
        <div className="panel">
          <MultiTagPicker title="Meses/Año" options={options.meses} values={selectedMeses} onChange={setSelectedMeses} emptyText="Primero carga el archivo para ver meses/año." />
        </div>
      </section>

      {result && (
        <section className="results">
          <div className="kpis">
            <article>
              <h3>Facturacion bruta</h3>
              <p>{money(summary.facturacion)}</p>
            </article>
            <article>
              <h3>Comision total</h3>
              <p>{money(summary.comision)}</p>
            </article>
            <article>
              <h3>Registros</h3>
              <p>{summary.registros}</p>
            </article>
          </div>

          {periodComparison && (
            <section className="panel comparison">
              <h2>Comparativa periodo</h2>
              <p>
                {periodComparison.previous.label} vs {periodComparison.current.label}:{" "}
                <strong className={periodComparison.delta >= 0 ? "pos" : "neg"}>
                  {money(periodComparison.delta)} ({periodComparison.pct.toFixed(1)}%)
                </strong>
              </p>
            </section>
          )}

          {hasDrillFilters && (
            <section className="panel active-filters">
              <div className="active-filters-head">
                <strong>Vista filtrada</strong>
                <button type="button" className="secondary" onClick={clearAllDrillFilters}>
                  Volver a vista completa
                </button>
              </div>
              <div className="active-filters-chips">
                {drillComercial && (
                  <button type="button" className="chip chip-clear" onClick={() => setDrillComercial("")}>
                    Comercial: {drillComercial} ×
                  </button>
                )}
                {drillMes && (
                  <button type="button" className="chip chip-clear" onClick={() => setDrillMes("")}>
                    Mes: {drillMes} ×
                  </button>
                )}
                {drillCliente && (
                  <button type="button" className="chip chip-clear" onClick={() => setDrillCliente("")}>
                    Cliente: {drillCliente} ×
                  </button>
                )}
              </div>
            </section>
          )}

          <div className="split">
            <div className="panel">
              <h2>Tendencia mensual (comision)</h2>
              <SparkLine points={timeline} activeLabel={drillMes} onPointClick={(label) => setDrillMes((m) => (m === label ? "" : label))} />
            </div>
            <div className="panel donut-panel">
              <h2>Distribucion por comercial</h2>
              <div className="donut-wrap">
                <div className="donut" style={donutStyle} />
                <ul className="legend-list">
                  {byComercial.map((item) => (
                    <li key={item.name}>
                      <button type="button" className={`legend-btn ${drillComercial === item.name ? "active" : ""}`} onClick={() => setDrillComercial((v) => (v === item.name ? "" : item.name))}>
                        <span className="dot" style={{ background: item.color }} />
                        <span>{item.name}</span>
                        <strong>{money(item.value)}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {drillCliente && (
            <section className="panel">
              <h2>Facturacion y comision mensual de: {drillCliente}</h2>
              <div className="table-wrap small-table">
                <table>
                  <thead>
                    <tr>
                      <th>Mes/Año</th>
                      <th>Facturacion</th>
                      <th>Comision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clienteMonthly.map((row) => (
                      <tr key={`${drillCliente}-${row.mes}`}>
                        <td>{row.mes}</td>
                        <td>{money(row.facturacion)}</td>
                        <td>{money(row.comision)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="split">
            <div className="panel">
              <h2>Top clientes (comision)</h2>
              <div className="bars">
                {topClientes.map((c) => (
                  <button key={c.cliente} type="button" className={`bar-row ${drillCliente === c.cliente ? "active" : ""}`} onClick={() => setDrillCliente((v) => (v === c.cliente ? "" : c.cliente))}>
                    <span className="bar-label">{c.cliente}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${Math.max(5, c.ratio * 100)}%` }} />
                    </span>
                    <strong>{money(c.comision)}</strong>
                  </button>
                ))}
              </div>
            </div>
            <div className="panel">
              <h2>Objetivos por comercial</h2>
              <div className="goals">
                {objectivesView.map((item) => (
                  <div key={item.name} className="goal-row">
                    <div className="goal-head">
                      <span>{item.name}</span>
                      <strong>{money(item.value)}</strong>
                    </div>
                    <label>
                      Objetivo
                      <input
                        type="number"
                        min="0"
                        placeholder="Ej. 3000"
                        value={objectives[item.name] ?? ""}
                        onChange={(e) => setObjectives((prev) => ({ ...prev, [item.name]: e.target.value }))}
                      />
                    </label>
                    <div className="goal-progress">
                      <div className="goal-progress-fill" style={{ width: `${Math.min(100, item.percent)}%` }} />
                    </div>
                    <small>{item.goal > 0 ? `${item.percent.toFixed(1)}% cumplido` : "Define objetivo"}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <section className="panel">
            <div className="section-head">
              <h2>Alertas de caida (clientes)</h2>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const stamp = new Date().toISOString().slice(0, 10);
                  downloadCsv(`comisiones_${stamp}.csv`, filteredRows);
                }}
              >
                Exportar CSV
              </button>
            </div>
            {alerts.length === 0 ? (
              <p className="muted">No hay caidas detectadas entre los dos ultimos periodos.</p>
            ) : (
              <ul className="mini-list">
                {alerts.map((a) => (
                  <li key={a.cliente}>
                    <span>{a.cliente}</span>
                    <strong className="neg">
                      {money(a.delta)} ({a.pct.toFixed(1)}%)
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel table-panel">
            <h2>Resumen agrupado por comercial</h2>
            <div className="group-table-wrap">
              {groupedByComercial.map((group) => (
                <details key={group.comercial}>
                  <summary>
                    <span>{group.comercial}</span>
                    <span>{money(group.comision)}</span>
                  </summary>
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th>Facturacion</th>
                        <th>Comision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.clientes.slice(0, 20).map((c) => (
                        <tr key={`${group.comercial}-${c.cliente}`}>
                          <td>{c.cliente}</td>
                          <td>{money(c.facturacion)}</td>
                          <td>{money(c.comision)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ))}
            </div>
          </section>

          <section className="panel table-panel">
            <div className="section-head">
              <h2>Detalle por cliente (paginado)</h2>
              <div className="expiry-summary">
                <span className="badge expiry-activa">Activas: {expirySummary.activas}</span>
                <span className="badge expiry-por-vencer">Por vencer: {expirySummary.porVencer}</span>
                <span className="badge expiry-vencida">Vencidas: {expirySummary.vencidas}</span>
                <span className="badge expiry-sin-fecha">Sin fecha: {expirySummary.sinFecha}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Caduca comision</th>
                    <th>Meses restantes</th>
                    <th>Estado</th>
                    <th>Facturacion</th>
                    <th>Comision</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.rows.map((row) => (
                    <tr key={row.cliente}>
                      <td>{row.cliente}</td>
                      <td>
                        <input
                          type="date"
                          className="date-input"
                          value={row.expiryDate}
                          onChange={(e) => updateClientExpiry(row.cliente, e.target.value)}
                        />
                      </td>
                      <td>{row.monthsRemaining === null ? "-" : `${row.monthsRemaining} mes(es)`}</td>
                      <td>
                        <span className={`badge expiry-${row.status}`}>{row.label}</span>
                      </td>
                      <td>{money(row.facturacion)}</td>
                      <td>{money(row.comision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <div className="pager-info">
                Mostrando {pagination.start}-{pagination.end} de {pagination.totalRows}
              </div>
              <div className="pager-actions">
                <label>
                  Filas/pag
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button type="button" className="secondary" disabled={pagination.safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Anterior
                </button>
                <span className="pager-page">
                  Pag {pagination.safePage} / {pagination.totalPages}
                </span>
                <button type="button" className="secondary" disabled={pagination.safePage >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}>
                  Siguiente
                </button>
              </div>
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
