/* global React, ReactDOM */
(() => {
    const { useEffect, useMemo, useState } = React;

    // Helpers
    const getToken = () =>
        sessionStorage.getItem('token') ||
        localStorage.getItem('token') ||
        '';

    const authHeaders = () => {
        const t = getToken();
        return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
    };

    const fetchJSON = async (url, opts = {}) => {
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
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
            <input type="checkbox" className="size-4 accent-blue-600" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
            <span className="text-sm text-gray-700">{label}</span>
        </label>
    );

    const parseBool = (s) => {
        const v = String(s || '').trim().toLowerCase();
        return ['1', 'true', 'sí', 'si', 'y', 'yes'].includes(v);
    };

    // Crea/encuentra una ruta de carpetas "Cancún/Tulum/Sur"
    async function ensureFolderPath(pathStr, headers) {
        const parts = (pathStr || '').split('/').map(s => s.trim()).filter(Boolean);
        let parentId = null;
        for (const name of parts) {
            // listar hijos del parent actual
            const url = parentId ? `/api/hotel/folders?parentId=${parentId}` : '/api/hotel/folders';
            const children = await fetchJSON(url, { headers });
            const found = children.find(c => String(c.name).trim().toLowerCase() === name.toLowerCase());
            if (found) {
                parentId = found.id;
            } else {
                const created = await fetchJSON('/api/hotel/folders', {
                    method: 'POST', headers, body: JSON.stringify({ name, parent_id: parentId })
                });
                parentId = created.id;
            }
        }
        return parentId; // id de la última carpeta
    }



    function Modal({ open, title, onClose, children, footer }) {
        if (!open) return null;
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
                    <div className="flex items-center justify-between border-b px-5 py-4">
                        <h2 className="text-lg font-semibold">{title}</h2>
                        <button className="rounded-md p-1 text-gray-500 hover:bg-gray-100" onClick={onClose}>✖</button>
                    </div>
                    <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
                    <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
                        {footer}
                    </div>
                </div>
            </div>
        );
    }

    // Form Carpeta
    function FolderForm({ open, onClose, onSaved, initial, parentId }) {
        const [name, setName] = useState(initial?.name || '');
        const [description, setDescription] = useState(initial?.description || '');
        useEffect(() => { if (open) { setName(initial?.name || ''); setDescription(initial?.description || ''); } }, [open, initial]);

        const save = async () => {
            const body = { name, description, parent_id: parentId ?? initial?.parent_id ?? null };
            const method = initial?.id ? 'PUT' : 'POST';
            const url = initial?.id ? `/api/hotel/folders/${initial.id}` : '/api/hotel/folders';
            await fetchJSON(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
            onSaved?.(); onClose?.();
        };

        return (
            <Modal open={open} onClose={onClose} title={initial?.id ? 'Editar carpeta' : 'Nueva carpeta'}
                footer={
                    <>
                        <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm" onClick={onClose}>Cancelar</button>
                        <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white" onClick={save}>Guardar</button>
                    </>
                }>
                <div className="grid gap-3">
                    <L label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cancún, Tulum, Zona Hotelera 1…" /></L>
                    <L label="Descripción"><textarea value={description} onChange={(e) => setDescription(e.target.value)} className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></L>
                </div>
            </Modal>
        );
    }

    // Form Hotel (campos esenciales + enlaces)
    // Form Hotel (con secciones de enlaces + importar media)
    function HotelForm({ open, onClose, onSaved, initial, folderId }) {
        const [h, setH] = useState(initial || {
            name: '', destination: '', zone: '', stars: '', pools: '', restaurants: '', specialties: '',
            has_gym: false, has_spa: false, has_kids_club: false, adults_only: false,
            description: '', personal_tip: '',
            tiktok_url: '', external_video_url: '',
            media: []
        });

        // pestaña
        const [tab, setTab] = useState('datos');

        // media simple (ya lo tenías)
        const [newMediaUrl, setNewMediaUrl] = useState('');

        // === Enlaces por sección ===
        const SECTION_SUGGESTIONS = ['habitaciones', 'playa', 'restaurantes', 'albercas', 'snacks', 'spa', 'gym', 'kids', 'ubicación', 'mapa'];
        const [links, setLinks] = useState([]); // [{id, section, title, url, sort_order}]
        const [newLink, setNewLink] = useState({ section: '', title: '', url: '', sort_order: 0 });

        const tokenHeaders = authHeaders();

        useEffect(() => {
            if (!open) return;
            // reset campos base
            setH(initial || {
                name: '', destination: '', zone: '', stars: '', pools: '', restaurants: '', specialties: '',
                has_gym: false, has_spa: false, has_kids_club: false, adults_only: false,
                description: '', personal_tip: '', tiktok_url: '', external_video_url: '', media: []
            });
            setNewMediaUrl('');
            setTab('datos');

            // cargar enlaces si es edición
            if (initial?.id) {
                fetchJSON(`/api/hotels/${initial.id}/links`, { headers: tokenHeaders })
                    .then(setLinks)
                    .catch(() => setLinks([]));
            } else {
                setLinks([]);
            }
        }, [open, initial]);

        const onChange = (k, v) => setH(prev => ({ ...prev, [k]: v }));

        const addMedia = () => {
            const u = (newMediaUrl || '').trim();
            if (!/^https?:\/\//i.test(u)) { alert('La URL debe iniciar con http:// o https://'); return; }
            setH(prev => ({ ...prev, media: [...(prev.media || []), u] }));
            setNewMediaUrl('');
        };
        const removeMedia = (idx) => setH(prev => ({ ...prev, media: (prev.media || []).filter((_, i) => i !== idx) }));

        const save = async () => {
            const payload = {
                ...h,
                folder_id: folderId ?? initial?.folder_id ?? null,
                stars: h.stars === '' ? null : Number(h.stars),
                pools: h.pools === '' ? null : Number(h.pools),
                restaurants: h.restaurants === '' ? null : Number(h.restaurants),
            };
            const method = initial?.id ? 'PUT' : 'POST';
            const url = initial?.id ? `/api/hotels/${initial.id}` : '/api/hotels';
            await fetchJSON(url, { method, headers: tokenHeaders, body: JSON.stringify(payload) });
            onSaved?.(); onClose?.();
        };

        // === Enlaces por sección: CRUD ===
        const addLink = async () => {
            if (!initial?.id) { alert('Primero guarda el hotel, luego agrega enlaces.'); return; }
            const s = (newLink.section || '').trim();
            const u = (newLink.url || '').trim();
            if (!s || !/^https?:\/\//i.test(u)) { alert('Sección y URL válidas son requeridas.'); return; }
            const body = { section: s, title: (newLink.title || '').trim() || null, url: u, sort_order: Number(newLink.sort_order) || 0 };
            const r = await fetchJSON(`/api/hotels/${initial.id}/links`, {
                method: 'POST', headers: tokenHeaders, body: JSON.stringify(body)
            });
            setLinks(prev => [...prev, r]);
            setNewLink({ section: '', title: '', url: '', sort_order: 0 });
        };

        const deleteLink = async (linkId) => {
            if (!confirm('¿Eliminar enlace?')) return;
            await fetchJSON(`/api/hotel-links/${linkId}`, { method: 'DELETE', headers: tokenHeaders });
            setLinks(prev => prev.filter(l => l.id !== linkId));
        };

        // agrupado por sección
        const grouped = links.reduce((acc, l) => {
            const key = (l.section || 'otros').toLowerCase();
            (acc[key] = acc[key] || []).push(l);
            return acc;
        }, {});

        return (
            <Modal open={open} onClose={onClose} title={initial?.id ? 'Editar hotel' : 'Nuevo hotel'}
                footer={
                    <>
                        <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm" onClick={onClose}>Cancelar</button>
                        <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white" onClick={save}>Guardar</button>
                    </>
                }>
                {/* Pestañas */}
                <div className="mb-3 flex gap-2">
                    <button className={`rounded-lg px-3 py-2 text-sm ${tab === 'datos' ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'border'}`} onClick={() => setTab('datos')}>Datos</button>
                    <button className={`rounded-lg px-3 py-2 text-sm ${tab === 'enlaces' ? 'bg-blue-50 text-blue-800 border border-blue-200' : 'border'}`} onClick={() => setTab('enlaces')}>Secciones de enlaces</button>
                </div>

                {tab === 'datos' && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="grid gap-3">
                            <L label="Nombre del hotel"><Input value={h.name} onChange={(e) => onChange('name', e.target.value)} placeholder="Ej. Barceló Ixtapa" /></L>
                            <L label="Destino"><Input value={h.destination || ''} onChange={(e) => onChange('destination', e.target.value)} placeholder="Cancún, Mazatlán, Vallarta…" /></L>
                            <L label="Zona/Colonia"><Input value={h.zone || ''} onChange={(e) => onChange('zone', e.target.value)} placeholder="Zona hotelera 1…" /></L>
                            <L label="Descripción"><textarea value={h.description || ''} onChange={(e) => onChange('description', e.target.value)} className="h-24 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></L>
                            <L label="Recomendación personal"><textarea value={h.personal_tip || ''} onChange={(e) => onChange('personal_tip', e.target.value)} className="h-24 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></L>
                        </div>
                        <div className="grid gap-3 rounded-xl border bg-white p-3">
                            <div className="grid grid-cols-3 gap-3">
                                <L label="Estrellas"><Input type="number" step="0.5" min="0" max="5" value={h.stars ?? ''} onChange={(e) => onChange('stars', e.target.value)} /></L>
                                <L label="Albercas"><Input type="number" min="0" step="1" value={h.pools ?? ''} onChange={(e) => onChange('pools', e.target.value)} /></L>
                                <L label="Restaurantes"><Input type="number" min="0" step="1" value={h.restaurants ?? ''} onChange={(e) => onChange('restaurants', e.target.value)} /></L>
                            </div>
                            <L label="Especialidades (texto libre)"><Input value={h.specialties || ''} onChange={(e) => onChange('specialties', e.target.value)} placeholder="mexicana, italiana, buffet…" /></L>
                            <div className="grid grid-cols-2 gap-2">
                                <Toggle label="Gym" checked={h.has_gym} onChange={(v) => onChange('has_gym', v)} />
                                <Toggle label="Spa" checked={h.has_spa} onChange={(v) => onChange('has_spa', v)} />
                                <Toggle label="Kids Club" checked={h.has_kids_club} onChange={(v) => onChange('has_kids_club', v)} />
                                <Toggle label="Solo adultos" checked={h.adults_only} onChange={(v) => onChange('adults_only', v)} />
                            </div>
                            <L label="Enlace TikTok (opcional)">
                                <Input placeholder="https://www.tiktok.com/..." value={h.tiktok_url || ''} onChange={(e) => onChange('tiktok_url', e.target.value)} />
                            </L>
                            <L label="Video externo (NAS/YouTube/etc)">
                                <Input placeholder="https://mi-nas.dyndns.org/videos/hotel-x.mp4" value={h.external_video_url || ''} onChange={(e) => onChange('external_video_url', e.target.value)} />
                            </L>
                            <div>
                                <span className="mb-1 block text-sm font-medium text-gray-700">Media (lista de URLs)</span>
                                <div className="grid grid-cols-[1fr_auto] gap-2">
                                    <Input placeholder="https://..." value={newMediaUrl} onChange={(e) => setNewMediaUrl(e.target.value)} />
                                    <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" onClick={addMedia}>Agregar</button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {(h.media || []).map((u, i) => (
                                        <div key={i} className="flex items-center gap-2 rounded-lg border bg-white px-2 py-1 text-xs">
                                            <a className="text-blue-700 truncate max-w-[260px]" href={u} target="_blank" rel="noreferrer">{u}</a>
                                            <button className="rounded bg-red-50 px-2 py-0.5 text-red-700" onClick={() => removeMedia(i)}>x</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {tab === 'enlaces' && (
                    <div className="grid gap-4">
                        {!initial?.id && (
                            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
                                Guarda el hotel primero para poder agregar enlaces por sección.
                            </div>
                        )}
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 text-sm font-semibold">Agregar enlace</div>
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                                <div>
                                    <select
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2"
                                        value={newLink.section}
                                        onChange={(e) => setNewLink(v => ({ ...v, section: e.target.value }))}
                                    >
                                        <option value="">Selecciona sección</option>
                                        {SECTION_SUGGESTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                                <div className="md:col-span-2">
                                    <Input placeholder="Título (opcional)" value={newLink.title} onChange={(e) => setNewLink(v => ({ ...v, title: e.target.value }))} />
                                </div>
                                <div className="md:col-span-4">
                                    <Input placeholder="https://..." value={newLink.url} onChange={(e) => setNewLink(v => ({ ...v, url: e.target.value }))} />
                                </div>
                                <div>
                                    <Input type="number" min="0" step="1" placeholder="Orden" value={newLink.sort_order} onChange={(e) => setNewLink(v => ({ ...v, sort_order: e.target.value }))} />
                                </div>
                                <div className="md:col-span-3">
                                    <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                                        onClick={addLink} disabled={!initial?.id}>
                                        Agregar enlace
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* listado por secciones */}
                        {Object.keys(grouped).length === 0 && (
                            <div className="text-sm text-gray-500">Sin enlaces todavía.</div>
                        )}
                        {Object.entries(grouped).map(([sec, arr]) => (
                            <div key={sec} className="rounded-lg border p-3">
                                <div className="mb-2 text-sm font-semibold capitalize">{sec}</div>
                                <ul className="space-y-2">
                                    {arr.map(l => (
                                        <li key={l.id} className="flex items-center justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm">{l.title || l.url}</div>
                                                <a className="truncate text-xs text-blue-700" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>
                                            </div>
                                            <button className="rounded border px-2 py-1 text-xs text-red-700" onClick={() => deleteLink(l.id)}>Eliminar</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>
        );
    }



    function ImportFoldersModal({ open, onClose, onImported }) {
        const [csv, setCsv] = useState(
            'folder_path,description\n' +
            'Cancun,\n' +
            'Cancun/Hotel Zone,\n' +
            'Ixtapa/Zona 1,Playas más tranquilas\n'
        );

        const importNow = async () => {
            try {
                const headers = authHeaders();
                const rows = csv.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
                if (rows.length <= 1) { alert('Pega un CSV con encabezado folder_path'); return; }

                const header = rows[0].split(',').map(s => s.trim());
                const idxPath = header.indexOf('folder_path');
                const idxDesc = header.indexOf('description');
                if (idxPath === -1) { alert('Encabezado folder_path es requerido'); return; }

                for (let i = 1; i < rows.length; i++) {
                    const cols = rows[i].split(',');
                    const path = cols[idxPath] || '';
                    const desc = idxDesc > -1 ? cols[idxDesc] : '';
                    if (!path) continue;

                    const id = await ensureFolderPath(path, headers);
                    if (desc) {
                        await fetchJSON(`/api/hotel/folders/${id}`, {
                            method: 'PUT',
                            headers,
                            body: JSON.stringify({ description: desc })
                        }).catch(() => { });
                    }
                }

                onImported?.();
                onClose?.();
            } catch (err) {
                console.error('ImportFoldersModal error:', err);
                alert('No se pudo importar destinos. Revisa el formato.');
            }
        };

        return (
            <Modal
                open={open}
                onClose={onClose}
                title="Importar destinos (carpetas)"
                footer={
                    <>
                        <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm" onClick={onClose}>Cancelar</button>
                        <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white" onClick={importNow}>Importar</button>
                    </>
                }
            >
                <p className="mb-2 text-sm text-gray-600">
                    Formato: columnas <b>folder_path</b> y opcional <b>description</b>. Usa “/” para subcarpetas.
                </p>
                <textarea
                    className="h-56 w-full rounded-lg border border-gray-300 p-2"
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                />
            </Modal>
        );
    }


    function ImportHotelsModal({ open, onClose, onImported }) {
  const sample = [
    'folder_path,name,destination,zone,stars,pools,restaurants,specialties,has_gym,has_spa,has_kids_club,adults_only,description,personal_tip,tiktok_url,external_video_url,media_urls',
    'Cancun/Hotel Zone,Barceló Ixtapa,Ixtapa,Zona 1,4.5,2,3,"mexicana;italiana",true,false,true,false,"Frente al mar","Pide hab. con vista",https://www.tiktok.com/@ejemplo/video/111,https://mi-nas/videos/barcelo.mp4,"https://img1.jpg;https://img2.jpg"'
  ].join('\n');

  const [csv, setCsv] = useState(sample);

  const importNow = async () => {
    try {
      const headers = authHeaders();
      const rows = csv.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
      if (rows.length <= 1) { alert('Pega un CSV con encabezados'); return; }

      const head = rows[0].split(',').map(s => s.trim());
      const col = (name) => head.indexOf(name);

      // columnas mínimas
      if (col('folder_path') === -1 || col('name') === -1) {
        alert('Encabezados requeridos: folder_path y name');
        return;
      }

      for (let i = 1; i < rows.length; i++) {
        const c = rows[i].split(',');
        const name = c[col('name')];
        if (!name) continue;

        const folderPath = c[col('folder_path')] || '';
        const folder_id = await ensureFolderPath(folderPath, headers);

        const mediaStr = col('media_urls') > -1 ? c[col('media_urls')] : '';
        const media = (mediaStr || '').split(';').map(s => s.trim()).filter(Boolean);

        const payload = {
          folder_id,
          name,
          destination: col('destination') > -1 ? c[col('destination')] : null,
          zone: col('zone') > -1 ? c[col('zone')] : null,
          stars: col('stars') > -1 && c[col('stars')] ? Number(c[col('stars')]) : null,
          pools: col('pools') > -1 && c[col('pools')] ? Number(c[col('pools')]) : null,
          restaurants: col('restaurants') > -1 && c[col('restaurants')] ? Number(c[col('restaurants')]) : null,
          specialties: col('specialties') > -1 ? (c[col('specialties')] || '').replace(/;/g, ', ') : null,
          has_gym: col('has_gym') > -1 ? parseBool(c[col('has_gym')]) : false,
          has_spa: col('has_spa') > -1 ? parseBool(c[col('has_spa')]) : false,
          has_kids_club: col('has_kids_club') > -1 ? parseBool(c[col('has_kids_club')]) : false,
          adults_only: col('adults_only') > -1 ? parseBool(c[col('adults_only')]) : false,
          description: col('description') > -1 ? c[col('description')] : null,
          personal_tip: col('personal_tip') > -1 ? c[col('personal_tip')] : null,
          tiktok_url: col('tiktok_url') > -1 ? c[col('tiktok_url')] : null,
          external_video_url: col('external_video_url') > -1 ? c[col('external_video_url')] : null,
          media
        };

        await fetchJSON('/api/hotels', { method: 'POST', headers, body: JSON.stringify(payload) });
      }

      onImported?.();
      onClose?.();
    } catch (err) {
      console.error('ImportHotelsModal error:', err);
      alert('No se pudo importar hoteles. Revisa el formato.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar hoteles"
      footer={
        <>
          <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm" onClick={onClose}>Cancelar</button>
          <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white" onClick={importNow}>Importar</button>
        </>
      }
    >
      <p className="mb-2 text-sm text-gray-600">
        Formato: ver encabezados en el ejemplo. <b>media_urls</b> separa con “;”.
      </p>
      <textarea
        className="h-56 w-full rounded-lg border border-gray-300 p-2"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
      />
    </Modal>
  );
}




    function App() {
        const token = getToken();
        const [currentFolder, setCurrentFolder] = useState({ id: null, name: 'Raíz', trail: [] }); // trail = breadcrumbs
        const [folders, setFolders] = useState([]);
        const [hotels, setHotels] = useState([]);
        const [openFolderForm, setOpenFolderForm] = useState(false);
        const [editingFolder, setEditingFolder] = useState(null);
        const [openHotelForm, setOpenHotelForm] = useState(false);
        const [editingHotel, setEditingHotel] = useState(null);
        const [q, setQ] = useState('');
        const [openImportFolders, setOpenImportFolders] = useState(false);
        const [openImportHotels, setOpenImportHotels] = useState(false);



        const load = async (folderId = null, search = '') => {
            const f = await fetchJSON(`/api/hotel/folders${folderId ? `?parentId=${folderId}` : ''}`, { headers: authHeaders() });
            setFolders(f);
            const params = new URLSearchParams();
            if (folderId) params.set('folderId', folderId);
            if (search) params.set('q', search);
            const h = await fetchJSON(`/api/hotels?${params.toString()}`, { headers: authHeaders() });
            setHotels(h);
        };

        useEffect(() => { if (token) { load(null, ''); } }, [token]);



        const enterFolder = (folder) => {
            setCurrentFolder(prev => ({
                id: folder.id,
                name: folder.name,
                trail: [...prev.trail, { id: prev.id, name: prev.name }]
            }));
            load(folder.id, q);
        };
        const goToCrumb = (crumb) => {
            if (!crumb) { // raíz
                setCurrentFolder({ id: null, name: 'Raíz', trail: [] });
                load(null, q);
            } else {
                // recortar trail hasta el crumb
                setCurrentFolder({ id: crumb.id, name: crumb.name, trail: currentFolder.trail.slice(0, currentFolder.trail.findIndex(c => c.id === crumb.id) + 1) });
                load(crumb.id, q);
            }
        };

        // Volver un nivel arriba usando el trail (breadcrumbs)
        const goBack = () => {
            setCurrentFolder(prev => {
                const prevCrumb = prev.trail.at(-1) || null;
                if (!prevCrumb) {            // ya estamos en raíz
                    load(null, q);
                    return { id: null, name: 'Raíz', trail: [] };
                }
                const newTrail = prev.trail.slice(0, -1);
                load(prevCrumb.id, q);
                return { id: prevCrumb.id, name: prevCrumb.name, trail: newTrail };
            });
        };


        const delFolder = async (f) => {
            if (!confirm(`Eliminar carpeta "${f.name}"? Debe estar vacía.`)) return;
            try {
                await fetchJSON(`/api/hotel/folders/${f.id}`, { method: 'DELETE', headers: authHeaders() });
                load(currentFolder.id, q);
            } catch (e) {
                alert(e.message);
            }
        };
        const delHotel = async (h) => {
            if (!confirm(`Eliminar hotel "${h.name}"?`)) return;
            try {
                await fetchJSON(`/api/hotels/${h.id}`, { method: 'DELETE', headers: authHeaders() });
                load(currentFolder.id, q);
            } catch (e) {
                alert(e.message);
            }
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
                <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/promos" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">← Promos</a>
                        <h1 className="text-xl font-bold">Hotelpedia</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <L label="Buscar">
                            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hotel o destino" />
                        </L>
                        <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" onClick={() => load(currentFolder.id, q)}>Filtrar</button>
                    </div>
                </div>

                <div>
                    {/* Panel único: navegación + hoteles */}
                    <div className="rounded-2xl border bg-white p-3">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <button
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                                    onClick={goBack}
                                    disabled={!currentFolder.trail.length}
                                    title="Volver a la carpeta anterior"
                                >
                                    ← Regresar
                                </button>
                                <h2 className="text-lg font-semibold">
                                    {currentFolder.id ? currentFolder.name : 'Raíz'} · Navegación
                                </h2>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                                    onClick={() => { setEditingFolder(null); setOpenFolderForm(true); }}
                                    title="Crear subcarpeta en la ubicación actual"
                                >
                                    Nueva carpeta
                                </button>

                                <button
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                                    onClick={() => {
                                        setEditingFolder({
                                            id: currentFolder.id,
                                            name: currentFolder.name,
                                            parent_id: currentFolder.trail.at(-1)?.id || null
                                        });
                                        setOpenFolderForm(true);
                                    }}
                                    disabled={!currentFolder.id}
                                    title="Renombrar carpeta actual"
                                >
                                    Renombrar
                                </button>

                                <button
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                                    onClick={() => setOpenImportFolders(true)}
                                >
                                    Importar destinos (CSV)
                                </button>

                                <button
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                                    onClick={() => setOpenImportHotels(true)}
                                >
                                    Importar hoteles (CSV)
                                </button>

                                <button
                                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    onClick={() => { setEditingHotel(null); setOpenHotelForm(true); }}
                                >
                                    Nuevo hotel
                                </button>
                            </div>

                        </div>


                        {/* === Grilla de carpetas (cuadros) === */}
                        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {folders.map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => enterFolder(f)}
                                    className="group rounded-xl border p-4 text-left hover:shadow-md transition"
                                >
                                    <div className="mb-2 text-2xl">📁</div>
                                    <div className="font-semibold truncate group-hover:underline">{f.name}</div>
                                    {f.description && (
                                        <div className="mt-1 text-xs text-gray-600 line-clamp-2">{f.description}</div>
                                    )}
                                </button>
                            ))}
                            {folders.length === 0 && (
                                <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                                    Sin subcarpetas en esta ubicación
                                </div>
                            )}
                        </div>

                        {/* === Grilla de hoteles === */}
                        <h3 className="mb-2 text-base font-semibold">
                            {currentFolder.id ? currentFolder.name : 'Raíz'} · Hoteles
                        </h3>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {hotels.map(h => (
                                <div key={h.id} className="flex flex-col rounded-xl border p-3">
                                    <div className="mb-1 flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-sm font-semibold">{h.name}</div>
                                            <div className="text-xs text-gray-600">
                                                {h.destination} {h.zone ? `· ${h.zone}` : ''}
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button className="rounded border px-2 py-1 text-xs" onClick={() => { setEditingHotel(h); setOpenHotelForm(true); }}>Editar</button>
                                            <button className="rounded border px-2 py-1 text-xs text-red-700" onClick={() => delHotel(h)}>Eliminar</button>
                                        </div>
                                    </div>
                                    <div className="mb-2 text-xs text-gray-700">
                                        {h.description || '—'}
                                    </div>
                                    <div className="mt-auto grid gap-1 text-xs">
                                        <div>⭐ {h.stars ?? '—'} · 🏊 {h.pools ?? '—'} · 🍽️ {h.restaurants ?? '—'}</div>
                                        <div>
                                            {h.has_gym ? '🏋️ Gym ' : ''}{h.has_spa ? '· Spa ' : ''}{h.has_kids_club ? '· Kids ' : ''}{h.adults_only ? '· Adults Only' : ''}
                                        </div>
                                        {h.tiktok_url && <a className="text-blue-700" href={h.tiktok_url} target="_blank" rel="noreferrer">TikTok</a>}
                                        {h.external_video_url && <a className="text-blue-700" href={h.external_video_url} target="_blank" rel="noreferrer">Video</a>}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {hotels.length === 0 && (
                            <div className="py-6 text-center text-sm text-gray-500">Sin hoteles en esta carpeta</div>
                        )}
                    </div>
                </div>


                <FolderForm open={openFolderForm} onClose={() => setOpenFolderForm(false)} onSaved={() => load(currentFolder.id, q)} initial={editingFolder} parentId={currentFolder.id} />

                <ImportFoldersModal
                    open={openImportFolders}
                    onClose={() => setOpenImportFolders(false)}
                    onImported={() => load(currentFolder.id, q)}
                />

                <ImportHotelsModal
                    open={openImportHotels}
                    onClose={() => setOpenImportHotels(false)}
                    onImported={() => load(currentFolder.id, q)}
                />
                <HotelForm open={openHotelForm} onClose={() => setOpenHotelForm(false)} onSaved={() => load(currentFolder.id, q)} initial={editingHotel} folderId={currentFolder.id} />
            </div>
        );
    }

    ReactDOM.createRoot(document.getElementById('app')).render(<App />);
})();
