/* global React, ReactDOM */
(() => {
  const { useEffect, useMemo, useState } = React;

  // ========== BASE_URL y helpers de URL ==========
  const BASE_URL =
    (document.querySelector('meta[name="base-url"]')?.content || '').trim() ||
    (typeof window !== 'undefined' && window.__BASE_URL__) ||
    (typeof window !== 'undefined' && window.location.origin) ||
    '';

  const absUrl = (u) => {
    if (!u) return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return `${BASE_URL}${u}`;
    return `${BASE_URL}/${u}`;
  };

  // ========== Auth & Fetch helpers ==========
  const getToken = () =>
    sessionStorage.getItem('token') ||
    localStorage.getItem('token') ||
    '';

  // Verificar autenticación y expiración del token
  const checkAuth = () => {
    const token = getToken();
    if (!token) {
      sessionStorage.clear();
      window.location.href = '/login';
      return false;
    }

    // Verificar si el token está expirado
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expirationTime = payload.exp * 1000;
      const currentTime = Date.now();

      if (currentTime >= expirationTime) {
        console.log('Token expirado, redirigiendo a login...');
        sessionStorage.clear();
        window.location.href = '/login';
        return false;
      }
    } catch (error) {
      console.error('Error al verificar el token:', error);
      sessionStorage.clear();
      window.location.href = '/login';
      return false;
    }

    return true;
  };

  const authHeaders = () => {
    const t = getToken();
    return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
  };

  // Verificar token al cargar
  if (!checkAuth()) {
    return;
  }

  // Verificar token cada 30 segundos
  setInterval(() => {
    checkAuth();
  }, 30000);

  const fetchJSON = async (url, opts = {}) => {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = '';
      try { msg = await res.text(); } catch { }
      throw new Error(msg || `HTTP ${res.status}`);
    }
    return res.json();
  };

  // ========== UI comunes ==========
  const Pill = ({ children, color = 'blue' }) => {
    const colors = {
      blue: 'bg-blue-50 text-blue-700 border-blue-200',
      green: 'bg-green-50 text-green-700 border-green-200',
      purple: 'bg-purple-50 text-purple-700 border-purple-200',
      orange: 'bg-orange-50 text-orange-700 border-orange-200'
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${colors[color] || colors.blue}`}>
        {children}
      </span>
    );
  };

  const L = ({ label, children }) => (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );

  const Input = (props) => (
    <input
      {...props}
      className={`w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400 ${props.className || ''}`}
    />
  );

  const Toggle = ({ label, checked, onChange }) => (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className="size-4 accent-blue-600"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );

  // ========== Toast mínimo ==========
  const Toast = ({ text, onClose }) => (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-black/80 px-4 py-2 text-sm text-white shadow">
      {text}
      <button className="ml-3 rounded bg-white/10 px-2 py-0.5" onClick={onClose}>OK</button>
    </div>
  );

  // ========== Modal ==========
  function Modal({ open, title, onClose, children, footer, wide }) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className={`w-full ${wide ? 'max-w-6xl' : 'max-w-4xl'} rounded-2xl bg-white shadow-xl`}>
          <div className="flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="rounded-md p-1 text-gray-500 hover:bg-gray-100" onClick={onClose}>✖</button>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========== MODAL DE CARGA MASIVA ==========
  function BulkUploadModal({ open, onClose, onSuccess }) {
    const [files, setFiles] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
    const [results, setResults] = useState([]);

    const handleFileChange = (e) => {
      setFiles(Array.from(e.target.files));
      setResults([]);
      setProgress({ current: 0, total: 0, status: '' });
    };

    const processFiles = async () => {
      if (!files.length) {
        alert('Selecciona al menos un archivo');
        return;
      }

      setProcessing(true);
      setProgress({ current: 0, total: files.length, status: 'Iniciando...' });
      const uploadedPromos = [];
      const errors = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ current: i + 1, total: files.length, status: `Procesando ${file.name}...` });

        try {
          // 1. Subir imagen
          const formData = new FormData();
          formData.append('files', file);

          const uploadRes = await fetch('/api/promos/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: formData
          });

          if (!uploadRes.ok) throw new Error('Error subiendo imagen');
          const { urls } = await uploadRes.json();
          const imageUrl = urls[0];

          // 2. Analizar con IA
          const analyzeRes = await fetchJSON('/api/promos/analyze', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ imageUrls: [absUrl(imageUrl)] })
          });

          const suggestion = analyzeRes.suggestion || {};

          // 3. Crear promo automáticamente
          const promoData = {
            titulo: suggestion.titulo || file.name,
            destino: suggestion.destino || '',
            descripcion: suggestion.descripcion || '',
            todo_incluido: !!suggestion.todo_incluido,
            con_transporte: !!suggestion.con_transporte,
            transporte_tipo: suggestion.transporte_tipo || 'camion',
            traslados: !!suggestion.traslados,
            incluye_desayuno_llegada: !!suggestion.incluye_desayuno_llegada,
            menores_gratis: !!suggestion.menores_gratis,
            menores_gratis_politica: suggestion.menores_gratis_politica || '',
            ninos_2x1: !!suggestion.ninos_2x1,
            entrega_anticipada: !!suggestion.entrega_anticipada,
            precio_adulto: suggestion.precio_adulto || null,
            precio_menor: suggestion.precio_menor || null,
            precio_bus_menor: suggestion.precio_bus_menor || null,
            fecha_salida: suggestion.fecha_salida || '',
            fecha_llegada: suggestion.fecha_llegada || '',
            reserva_inicio: suggestion.reserva_inicio || '',
            reserva_fin: suggestion.reserva_fin || '',
            imagenes: [absUrl(imageUrl)],
            activo: true
          };

          const createRes = await fetchJSON('/api/promos', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(promoData)
          });

          uploadedPromos.push({ file: file.name, success: true, promo: createRes.promo });
        } catch (error) {
          errors.push({ file: file.name, error: error.message });
        }
      }

      setResults({ uploaded: uploadedPromos, errors });
      setProgress({ current: files.length, total: files.length, status: '¡Completado!' });
      setProcessing(false);

      if (onSuccess) {
        setTimeout(() => onSuccess(), 1500);
      }
    };

    const reset = () => {
      setFiles([]);
      setResults([]);
      setProgress({ current: 0, total: 0, status: '' });
      setProcessing(false);
    };

    return (
      <Modal
        open={open}
        title="📦 Carga Masiva de Promos"
        onClose={onClose}
        wide
        footer={
          <>
            <button
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={processing}
            >
              Cerrar
            </button>
            {!processing && files.length > 0 && !results.uploaded && (
              <button
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                onClick={processFiles}
              >
                Procesar {files.length} archivo{files.length > 1 ? 's' : ''}
              </button>
            )}
            {results.uploaded && (
              <button
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                onClick={reset}
              >
                Cargar más
              </button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-blue-400 hover:bg-blue-50">
              <div className="text-4xl mb-2">📁</div>
              <div className="text-sm font-medium text-gray-700">
                Haz click para seleccionar flyers
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Soporta múltiples archivos JPG, PNG, WEBP
              </div>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                disabled={processing}
              />
            </label>
          </div>

          {files.length > 0 && !processing && !results.uploaded && (
            <div>
              <h3 className="text-sm font-semibold mb-2">Archivos seleccionados ({files.length}):</h3>
              <div className="max-h-40 overflow-y-auto rounded-lg border bg-gray-50 p-3 space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-blue-600">📄</span>
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-gray-500">{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {processing && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-900">{progress.status}</span>
                <span className="text-xs text-blue-700">{progress.current} / {progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-blue-200 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {results.uploaded && (
            <div className="space-y-3">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <h3 className="text-sm font-semibold text-green-900 mb-2">
                  ✅ Promos creadas exitosamente: {results.uploaded.length}
                </h3>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {results.uploaded.map((r, i) => (
                    <div key={i} className="text-xs text-green-700">
                      • {r.file} → <span className="font-medium">{r.promo.destino || 'Sin destino'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {results.errors && results.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <h3 className="text-sm font-semibold text-red-900 mb-2">
                    ❌ Errores: {results.errors.length}
                  </h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {results.errors.map((e, i) => (
                      <div key={i} className="text-xs text-red-700">
                        • {e.file}: {e.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  // ========== VISTA DE EXPLORADOR DE ARCHIVOS ==========
  function FileExplorerView({ promos, onEdit, onDelete, onDuplicate }) {
    const [viewMode, setViewMode] = useState('explorer'); // 'explorer' o 'grid'
    const [selectedDestino, setSelectedDestino] = useState(null);
    const [selectedMonth, setSelectedMonth] = useState(null);
    const [selectedWeek, setSelectedWeek] = useState(null);

    // Agrupar por destino
    const byDestino = useMemo(() => {
      const groups = {};
      promos.forEach(p => {
        const dest = p.destino || 'Sin destino';
        if (!groups[dest]) groups[dest] = [];
        groups[dest].push(p);
      });
      return groups;
    }, [promos]);

    // Agrupar por mes dentro de un destino
    const byMonth = useMemo(() => {
      if (!selectedDestino) return {};
      const groups = {};
      (byDestino[selectedDestino] || []).forEach(p => {
        const date = p.fecha_salida || p.created_at;
        if (!date) return;
        const monthKey = date.substring(0, 7); // YYYY-MM
        if (!groups[monthKey]) groups[monthKey] = [];
        groups[monthKey].push(p);
      });
      return groups;
    }, [selectedDestino, byDestino]);

    // Agrupar por semanas dentro de un mes
    const byWeek = useMemo(() => {
      if (!selectedMonth) return {};
      const groups = {};
      (byMonth[selectedMonth] || []).forEach(p => {
        const date = new Date(p.fecha_salida || p.created_at);
        const weekNum = Math.ceil(date.getDate() / 7);
        const weekKey = `Semana ${weekNum}`;
        if (!groups[weekKey]) groups[weekKey] = [];
        groups[weekKey].push(p);
      });
      return groups;
    }, [selectedMonth, byMonth]);

    const monthNames = {
      '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
      '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
      '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre'
    };

    const formatMonth = (monthKey) => {
      const [year, month] = monthKey.split('-');
      return `${monthNames[month]} ${year}`;
    };

    // Vista de explorador
    if (viewMode === 'explorer') {
      return (
        <div className="space-y-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                setSelectedDestino(null);
                setSelectedMonth(null);
                setSelectedWeek(null);
              }}
            >
              🏠 Destinos
            </button>
            {selectedDestino && (
              <>
                <span className="text-gray-400">/</span>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => {
                    setSelectedMonth(null);
                    setSelectedWeek(null);
                  }}
                >
                  📍 {selectedDestino}
                </button>
              </>
            )}
            {selectedMonth && (
              <>
                <span className="text-gray-400">/</span>
                <button
                  className="text-blue-600 hover:underline"
                  onClick={() => setSelectedWeek(null)}
                >
                  📅 {formatMonth(selectedMonth)}
                </button>
              </>
            )}
            {selectedWeek && (
              <>
                <span className="text-gray-400">/</span>
                <span className="text-gray-700">🗓️ {selectedWeek}</span>
              </>
            )}
          </div>

          {/* Lista de destinos */}
          {!selectedDestino && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.keys(byDestino).sort().map(dest => (
                <button
                  key={dest}
                  onClick={() => setSelectedDestino(dest)}
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 hover:border-blue-400 hover:shadow-lg transition-all"
                >
                  <div className="text-5xl">📂</div>
                  <div className="text-sm font-semibold text-gray-800 text-center">{dest}</div>
                  <Pill color="blue">{byDestino[dest].length} promo{byDestino[dest].length !== 1 ? 's' : ''}</Pill>
                </button>
              ))}
            </div>
          )}

          {/* Lista de meses */}
          {selectedDestino && !selectedMonth && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.keys(byMonth).sort().reverse().map(month => (
                <button
                  key={month}
                  onClick={() => setSelectedMonth(month)}
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 hover:border-purple-400 hover:shadow-lg transition-all"
                >
                  <div className="text-5xl">📅</div>
                  <div className="text-sm font-semibold text-gray-800 text-center">{formatMonth(month)}</div>
                  <Pill color="purple">{byMonth[month].length} promo{byMonth[month].length !== 1 ? 's' : ''}</Pill>
                </button>
              ))}
            </div>
          )}

          {/* Lista de semanas */}
          {selectedMonth && !selectedWeek && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.keys(byWeek).sort().map(week => (
                <button
                  key={week}
                  onClick={() => setSelectedWeek(week)}
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 hover:border-green-400 hover:shadow-lg transition-all"
                >
                  <div className="text-5xl">🗓️</div>
                  <div className="text-sm font-semibold text-gray-800">{week}</div>
                  <Pill color="green">{byWeek[week].length} promo{byWeek[week].length !== 1 ? 's' : ''}</Pill>
                </button>
              ))}
            </div>
          )}

          {/* Tarjetas de promos */}
          {selectedWeek && byWeek[selectedWeek] && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {byWeek[selectedWeek].map(p => (
                <Card key={p.id} promo={p} onEdit={onEdit} onDelete={onDelete} onDuplicate={onDuplicate} />
              ))}
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  // ========== Tarjeta de Promo ==========
  function Card({ promo: p, onEdit, onDelete, onDuplicate }) {
    const firstImg = Array.isArray(p.imagenes) && p.imagenes[0] ? absUrl(p.imagenes[0]) : '';
    return (
      <div className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-lg">
        {firstImg && (
          <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
            <img
              src={firstImg}
              alt={p.titulo || 'Promo'}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            {!p.activo && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">INACTIVA</span>
              </div>
            )}
          </div>
        )}
        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-800 line-clamp-1">{p.titulo || 'Sin título'}</h3>
            {p.destino && <Pill color="blue">{p.destino}</Pill>}
          </div>

          {p.descripcion && (
            <p className="text-xs text-gray-600 line-clamp-2">{p.descripcion}</p>
          )}

          <div className="flex flex-wrap gap-1 text-xs">
            {p.todo_incluido && <Pill color="green">Todo incluido</Pill>}
            {p.con_transporte && <Pill color="purple">Transporte</Pill>}
            {p.menores_gratis && <Pill color="orange">Menores gratis</Pill>}
          </div>

          {(p.fecha_salida || p.fecha_llegada) && (
            <div className="text-xs text-gray-500">
              📅 {p.fecha_salida || '?'} → {p.fecha_llegada || '?'}
            </div>
          )}

          {p.precio_adulto && (
            <div className="text-sm font-bold text-green-600">
              ${parseFloat(p.precio_adulto).toLocaleString()} MXN
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t">
            <button
              onClick={() => onEdit(p)}
              className="flex-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              ✏️ Editar
            </button>
            <button
              onClick={() => onDuplicate(p)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              title="Duplicar"
            >
              📋
            </button>
            <button
              onClick={() => onDelete(p)}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
              title="Eliminar"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========== Formulario ==========
  function PromoForm({ open, onClose, onSaved, initial }) {
    const [data, setData] = useState(initial || {
      titulo: '', destino: '', descripcion: '',
      todo_incluido: false, con_transporte: false, transporte_tipo: 'camion',
      traslados: false, incluye_desayuno_llegada: false,
      menores_gratis: false, menores_gratis_politica: '',
      ninos_2x1: false, entrega_anticipada: false,
      precio_adulto: '', precio_menor: '', precio_bus_menor: '',
      fecha_salida: '', fecha_llegada: '', reserva_inicio: '', reserva_fin: '',
      imagenes: [], activo: true
    });
    const [files, setFiles] = useState([]);
    const [newImgUrl, setNewImgUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState('');

    useEffect(() => {
      if (open) {
        setData(initial || {
          titulo: '', destino: '', descripcion: '',
          todo_incluido: false, con_transporte: false, transporte_tipo: 'camion',
          traslados: false, incluye_desayuno_llegada: false,
          menores_gratis: false, menores_gratis_politica: '',
          ninos_2x1: false, entrega_anticipada: false,
          precio_adulto: '', precio_menor: '', precio_bus_menor: '',
          fecha_salida: '', fecha_llegada: '', reserva_inicio: '', reserva_fin: '',
          imagenes: [], activo: true
        });
        setFiles([]);
        setNewImgUrl('');
        setToast('');
        setBusy(false);
      }
    }, [open, initial]);

    const onChange = (k, v) => setData((d) => ({ ...d, [k]: v }));

    const uploadFiles = async () => {
      if (!files?.length) return [];
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const res = await fetch('/api/promos/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form
      });
      if (!res.ok) throw new Error(await res.text());
      const { urls } = await res.json();
      return (urls || []).map(absUrl);
    };

    const addExternalUrl = () => {
      const u = (newImgUrl || '').trim();
      if (!/^https?:\/\//i.test(u)) {
        alert('La URL debe iniciar con http:// o https://');
        return;
      }
      setData(d => ({ ...d, imagenes: [...(d.imagenes || []), u] }));
      setNewImgUrl('');
    };

    const analyzeFromImages = async () => {
      try {
        setBusy(true);
        let urls = [];
        if (files.length > 0) {
          const uploaded = await uploadFiles();
          urls = uploaded;
          setData((d) => ({ ...d, imagenes: [...(d.imagenes || []), ...uploaded] }));
          setFiles([]);
        } else if (Array.isArray(data.imagenes) && data.imagenes.length > 0) {
          urls = data.imagenes.map(absUrl);
        } else {
          alert('Primero selecciona al menos una imagen o pega una URL.');
          return;
        }

        const r = await fetchJSON('/api/promos/analyze', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ imageUrls: urls.slice(0, 4) })
        });

        const s = r?.suggestion || {};
        let touched = [];

        setData((prev) => {
          const after = { ...prev };
          const setIfEmpty = (k, val) => {
            if (val == null) return;
            if (typeof prev[k] === 'string' && !prev[k]) { after[k] = val; touched.push(k); }
            else if (typeof prev[k] === 'boolean' && val === true && !prev[k]) { after[k] = true; touched.push(k); }
            else if (prev[k] == null || prev[k] === '') { after[k] = val; touched.push(k); }
          };

          setIfEmpty('titulo', s.titulo);
          setIfEmpty('destino', s.destino);
          setIfEmpty('descripcion', s.descripcion);
          setIfEmpty('transporte_tipo', s.transporte_tipo);
          ['todo_incluido', 'con_transporte', 'traslados', 'incluye_desayuno_llegada',
            'menores_gratis', 'ninos_2x1', 'entrega_anticipada'].forEach(k => setIfEmpty(k, !!s[k]));
          setIfEmpty('menores_gratis_politica', s.menores_gratis_politica);
          setIfEmpty('precio_adulto', s.precio_adulto ?? null);
          setIfEmpty('precio_menor', s.precio_menor ?? null);
          setIfEmpty('precio_bus_menor', s.precio_bus_menor ?? null);
          const dateOrEmpty = (v) => (typeof v === 'string' && v ? v : '');
          setIfEmpty('fecha_salida', dateOrEmpty(s.fecha_salida));
          setIfEmpty('fecha_llegada', dateOrEmpty(s.fecha_llegada));
          setIfEmpty('reserva_inicio', dateOrEmpty(s.reserva_inicio));
          setIfEmpty('reserva_fin', dateOrEmpty(s.reserva_fin));
          return after;
        });

        setToast(touched.length ? `Campos sugeridos: ${touched.join(', ')}` : 'No se detectó información nueva.');
      } catch (e) {
        alert(`Error analizando imágenes: ${e.message}`);
      } finally {
        setBusy(false);
      }
    };

    const save = async () => {
      try {
        setBusy(true);
        let uploaded = [];
        if (files.length > 0) {
          uploaded = await uploadFiles();
        }
        const finalImgs = [...(data.imagenes || []), ...uploaded];
        const payload = { ...data, imagenes: finalImgs };
        const url = initial?.id ? `/api/promos/${initial.id}` : '/api/promos';
        const method = initial?.id ? 'PUT' : 'POST';
        await fetchJSON(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
        onSaved();
        onClose();
      } catch (e) {
        alert(`Error guardando: ${e.message}`);
      } finally {
        setBusy(false);
      }
    };

    return (
      <Modal
        open={open}
        title={initial?.id ? '✏️ Editar Promo' : '✨ Nueva Promo'}
        onClose={onClose}
        footer={
          <>
            <button
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={save}
              disabled={busy}
            >
              {busy ? 'Guardando...' : 'Guardar'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <L label="Título"><Input value={data.titulo} onChange={(e) => onChange('titulo', e.target.value)} /></L>
            <L label="Destino"><Input value={data.destino} onChange={(e) => onChange('destino', e.target.value)} /></L>
          </div>
          <L label="Descripción">
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
              rows={3}
              value={data.descripcion}
              onChange={(e) => onChange('descripcion', e.target.value)}
            />
          </L>

          <div className="grid gap-3 md:grid-cols-3">
            <L label="Precio adulto"><Input type="number" value={data.precio_adulto} onChange={(e) => onChange('precio_adulto', e.target.value)} /></L>
            <L label="Precio menor"><Input type="number" value={data.precio_menor} onChange={(e) => onChange('precio_menor', e.target.value)} /></L>
            <L label="Precio bus menor"><Input type="number" value={data.precio_bus_menor} onChange={(e) => onChange('precio_bus_menor', e.target.value)} /></L>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <L label="Fecha salida"><Input type="date" value={data.fecha_salida} onChange={(e) => onChange('fecha_salida', e.target.value)} /></L>
            <L label="Fecha llegada"><Input type="date" value={data.fecha_llegada} onChange={(e) => onChange('fecha_llegada', e.target.value)} /></L>
            <L label="Reserva inicio"><Input type="date" value={data.reserva_inicio} onChange={(e) => onChange('reserva_inicio', e.target.value)} /></L>
            <L label="Reserva fin"><Input type="date" value={data.reserva_fin} onChange={(e) => onChange('reserva_fin', e.target.value)} /></L>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <Toggle label="Todo incluido" checked={data.todo_incluido} onChange={(v) => onChange('todo_incluido', v)} />
            <Toggle label="Con transporte" checked={data.con_transporte} onChange={(v) => onChange('con_transporte', v)} />
            <Toggle label="Traslados" checked={data.traslados} onChange={(v) => onChange('traslados', v)} />
            <Toggle label="Desayuno llegada" checked={data.incluye_desayuno_llegada} onChange={(v) => onChange('incluye_desayuno_llegada', v)} />
            <Toggle label="Menores gratis" checked={data.menores_gratis} onChange={(v) => onChange('menores_gratis', v)} />
            <Toggle label="Niños 2x1" checked={data.ninos_2x1} onChange={(v) => onChange('ninos_2x1', v)} />
            <Toggle label="Entrega anticipada" checked={data.entrega_anticipada} onChange={(v) => onChange('entrega_anticipada', v)} />
            <Toggle label="Activo" checked={data.activo} onChange={(v) => onChange('activo', v)} />
          </div>

          {data.con_transporte && (
            <L label="Tipo de transporte">
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
                value={data.transporte_tipo}
                onChange={(e) => onChange('transporte_tipo', e.target.value)}
              >
                <option value="camion">Camión</option>
                <option value="avion">Avión</option>
              </select>
            </L>
          )}

          {data.menores_gratis && (
            <L label="Política menores gratis">
              <Input value={data.menores_gratis_politica} onChange={(e) => onChange('menores_gratis_politica', e.target.value)} />
            </L>
          )}

          <div className="rounded-lg border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Imágenes</h3>
            <div className="flex gap-2">
              <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files))} className="flex-1 text-sm" />
              <button
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                onClick={analyzeFromImages}
                disabled={busy}
              >
                {busy ? '⏳ Analizando...' : '🤖 Analizar con IA'}
              </button>
            </div>

            <div className="flex gap-2">
              <Input placeholder="https://ejemplo.com/imagen.jpg" value={newImgUrl} onChange={(e) => setNewImgUrl(e.target.value)} />
              <button onClick={addExternalUrl} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Agregar
              </button>
            </div>

            {data.imagenes && data.imagenes.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {data.imagenes.map((img, i) => (
                  <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border">
                    <img src={absUrl(img)} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => setData(d => ({ ...d, imagenes: d.imagenes.filter((_, j) => j !== i) }))}
                      className="absolute top-1 right-1 rounded bg-red-600 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100"
                    >
                      ✖
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {toast && <Toast text={toast} onClose={() => setToast('')} />}
      </Modal>
    );
  }

  // ========== App Principal ==========
  function App() {
    const token = getToken();
    const [promos, setPromos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [openForm, setOpenForm] = useState(false);
    const [openBulk, setOpenBulk] = useState(false);
    const [editing, setEditing] = useState(null);

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await fetchJSON('/api/promos', { headers: authHeaders() });
        setPromos(data.promos || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (token) load();
    }, [token]);

    const duplicate = async (p) => {
      const { id, created_at, updated_at, ...rest } = p;
      try {
        await fetchJSON('/api/promos', { method: 'POST', headers: authHeaders(), body: JSON.stringify(rest) });
        load();
      } catch (e) { alert(`Error duplicando: ${e.message}`); }
    };

    const del = async (p) => {
      if (!confirm('¿Eliminar promo?')) return;
      try {
        await fetchJSON(`/api/promos/${p.id}`, { method: 'DELETE', headers: authHeaders() });
        load();
      } catch (e) { alert(`Error eliminando: ${e.message}`); }
    };

    if (!token) {
      return (
        <div className="mx-auto max-w-xl p-6 text-center">
          <h1 className="mb-2 text-xl font-bold">Necesitas iniciar sesión</h1>
          <p className="mb-4 text-gray-600">No encuentro tu token. Entra de nuevo para continuar.</p>
          <a href="/login" className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Ir a iniciar sesión</a>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a href="/" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">← Regresar</a>
            <h1 className="text-xl font-bold">📦 Promos</h1>
            <a href="/hotelpedia" className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100">🏨 Hotelpedia</a>
            <a href="/reservas" className="inline-flex items-center rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800 hover:bg-blue-100">📅 Reservas</a>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-xl border-2 border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 shadow-sm hover:bg-purple-100"
              onClick={() => setOpenBulk(true)}
            >
              📦 Carga por Lote
            </button>
            <button
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
              onClick={() => { setEditing(null); setOpenForm(true); }}
            >
              ✨ Nueva promo
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-gray-500">Cargando…</div>
        ) : promos.length === 0 ? (
          <div className="py-10 text-center text-gray-500">Sin promos disponibles</div>
        ) : (
          <FileExplorerView
            promos={promos}
            onEdit={(pp) => { setEditing(pp); setOpenForm(true); }}
            onDelete={del}
            onDuplicate={duplicate}
          />
        )}

        <PromoForm open={openForm} onClose={() => setOpenForm(false)} onSaved={load} initial={editing} />
        <BulkUploadModal open={openBulk} onClose={() => setOpenBulk(false)} onSuccess={load} />
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('app')).render(<App />);
})();
