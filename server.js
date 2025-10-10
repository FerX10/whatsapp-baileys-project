// server.js

const { config } = require('./src/config/env');
const { createServer } = require('http');
const { Server } = require('socket.io');
const express = require('express');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const fsPromises = require('fs').promises; // Agrega esta línea
const OpenAI = require('openai');
let openai = null;
if (config.openai.apiKey) {
  openai = new OpenAI({
    apiKey: config.openai.apiKey,
    organization: config.openai.organization || undefined
  });
} else {
  console.warn('[openai] OPENAI_API_KEY no configurada; cliente OpenAI deshabilitado.');
}
global.__openaiClient = openai;

const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const WhatsAppService = require('./src/services/whatsapp.service');
const OpenAIHandler = require('./src/services/openai-handler');
const {
  pool,
  initDatabase,
  ejecutarConReintento,
  getEtiquetasChat,
  toggleEtiqueta
} = require('./src/database/db');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = config.port;
const JWT_SECRET = 'tu_secreto_jwt_muy_seguro';
const BASE_URL = config.baseUrl || process.env.NGROK_URL || `http://localhost:${PORT}`;

// ===== Configuración de Socket.IO =====
io.on('connection', (socket) => {
  console.log('Cliente Socket.IO conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Cliente Socket.IO desconectado:', socket.id);
  });
});

// ===== Logger minimalista por request (JSON una sola línea) =====
const { randomUUID } = require('crypto');
function appLog(level, msg, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line); else console.log(line);
}

app.use((req, res, next) => {
  req.reqId = randomUUID();
  const started = Date.now();
  appLog('info', 'HTTP_IN', { reqId: req.reqId, method: req.method, url: req.originalUrl });

  res.on('finish', () => {
    appLog('info', 'HTTP_OUT', {
      reqId: req.reqId,
      status: res.statusCode,
      ms: Date.now() - started
    });
  });
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

// Middleware para verificar que el usuario es gerente
function requireManager(req, res, next) {
  if (req.user && req.user.userType === 'gerente') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Acceso denegado. Solo gerentes pueden acceder a esta función.'
  });
}

// ========================================
// ENDPOINTS DE CONEXIÓN WHATSAPP (QR)
// ========================================

// GET /whatsapp-qr - Obtener el QR actual (solo gerentes)
app.get('/api/whatsapp/qr', authenticateToken, requireManager, async (req, res) => {
  try {
    const whatsappService = req.app.get('whatsappService');

    if (!whatsappService) {
      return res.status(503).json({
        success: false,
        message: 'Servicio de WhatsApp no disponible'
      });
    }

    // Si está conectado
    if (whatsappService.isReady()) {
      return res.json({
        success: true,
        connected: true,
        message: 'WhatsApp conectado'
      });
    }

    // Si hay un QR reciente, enviarlo
    const lastQR = whatsappService.getLastQR();
    if (lastQR) {
      return res.json({
        success: true,
        connected: false,
        hasQR: true,
        qr: lastQR.qr,
        timestamp: lastQR.timestamp,
        message: 'QR disponible'
      });
    }

    // No hay QR disponible
    res.json({
      success: true,
      connected: false,
      hasQR: false,
      message: 'Esperando generación de QR...'
    });
  } catch (error) {
    console.error('Error en /api/whatsapp/qr:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /whatsapp-connection - Página de conexión WhatsApp (solo gerentes)
// La verificación de autenticación se hace en el cliente (whatsapp-connection.html)
app.get('/whatsapp-connection', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'whatsapp-connection.html'));
});

// POST /api/whatsapp/reset-session - Eliminar sesión de WhatsApp (solo gerentes)
app.post('/api/whatsapp/reset-session', authenticateToken, requireManager, async (req, res) => {
  try {
    const authFolder = process.env.AUTH_FOLDER || 'auth_info_baileys';
    const authPath = path.join(__dirname, authFolder);

    // Eliminar carpeta de autenticación
    if (require('fs').existsSync(authPath)) {
      await fsPromises.rm(authPath, { recursive: true, force: true });
      console.log('✅ Sesión de WhatsApp eliminada');
    }

    // Reiniciar servicio de WhatsApp completamente
    const whatsappService = req.app.get('whatsappService');
    if (whatsappService) {
      console.log('🔄 Reiniciando servicio de WhatsApp...');
      whatsappService.reconnectAttempts = 0; // Reset contador
      whatsappService.ready = false;

      // Reinicializar
      setTimeout(async () => {
        try {
          await whatsappService.initialize();
        } catch (e) {
          console.error('Error reiniciando WhatsApp:', e);
        }
      }, 1000);
    }

    res.json({
      success: true,
      message: 'Sesión eliminada. El servicio se está reiniciando...'
    });
  } catch (error) {
    console.error('Error al resetear sesión:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// CONFIGURACIÓN DE MULTER para subir archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'video/mp4',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido'));
    }
  }
});

// Helpers de URL externa (solo http/https)
const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\/.+/i.test(s);
const sanitizeMedia = (arr) => Array.isArray(arr) ? arr.filter(isHttpUrl).slice(0, 50) : [];

// === Salvavidas ultra simple ===
// Si NO hay ningún 'gerente', sube 'admin' a 'gerente'.
// (No crea usuarios nuevos, sólo cambia el rol de 'admin' si hace falta)
async function ensureManagerUserSimple() {
  try {
    const { rows: mgrRows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM usuarios WHERE tipo_usuario='gerente' AND activo=true"
    );

    if (mgrRows[0].count > 0) {
      console.log('[roles] Ya existe al menos un gerente. No hago nada.');
      return;
    }

    // Promueve admin -> gerente (si existe)
    const res = await pool.query(
      "UPDATE usuarios SET tipo_usuario='gerente' WHERE nombre_usuario='admin'"
    );

    if (res.rowCount > 0) {
      console.log("[roles] No había gerente. 'admin' fue promovido a gerente temporalmente.");
    } else {
      console.warn("[roles] No hay gerente y no encontré usuario 'admin'. (Si pasa esto, avísame y lo ajustamos creando uno por código).");
    }
  } catch (e) {
    console.warn('[roles] ensureManagerUserSimple error:', e?.message || e);
  }
}


app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticación (JWT)
function authenticateToken(req, res, next) {
  if (req.path === '/webhook') return next();

  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Token no proporcionado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Token inválido' });
    req.user = user;
    next();
  });
}

// Rutas públicas
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta de login
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await ejecutarConReintento(
      'SELECT * FROM usuarios WHERE nombre_usuario = $1 AND activo = TRUE',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }
    const token = jwt.sign(
      {
        id: user.id,
        username: user.nombre_usuario,
        userType: user.tipo_usuario
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({
      token,
      username: user.nombre_usuario,
      userType: user.tipo_usuario,
      id: user.id
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error en el servidor' });
  }
});


// ===== Hotel Folders =====
app.get('/api/hotel/folders', authenticateToken, async (req, res) => {
  try {
    const { parentId } = req.query;
    const sql = parentId
      ? 'SELECT * FROM hotel_folders WHERE parent_id = $1 ORDER BY name'
      : 'SELECT * FROM hotel_folders WHERE parent_id IS NULL ORDER BY name';
    const r = await ejecutarConReintento(sql, parentId ? [parentId] : []);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/hotel/folders', authenticateToken, async (req, res) => {
  try {
    const { name, parent_id, description } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ message: 'name requerido' });
    const r = await ejecutarConReintento(
      'INSERT INTO hotel_folders (name, parent_id, description) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), parent_id || null, description || null]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/api/hotel/folders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent_id } = req.body || {};
    const r = await ejecutarConReintento(
      'UPDATE hotel_folders SET name=$1, description=$2, parent_id=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
      [name, description || null, parent_id || null, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete('/api/hotel/folders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const children = await ejecutarConReintento('SELECT 1 FROM hotel_folders WHERE parent_id=$1 LIMIT 1', [id]);
    const hotels = await ejecutarConReintento('SELECT 1 FROM hotels WHERE folder_id=$1 LIMIT 1', [id]);
    if (children.rows.length || hotels.rows.length) {
      return res.status(400).json({ message: 'La carpeta no está vacía' });
    }
    await ejecutarConReintento('DELETE FROM hotel_folders WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});


// ===== Hotels =====
app.get('/api/hotels', authenticateToken, async (req, res) => {
  try {
    const { folderId, q } = req.query;
    const params = [];
    const where = ['1=1'];
    if (folderId) { params.push(folderId); where.push(`folder_id=$${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(LOWER(name) LIKE LOWER($${params.length}) OR LOWER(destination) LIKE LOWER($${params.length}))`); }
    const r = await ejecutarConReintento(`SELECT * FROM hotels WHERE ${where.join(' AND ')} ORDER BY name LIMIT 500`, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/hotels', authenticateToken, async (req, res) => {
  try {
    const h = req.body || {};
    if (!h.name || !h.name.trim()) return res.status(400).json({ message: 'name requerido' });

    const media = sanitizeMedia(h.media);
    const r = await ejecutarConReintento(`
      INSERT INTO hotels (
        folder_id, name, destination, zone, stars, pools, restaurants, specialties,
        has_gym, has_spa, has_kids_club, adults_only,
        description, personal_tip, tiktok_url, external_video_url,
        media, activo
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,
        $17::jsonb,$18
      )
      RETURNING *
    `, [
      h.folder_id || null, h.name.trim(), h.destination || null, h.zone || null, h.stars || null,
      h.pools || null, h.restaurants || null, h.specialties || null,
      !!h.has_gym, !!h.has_spa, !!h.has_kids_club, !!h.adults_only,
      h.description || null, h.personal_tip || null,
      isHttpUrl(h.tiktok_url) ? h.tiktok_url : null,
      isHttpUrl(h.external_video_url) ? h.external_video_url : null,
      JSON.stringify(media),
      h.activo !== false
    ]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/api/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const h = req.body || {};
    const media = sanitizeMedia(h.media);

    const r = await ejecutarConReintento(`
      UPDATE hotels SET
        folder_id=$1, name=$2, destination=$3, zone=$4, stars=$5, pools=$6, restaurants=$7, specialties=$8,
        has_gym=$9, has_spa=$10, has_kids_club=$11, adults_only=$12,
        description=$13, personal_tip=$14, tiktok_url=$15, external_video_url=$16,
        media=$17::jsonb, activo=$18, updated_at=NOW()
      WHERE id=$19
      RETURNING *
    `, [
      h.folder_id || null, h.name, h.destination || null, h.zone || null, h.stars || null,
      h.pools || null, h.restaurants || null, h.specialties || null,
      !!h.has_gym, !!h.has_spa, !!h.has_kids_club, !!h.adults_only,
      h.description || null, h.personal_tip || null,
      isHttpUrl(h.tiktok_url) ? h.tiktok_url : null,
      isHttpUrl(h.external_video_url) ? h.external_video_url : null,
      JSON.stringify(media),
      h.activo !== false,
      id
    ]);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete('/api/hotels/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await ejecutarConReintento('DELETE FROM hotels WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ===== Hotel Links (secciones de enlaces por hotel) =====
app.get('/api/hotels/:id/links', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { section } = req.query;
    const params = [id];
    let sql = 'SELECT * FROM hotel_links WHERE hotel_id=$1';
    if (section) { params.push(section); sql += ` AND LOWER(section)=LOWER($${params.length})`; }
    sql += ' ORDER BY section, sort_order, id';
    const r = await ejecutarConReintento(sql, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/hotels/:id/links', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { section, title, url, sort_order } = req.body || {};
    if (!section || !url) return res.status(400).json({ message: 'section y url son requeridos' });
    const r = await ejecutarConReintento(
      `INSERT INTO hotel_links (hotel_id, section, title, url, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [id, section.trim(), title || null, url, Number(sort_order) || 0]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/api/hotel-links/:linkId', authenticateToken, async (req, res) => {
  try {
    const { linkId } = req.params;
    const { section, title, url, sort_order } = req.body || {};
    const r = await ejecutarConReintento(
      `UPDATE hotel_links SET
         section=$1, title=$2, url=$3, sort_order=$4, updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [section, title || null, url, Number(sort_order) || 0, linkId]
    );
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete('/api/hotel-links/:linkId', authenticateToken, async (req, res) => {
  try {
    const { linkId } = req.params;
    await ejecutarConReintento('DELETE FROM hotel_links WHERE id=$1', [linkId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Crea una reserva + ítems multi-proveedor
// Body esperado:
// {
//   "contacto_id": 123,
//   "vendedor_id": 7,                  // opcional
//   "destino": "Cancún",
//   "check_in": "2025-11-20",
//   "check_out": "2025-11-25",
//   "ocupacion": {"adultos":2,"menores":[6]}, // opcional
//   "metodo_pago": "TARJETA",          // EFECTIVO|TARJETA|TRANSFERENCIA
//   "moneda": "MXN",                   // opcional (default MXN)
//   "items": [
//     { "proveedor_id": 4, "tipo": "HOTEL", "descripcion": "5 noches AI", "precio_neto": 18000.00, "precio_cliente": 18500.00 },
//     { "proveedor_id": 8, "tipo": "BUS",   "descripcion": "Redondo 1a",  "precio_neto": 2000.00,  "precio_cliente": 2000.00  }
//   ]
// }
app.post('/reservas', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      contacto_id,
      vendedor_id = null,
      destino,
      check_in = null,
      check_out = null,
      ocupacion = null,
      metodo_pago,
      moneda = 'MXN',
      items = []
    } = req.body || {};

    if (!contacto_id || !destino || !metodo_pago || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios (contacto_id, destino, metodo_pago, items[])' });
    }

    if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].includes(metodo_pago)) {
      return res.status(400).json({ success: false, message: 'metodo_pago inválido' });
    }

    await client.query('BEGIN');

    // Insertar reserva
    const rIns = await client.query(
      `INSERT INTO reservas (contacto_id, vendedor_id, destino, check_in, check_out, ocupacion, metodo_pago, moneda, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'COTIZADA')
       RETURNING id`,
      [contacto_id, vendedor_id, destino, check_in, check_out, ocupacion, metodo_pago, moneda]
    );
    const reservaId = rIns.rows[0].id;

    // Helper para % comisión por proveedor según método
    async function getPctForProveedor(proveedor_id) {
      const q = await client.query(
        'SELECT comision_efectivo, comision_tarjeta FROM proveedores WHERE id = $1',
        [proveedor_id]
      );
      if (q.rowCount === 0) {
        throw new Error(`Proveedor ${proveedor_id} no existe`);
      }
      const row = q.rows[0];
      // TRANSFERENCIA usa el % de EFECTIVO por acuerdoprevio
      if (metodo_pago === 'TARJETA') return Number(row.comision_tarjeta ?? 10);
      return Number(row.comision_efectivo ?? 15);
    }

    // Insertar ítems calculando precio_proveedor
    for (const it of items) {
      const { proveedor_id, tipo, descripcion = null, precio_neto, precio_cliente } = it || {};
      if (!proveedor_id || !tipo || precio_neto == null || precio_cliente == null) {
        throw new Error('Cada item requiere proveedor_id, tipo, precio_neto y precio_cliente');
      }
      const pct = await getPctForProveedor(proveedor_id); // ej. 15 o 10
      const precio_proveedor = Number(precio_neto) * (1 - (pct / 100));

      await client.query(
        `INSERT INTO reservas_items
           (reserva_id, proveedor_id, tipo, descripcion, precio_neto, precio_proveedor, precio_cliente)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [reservaId, proveedor_id, tipo, descripcion, Number(precio_neto), precio_proveedor, Number(precio_cliente)]
      );
    }

    await client.query('COMMIT');

    appLog('info', 'RESERVA_CREADA', { reservaId, contacto_id, destino, metodo_pago, items: items.length });
    res.json({ success: true, reserva_id: reservaId });

  } catch (err) {
    await client.query('ROLLBACK');
    appLog('error', 'RESERVA_ERROR', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});


///////////////////////////////////////////////////////////

// Página de Promos (SPA)
app.get('/promos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'promos.html'));
});


// Subida de archivos para promos
app.post('/api/promos/upload', authenticateToken, upload.array('files', 12), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ message: 'No se recibieron archivos' });
    }

    // Construye URL pública absoluta para cada archivo
    // Base pública resiliente: env var o el host de la request
    const base = process.env.BASE_URL || process.env.NGROK_URL || `${req.protocol}://${req.get('host')}`;

    // 1) URL ABSOLUTA (para guardar en DB y usar en clientes externos)
    const urls = (req.files || []).map((file) => `${base}/uploads/${file.filename}`);

    // 2) PATH RELATIVO (por si alguna vista interna lo quisiera)
    const paths = (req.files || []).map((file) => `/uploads/${file.filename}`);

    // Respuesta: incluimos ambas, pero el front debe usar "urls"
    res.json({ urls, paths });

  } catch (e) {
    console.error('upload error:', e);
    res.status(500).json({ message: e.message || 'Error subiendo archivos' });
  }
});

// ========== PROVEEDORES API ==========
// Solo ADMIN y GERENTE pueden gestionar proveedores
const requireAdmin = (req, res, next) => {
  // El JWT guarda 'userType' en el token, no 'tipo_usuario'
  // Permitir tanto admin como gerente
  if (req.user?.userType !== 'admin' && req.user?.userType !== 'gerente') {
    return res.status(403).json({ success: false, message: 'Acceso denegado. Solo administradores y gerentes.' });
  }
  next();
};

// Solo GERENTE tiene acceso total
const requireGerente = (req, res, next) => {
  if (req.user?.userType !== 'gerente') {
    return res.status(403).json({ success: false, message: 'Acceso denegado. Solo gerentes.' });
  }
  next();
};

// GET /api/proveedores - Listar proveedores
app.get('/api/proveedores', authenticateToken, async (req, res) => {
  try {
    const soloActivos = req.query.activos === 'true';
    const proveedores = await proveedoresService.listarProveedores(soloActivos);
    res.json({ success: true, proveedores });
  } catch (err) {
    console.error('Error GET /api/proveedores:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/proveedores/:id - Obtener proveedor por ID
app.get('/api/proveedores/:id', authenticateToken, async (req, res) => {
  try {
    const proveedor = await proveedoresService.getProveedor(Number(req.params.id));
    res.json({ success: true, proveedor });
  } catch (err) {
    console.error('Error GET /api/proveedores/:id:', err);
    res.status(404).json({ success: false, message: err.message });
  }
});

// GET /api/proveedores/:id/resumen-deuda - Resumen de deuda con un proveedor
app.get('/api/proveedores/:id/resumen-deuda', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const resumen = await proveedoresService.getResumenDeuda(Number(req.params.id));
    res.json({ success: true, resumen });
  } catch (err) {
    console.error('Error GET /api/proveedores/:id/resumen-deuda:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/proveedores/:id/items-pendientes - Items pendientes de pago
app.get('/api/proveedores/:id/items-pendientes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const items = await proveedoresService.getItemsPendientesPago(Number(req.params.id));
    res.json({ success: true, items });
  } catch (err) {
    console.error('Error GET /api/proveedores/:id/items-pendientes:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/proveedores - Crear proveedor (solo ADMIN)
app.post('/api/proveedores', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const proveedor = await proveedoresService.crearProveedor(req.body);
    res.json({ success: true, proveedor });
  } catch (err) {
    console.error('Error POST /api/proveedores:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/proveedores/:id - Actualizar proveedor (solo ADMIN)
app.put('/api/proveedores/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const proveedor = await proveedoresService.actualizarProveedor(Number(req.params.id), req.body);
    res.json({ success: true, proveedor });
  } catch (err) {
    console.error('Error PUT /api/proveedores/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/proveedores/:id - Eliminar proveedor (solo ADMIN)
app.delete('/api/proveedores/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const proveedor = await proveedoresService.eliminarProveedor(Number(req.params.id));
    res.json({ success: true, message: 'Proveedor desactivado correctamente', proveedor });
  } catch (err) {
    console.error('Error DELETE /api/proveedores/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== USUARIOS API ==========
// Solo ADMIN puede gestionar usuarios

// GET /api/usuarios - Listar usuarios
app.get('/api/usuarios', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const soloActivos = req.query.activos === 'true';
    const usuarios = await usuariosService.listarUsuarios(soloActivos);
    res.json({ success: true, usuarios });
  } catch (err) {
    console.error('Error GET /api/usuarios:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/usuarios/:id - Obtener usuario por ID
app.get('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuario = await usuariosService.getUsuario(Number(req.params.id));
    res.json({ success: true, usuario });
  } catch (err) {
    console.error('Error GET /api/usuarios/:id:', err);
    res.status(404).json({ success: false, message: err.message });
  }
});

// GET /api/usuarios/:id/comisiones - Obtener comisiones de un vendedor
app.get('/api/usuarios/:id/comisiones', authenticateToken, async (req, res) => {
  try {
    // Permitir que el vendedor vea sus propias comisiones o que admin vea todas
    if (req.user.tipo_usuario !== 'admin' && req.user.id !== Number(req.params.id)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }

    const comisiones = await usuariosService.getComisionesVendedor(Number(req.params.id));
    const resumen = await usuariosService.getResumenComisiones(Number(req.params.id));

    res.json({ success: true, comisiones, resumen });
  } catch (err) {
    console.error('Error GET /api/usuarios/:id/comisiones:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/usuarios - Crear usuario (solo ADMIN)
app.post('/api/usuarios', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuario = await usuariosService.crearUsuario(req.body);
    res.json({ success: true, usuario });
  } catch (err) {
    console.error('Error POST /api/usuarios:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/usuarios/:id - Actualizar usuario (solo ADMIN)
app.put('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuario = await usuariosService.actualizarUsuario(Number(req.params.id), req.body);
    res.json({ success: true, usuario });
  } catch (err) {
    console.error('Error PUT /api/usuarios/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/usuarios/:id/password - Cambiar contraseña
app.put('/api/usuarios/:id/password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const targetUserId = Number(req.params.id);
    const { password, newPassword } = req.body; // Accept both 'password' and 'newPassword'
    const passwordToUse = password || newPassword;

    if (!passwordToUse) {
      return res.status(400).json({ success: false, message: 'Contraseña requerida' });
    }

    // Obtener información del usuario objetivo
    const targetUser = await usuariosService.getUsuario(targetUserId);

    // Verificar permisos:
    // - Gerente puede cambiar contraseñas de todos
    // - Admin solo puede cambiar contraseñas de operadores
    if (req.user.userType === 'admin' && targetUser.tipo_usuario !== 'operador') {
      return res.status(403).json({
        success: false,
        message: 'Los administradores solo pueden cambiar contraseñas de operadores'
      });
    }

    await usuariosService.cambiarPassword(targetUserId, passwordToUse);
    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('Error PUT /api/usuarios/:id/password:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/usuarios/:id - Eliminar usuario (solo ADMIN)
app.delete('/api/usuarios/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const usuario = await usuariosService.eliminarUsuario(Number(req.params.id));
    res.json({ success: true, message: 'Usuario eliminado correctamente', usuario });
  } catch (err) {
    console.error('Error DELETE /api/usuarios/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== COTIZACIONES TEMPORALES ==========

// GET /api/cotizaciones/:numero_telefono - Obtener cotizaciones de un contacto
app.get('/api/cotizaciones/:numero_telefono', authenticateToken, async (req, res) => {
  try {
    const { numero_telefono } = req.params;
    const limit = Number(req.query.limit) || 10;
    const cotizaciones = await cotizacionesService.getCotizacionesContacto(numero_telefono, limit);
    res.json({ success: true, cotizaciones });
  } catch (err) {
    console.error('Error GET /api/cotizaciones/:numero_telefono:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/cotizaciones - Guardar cotización temporal
app.post('/api/cotizaciones', authenticateToken, async (req, res) => {
  try {
    const cotizacion = await cotizacionesService.guardarCotizacion(req.body);
    res.json({ success: true, message: 'Cotización guardada (expira en 24h)', cotizacion });
  } catch (err) {
    console.error('Error POST /api/cotizaciones:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/cotizaciones/:numero_telefono - Eliminar cotizaciones de un contacto
app.delete('/api/cotizaciones/:numero_telefono', authenticateToken, async (req, res) => {
  try {
    const { numero_telefono } = req.params;
    const resultado = await cotizacionesService.eliminarCotizacionesContacto(numero_telefono);
    res.json({ success: true, message: 'Cotizaciones eliminadas', ...resultado });
  } catch (err) {
    console.error('Error DELETE /api/cotizaciones/:numero_telefono:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== OCR PLAN DE PAGOS ==========

const ocrPlanPagosService = require('./src/services/ocr-plan-pagos.service');

// POST /api/ocr/plan-pagos - Extraer plan de pagos de imagen
app.post('/api/ocr/plan-pagos', authenticateToken, upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se recibió ninguna imagen' });
    }

    const imagePath = req.file.path;
    const planPagos = await ocrPlanPagosService.extraerPlanDePagos(imagePath);

    // Opcional: eliminar la imagen temporal después de procesarla
    // fs.unlinkSync(imagePath);

    res.json({ success: true, planPagos });
  } catch (err) {
    console.error('Error POST /api/ocr/plan-pagos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/ocr/plan-pagos-base64 - Extraer plan de pagos de imagen en base64
app.post('/api/ocr/plan-pagos-base64', authenticateToken, async (req, res) => {
  try {
    const { imagen, mimeType } = req.body;

    if (!imagen) {
      return res.status(400).json({ success: false, message: 'No se recibió ninguna imagen' });
    }

    const planPagos = await ocrPlanPagosService.extraerPlanDePagosBase64(imagen, mimeType || 'image/jpeg');
    res.json({ success: true, planPagos });
  } catch (err) {
    console.error('Error POST /api/ocr/plan-pagos-base64:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/mejorar-texto - Mejorar texto con IA
app.post('/api/mejorar-texto', authenticateToken, async (req, res) => {
  try {
    const { texto } = req.body;

    if (!texto || !texto.trim()) {
      return res.status(400).json({ success: false, message: 'Texto requerido' });
    }

    const prompt = `Eres un asistente experto en comunicación para WhatsApp de una agencia de viajes.

Tu tarea: Mejorar el siguiente texto haciéndolo más profesional, claro y amigable.

REGLAS ESTRICTAS:
1. Tono: Cálido, cercano pero profesional (como un asesor de viajes experimentado)
2. Emojis: Usa 3-5 emojis relevantes al contexto (viajes, destinos, servicios)
3. Formato de negritas: USA SOLO *asterisco simple* para palabras clave importantes
   ✅ Correcto: *palabra clave*
   ❌ INCORRECTO: **palabra clave** (doble asterisco NO funciona en WhatsApp)
4. Estructura: Mantén los saltos de línea originales si los hay
5. Contenido: NO cambies el mensaje principal, solo mejora su presentación
6. Claridad: Si el texto es confuso o muy largo, simplifícalo manteniendo la idea principal
7. Profesionalismo: Evita lenguaje muy informal o excesivo uso de emojis

IMPORTANTE: Devuelve SOLO el texto mejorado, sin explicaciones ni comentarios adicionales.

Texto original:
${texto}

Texto mejorado:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500
    });

    const textoMejorado = completion.choices[0].message.content.trim();

    res.json({ success: true, textoMejorado });

  } catch (error) {
    console.error('Error mejorando texto:', error);
    res.status(500).json({ success: false, message: 'Error al mejorar texto con IA' });
  }
});

// ========== PAGOS A PROVEEDORES ==========

const pagosProveedoresService = require('./src/services/pagos-proveedores.service');
const gmailService = require('./src/services/gmail.service');

// GET /api/pagos-proveedores/pendientes - Listar ítems pendientes de pago
app.get('/api/pagos-proveedores/pendientes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filtros = {
      proveedor_id: req.query.proveedor_id ? Number(req.query.proveedor_id) : null,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0
    };

    const items = await pagosProveedoresService.listarItemsPendientes(filtros);
    res.json({ success: true, items });
  } catch (err) {
    console.error('Error GET /api/pagos-proveedores/pendientes:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/pagos-proveedores/resumen/:proveedorId - Obtener resumen de deuda
app.get('/api/pagos-proveedores/resumen/:proveedorId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const proveedorId = Number(req.params.proveedorId);
    const resumen = await pagosProveedoresService.getResumenDeuda(proveedorId);
    res.json({ success: true, resumen });
  } catch (err) {
    console.error('Error GET /api/pagos-proveedores/resumen:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/pagos-proveedores/historial/:itemId - Obtener historial de pagos de un ítem
app.get('/api/pagos-proveedores/historial/:itemId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    const historial = await pagosProveedoresService.getHistorialPagos(itemId);
    res.json({ success: true, historial });
  } catch (err) {
    console.error('Error GET /api/pagos-proveedores/historial:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pagos-proveedores - Registrar un pago a proveedor
app.post('/api/pagos-proveedores', authenticateToken, requireAdmin, upload.single('evidencia'), async (req, res) => {
  try {
    const { reserva_item_id, monto, fecha_pago, solicito_factura, enviar_email } = req.body;

    if (!reserva_item_id || !monto) {
      return res.status(400).json({ success: false, message: 'Faltan datos requeridos' });
    }

    const evidencia_url = req.file ? `/uploads/${req.file.filename}` : null;

    const pago = await pagosProveedoresService.registrarPago({
      reserva_item_id: Number(reserva_item_id),
      monto: Number(monto),
      fecha_pago,
      evidencia_url,
      solicito_factura: solicito_factura === 'true' || solicito_factura === true
    });

    // Enviar email automático si se solicitó
    if (enviar_email === 'true' || enviar_email === true) {
      try {
        // Obtener datos del proveedor y reserva
        const itemQuery = await ejecutarConReintento(`
          SELECT
            ri.tipo,
            ri.metodo_pago,
            r.folio_interno,
            p.nombre AS proveedor_nombre,
            p.email_pagos AS proveedor_email
          FROM reservas_items ri
          JOIN reservas r ON r.id = ri.reserva_id
          JOIN proveedores p ON p.id = ri.proveedor_id
          WHERE ri.id = $1
        `, [Number(reserva_item_id)]);

        if (itemQuery.rows.length > 0 && itemQuery.rows[0].proveedor_email) {
          const item = itemQuery.rows[0];
          const evidenciaPath = req.file ? req.file.path : null;

          const emailResult = await gmailService.enviarNotificacionPagoProveedor({
            emailProveedor: item.proveedor_email,
            nombreProveedor: item.proveedor_nombre,
            folio: item.folio_interno,
            monto: monto,
            metodoPago: item.metodo_pago || 'No especificado',
            fecha: fecha_pago || new Date().toLocaleDateString('es-MX'),
            concepto: `Pago de ${item.tipo}`,
            evidenciaPath
          });

          if (emailResult.success) {
            // Marcar como enviado
            await pagosProveedoresService.marcarEnviadoEmailPagos(pago.id);
            console.log('✅ Email de notificación enviado a proveedor');
          }
        }
      } catch (emailErr) {
        console.error('⚠️ Error al enviar email (pago registrado correctamente):', emailErr.message);
      }
    }

    res.json({ success: true, message: 'Pago registrado correctamente', pago });
  } catch (err) {
    console.error('Error POST /api/pagos-proveedores:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/pagos-proveedores/:id/marcar-enviado-email-pagos
app.put('/api/pagos-proveedores/:id/marcar-enviado-email-pagos', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pagoId = Number(req.params.id);
    const pago = await pagosProveedoresService.marcarEnviadoEmailPagos(pagoId);
    res.json({ success: true, message: 'Marcado como enviado a email de pagos', pago });
  } catch (err) {
    console.error('Error PUT marcar-enviado-email-pagos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/pagos-proveedores/:id/marcar-enviado-email-facturacion
app.put('/api/pagos-proveedores/:id/marcar-enviado-email-facturacion', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pagoId = Number(req.params.id);
    const pago = await pagosProveedoresService.marcarEnviadoEmailFacturacion(pagoId);
    res.json({ success: true, message: 'Marcado como enviado a email de facturación', pago });
  } catch (err) {
    console.error('Error PUT marcar-enviado-email-facturacion:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/pagos-proveedores/enviar-recordatorio-facturacion/:proveedorId
app.post('/api/pagos-proveedores/enviar-recordatorio-facturacion/:proveedorId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const proveedorId = Number(req.params.proveedorId);

    // Obtener datos del proveedor
    const proveedorQuery = await ejecutarConReintento(`
      SELECT nombre, email_facturacion
      FROM proveedores
      WHERE id = $1
    `, [proveedorId]);

    if (proveedorQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Proveedor no encontrado' });
    }

    const proveedor = proveedorQuery.rows[0];

    if (!proveedor.email_facturacion) {
      return res.status(400).json({ success: false, message: 'El proveedor no tiene email de facturación configurado' });
    }

    // Obtener pagos pendientes de facturar
    const pagosQuery = await ejecutarConReintento(`
      SELECT
        pp.id,
        pp.monto,
        pp.fecha_pago,
        r.folio_interno,
        ri.tipo
      FROM pagos_proveedores pp
      JOIN reservas_items ri ON ri.id = pp.reserva_item_id
      JOIN reservas r ON r.id = ri.reserva_id
      WHERE ri.proveedor_id = $1
        AND pp.solicito_factura = true
        AND pp.enviado_email_facturacion = false
      ORDER BY pp.fecha_pago DESC
    `, [proveedorId]);

    if (pagosQuery.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No hay pagos pendientes de facturar para este proveedor' });
    }

    const items = pagosQuery.rows.map(p => ({
      folio: p.folio_interno,
      tipo: p.tipo,
      monto: p.monto
    }));

    const montoTotal = pagosQuery.rows.reduce((sum, p) => sum + Number(p.monto), 0);

    // Enviar email
    const emailResult = await gmailService.enviarRecordatorioFacturacion({
      emailProveedor: proveedor.email_facturacion,
      nombreProveedor: proveedor.nombre,
      items,
      montoTotal
    });

    if (!emailResult.success) {
      return res.status(500).json({ success: false, message: 'Error al enviar email: ' + emailResult.error });
    }

    // Marcar todos los pagos como enviados
    const pagoIds = pagosQuery.rows.map(p => p.id);
    await ejecutarConReintento(`
      UPDATE pagos_proveedores
      SET enviado_email_facturacion = true, fecha_enviado_facturacion = CURRENT_TIMESTAMP
      WHERE id = ANY($1)
    `, [pagoIds]);

    res.json({
      success: true,
      message: 'Recordatorio de facturación enviado exitosamente',
      items_enviados: items.length,
      monto_total: montoTotal
    });
  } catch (err) {
    console.error('Error POST enviar-recordatorio-facturacion:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// LIST: /api/promos?month=YYYY-MM&destino=texto
app.get('/api/promos', authenticateToken, async (req, res) => {
  try {
    const { month, destino } = req.query;
    const params = [];
    const where = [];

    if (month) {
      where.push(`to_char(fecha_salida, 'YYYY-MM') = $${where.length + 1}`);
      params.push(month);
    }
    if (destino) {
      where.push(`destino ILIKE $${where.length + 1}`);
      params.push(`%${destino}%`);
    }

    const sql = `
      SELECT id, titulo, destino, descripcion,
             todo_incluido, con_transporte, transporte_tipo,
             traslados, incluye_desayuno_llegada, menores_gratis, menores_gratis_politica,
             ninos_2x1, entrega_anticipada,
             precio_adulto, precio_menor, precio_bus_menor,
             to_char(fecha_salida,'YYYY-MM-DD') AS fecha_salida,
             to_char(fecha_llegada,'YYYY-MM-DD') AS fecha_llegada,
             to_char(reserva_inicio,'YYYY-MM-DD') AS reserva_inicio,
             to_char(reserva_fin,'YYYY-MM-DD') AS reserva_fin,
             imagenes, activo,
             created_at, updated_at
      FROM promos
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY fecha_salida ASC, created_at DESC
      LIMIT 300
    `;
    const r = await ejecutarConReintento(sql, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// CREATE
app.post('/api/promos', authenticateToken, async (req, res) => {
  try {
    const p = req.body;

    // Normaliza a URL absoluta y filtra vacíos
    const abs = (u) => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;       // ya es absoluta
      const rel = u.startsWith('/') ? u : `/${u}`; // asegura slash inicial
      return `${BASE_URL}${rel}`;
    };
    const imgs = Array.isArray(p.imagenes)
      ? p.imagenes.map(abs).filter(Boolean)
      : [];

    // DEBUG: verifica en consola qué va a la BD
    console.log('CREATE promos.imagenes =>', imgs);

    const sql = `
      INSERT INTO promos (
        titulo, destino, descripcion,
        todo_incluido, con_transporte, transporte_tipo,
        traslados, incluye_desayuno_llegada, menores_gratis, menores_gratis_politica,
        ninos_2x1, entrega_anticipada,
        precio_adulto, precio_menor, precio_bus_menor,
        fecha_salida, fecha_llegada, reserva_inicio, reserva_fin,
        imagenes, activo
      ) VALUES (
        $1,$2,$3,
        $4,$5,$6,
        $7,$8,$9,$10,
        $11,$12,
        $13,$14,$15,
        $16,$17,$18,$19,
        $20::jsonb,$21
      )
      RETURNING *
    `;
    const params = [
      p.titulo, p.destino, p.descripcion || null,
      !!p.todo_incluido, !!p.con_transporte, p.transporte_tipo || null,
      !!p.traslados, !!p.incluye_desayuno_llegada, !!p.menores_gratis, p.menores_gratis_politica || null,
      !!p.ninos_2x1, !!p.entrega_anticipada,
      p.precio_adulto ?? null, p.precio_menor ?? null, p.precio_bus_menor ?? null,
      p.fecha_salida, p.fecha_llegada, p.reserva_inicio || null, p.reserva_fin || null,
      JSON.stringify(imgs),
      p.activo !== false
    ];
    const r = await ejecutarConReintento(sql, params);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// UPDATE
app.put('/api/promos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const p = req.body;

    // Normaliza a URL absoluta y filtra vacíos
    const abs = (u) => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;
      const rel = u.startsWith('/') ? u : `/${u}`;
      return `${BASE_URL}${rel}`;
    };
    const imgs = Array.isArray(p.imagenes)
      ? p.imagenes.map(abs).filter(Boolean)
      : [];

    // DEBUG: verifica en consola qué va a la BD
    console.log('UPDATE promos.imagenes =>', imgs);

    const sql = `
      UPDATE promos SET
        titulo=$1, destino=$2, descripcion=$3,
        todo_incluido=$4, con_transporte=$5, transporte_tipo=$6,
        traslados=$7, incluye_desayuno_llegada=$8, menores_gratis=$9, menores_gratis_politica=$10,
        ninos_2x1=$11, entrega_anticipada=$12,
        precio_adulto=$13, precio_menor=$14, precio_bus_menor=$15,
        fecha_salida=$16, fecha_llegada=$17, reserva_inicio=$18, reserva_fin=$19,
        imagenes=$20::jsonb, activo=$21, updated_at=NOW()
      WHERE id=$22
      RETURNING *
    `;
    const params = [
      p.titulo, p.destino, p.descripcion || null,
      !!p.todo_incluido, !!p.con_transporte, p.transporte_tipo || null,
      !!p.traslados, !!p.incluye_desayuno_llegada, !!p.menores_gratis, p.menores_gratis_politica || null,
      !!p.ninos_2x1, !!p.entrega_anticipada,
      p.precio_adulto ?? null, p.precio_menor ?? null, p.precio_bus_menor ?? null,
      p.fecha_salida, p.fecha_llegada, p.reserva_inicio || null, p.reserva_fin || null,
      JSON.stringify(imgs),
      p.activo !== false,
      id
    ];
    const r = await ejecutarConReintento(sql, params);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});


// DELETE
app.delete('/api/promos/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await ejecutarConReintento(`DELETE FROM promos WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Analizar imágenes de promos y devolver sugerencia de campos
app.post('/api/promos/analyze', authenticateToken, async (req, res) => {
  try {
    const { imageUrls } = req.body || {};
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.status(400).json({ message: 'imageUrls requerido (array con 1-4 URLs)' });
    }

    // Normaliza a absolutas (por si te llega algo relativo)
    const abs = (u) => {
      if (!u) return u;
      if (/^https?:\/\//i.test(u)) return u;           // ya es absoluta
      const rel = u.startsWith('/') ? u : `/${u}`;     // garantiza slash inicial
      return `${BASE_URL}${rel}`;
    };
    const limited = imageUrls.slice(0, 4).map(abs);

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        titulo: { type: 'string' },
        destino: { type: 'string' },
        descripcion: { type: 'string' },
        todo_incluido: { type: 'boolean' },
        con_transporte: { type: 'boolean' },
        transporte_tipo: { type: ['string', 'null'], enum: ['camion', 'avion', null] },
        traslados: { type: 'boolean' },
        incluye_desayuno_llegada: { type: 'boolean' },
        menores_gratis: { type: 'boolean' },
        menores_gratis_politica: { type: 'string' },
        ninos_2x1: { type: 'boolean' },
        entrega_anticipada: { type: 'boolean' },
        precio_adulto: { type: ['number', 'null'] },
        precio_menor: { type: ['number', 'null'] },
        precio_bus_menor: { type: ['number', 'null'] },
        fecha_salida: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        fecha_llegada: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        reserva_inicio: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        reserva_fin: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
      },
      required: [
        'titulo',
        'destino',
        'descripcion',
        'todo_incluido',
        'con_transporte',
        'transporte_tipo',
        'traslados',
        'incluye_desayuno_llegada',
        'menores_gratis',
        'menores_gratis_politica',
        'ninos_2x1',
        'entrega_anticipada',
        'precio_adulto',
        'precio_menor',
        'precio_bus_menor',
        'fecha_salida',
        'fecha_llegada',
        'reserva_inicio',
        'reserva_fin'
      ]

    };

    const instructions =
      `Extrae datos claros de estas imágenes de una promoción turística (México).
- NO inventes precios ni fechas: si no se ve con claridad, deja null o vacío.
- Devuelve JSON con este significado:
  - "titulo": nombre de hotel o título comercial (string).
  - "destino": playa/ciudad (string).
  - "descripcion": copy breve si el arte lo sugiere (string).
  - "todo_incluido": true si dice TI/Todo Incluido (boolean).
  - "con_transporte": true si explícitamente incluye transporte (boolean).
  - "transporte_tipo": "camion" si autobús, "avion" si vuelo, o null si no aplica.
  - "traslados": true si incluye traslados aeropuerto-hotel-aeropuerto.
  - "incluye_desayuno_llegada": true si dice desayuno a la llegada.
  - "menores_gratis": true si menciona menores gratis (en hospedaje).
  - "menores_gratis_politica": texto corto con condiciones (si lo menciona).
  - "ninos_2x1": true si hay 2x1 en menores.
  - "entrega_anticipada": true si dice entrega anticipada de habitación.
  - "precio_adulto": número MXN si aparece (sin signos), o null.
  - "precio_menor": número MXN si aparece, o null.
  - "precio_bus_menor": número MXN si indica que el menor paga bus, o null.
  - "fecha_salida" y "fecha_llegada": YYYY-MM-DD si hay rango exacto; si no, null.
  - "reserva_inicio" y "reserva_fin": ventana de reserva si se ve, YYYY-MM-DD o null.`;

    // Convierte URLs locales (/uploads o localhost) a data:base64 para que OpenAI pueda leerlas
    const mimeFromExt = (ext) => {
      const e = (ext || '').toLowerCase();
      if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
      if (e === '.png') return 'image/png';
      if (e === '.gif') return 'image/gif';
      return 'application/octet-stream';
    };

    const toImageUrlOrData = async (u) => {
      try {
        if (!u) return u;
        // si es absoluta y NO es localhost, la dejamos pasar
        if (/^https?:\/\//i.test(u) && !/localhost/i.test(u)) return u;

        // Caso localhost o relativa: resolvemos a archivo dentro de /uploads y lo embebemos
        // Soportamos tanto '/uploads/...' como 'http://localhost:3000/uploads/...'
        const pathname = (() => {
          if (/^https?:\/\//i.test(u)) return new URL(u).pathname;
          return u.startsWith('/') ? u : `/${u}`;
        })();

        const filename = path.basename(pathname); // requiere 'path' (ya importado arriba)
        const filePath = path.join(UPLOAD_DIR, filename); // requiere UPLOAD_DIR (ya definido arriba)

        const buf = await fsPromises.readFile(filePath); // requiere fsPromises (ya importado)
        const ext = path.extname(filename);
        const mime = mimeFromExt(ext);
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch (e) {
        console.error('toImageUrlOrData error:', e);
        return u; // como fallback, deja la URL tal cual
      }
    };

    const imageParts = await Promise.all(limited.map(toImageUrlOrData));

    const inputContent = [
      { type: 'input_text', text: instructions },
      ...imageParts.map((url) => ({ type: 'input_image', image_url: url }))
    ];



    const ai = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: [{ role: 'user', content: inputContent }],
      // ⚠️ Responses API: el formato se especifica en text.format
      text: {
        format: {
          type: 'json_schema',
          name: 'PromoExtraction',
          schema,
          strict: true
        }
      },



      max_output_tokens: 800
    });

    // Extraer texto JSON robustamente
    let raw = '';
    if (ai?.output_text) {
      raw = ai.output_text;
    } else if (Array.isArray(ai?.output) && ai.output[0]?.content?.[0]?.text) {
      raw = ai.output[0].content[0].text;
    } else {
      raw = '{}';
    }

    let suggestion = {};
    try { suggestion = JSON.parse(raw); } catch { suggestion = {}; }

    // Normalización
    const asNum = (v) => (v === '' || v == null ? null : Number(v));
    const dateOrNull = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

    const normalized = {
      titulo: suggestion.titulo || '',
      destino: suggestion.destino || '',
      descripcion: suggestion.descripcion || '',
      todo_incluido: !!suggestion.todo_incluido,
      con_transporte: !!suggestion.con_transporte,
      transporte_tipo: ['camion', 'avion'].includes(suggestion.transporte_tipo) ? suggestion.transporte_tipo : null,
      traslados: !!suggestion.traslados,
      incluye_desayuno_llegada: !!suggestion.incluye_desayuno_llegada,
      menores_gratis: !!suggestion.menores_gratis,
      menores_gratis_politica: suggestion.menores_gratis_politica || '',
      ninos_2x1: !!suggestion.ninos_2x1,
      entrega_anticipada: !!suggestion.entrega_anticipada,
      precio_adulto: asNum(suggestion.precio_adulto),
      precio_menor: asNum(suggestion.precio_menor),
      precio_bus_menor: asNum(suggestion.precio_bus_menor),
      fecha_salida: dateOrNull(suggestion.fecha_salida),
      fecha_llegada: dateOrNull(suggestion.fecha_llegada),
      reserva_inicio: dateOrNull(suggestion.reserva_inicio),
      reserva_fin: dateOrNull(suggestion.reserva_fin)
    };

    return res.json({ suggestion: normalized });
  } catch (e) {
    console.error('analyze error:', e);
    res.status(500).json({ message: e.message || 'Error analizando imágenes' });
  }
});

// Página de Hotelpedia (SPA)
app.get('/hotelpedia', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hotelpedia.html'));
});

// Página de Proveedores (solo ADMIN)
app.get('/proveedores', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proveedores.html'));
});

// Página de Reservas
app.get('/reservas', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reservas.html'));
});


// Endpoint para obtener la lista de chats
app.get('/chat-list', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        m.numero_telefono,
        m.mensaje AS ultimo_mensaje,
        m.fecha_hora AS ultima_actividad,
        COALESCE(c.nombre, m.numero_telefono) AS nombre_contacto,
        COALESCE(ca.nombre_usuario, 'No asignado') AS asignado,
        CASE 
          WHEN asst.active IS TRUE THEN 'Activo'
          ELSE 'Inactivo'
        END AS asistente,
        (
          SELECT COUNT(*) 
          FROM mensajes m2 
          WHERE m2.numero_telefono = m.numero_telefono 
            AND m2.leido = FALSE
        ) AS unread_count
      FROM mensajes m
      JOIN (
        SELECT numero_telefono, MAX(fecha_hora) AS max_fecha
        FROM mensajes
        GROUP BY numero_telefono
      ) mm 
        ON m.numero_telefono = mm.numero_telefono 
       AND m.fecha_hora = mm.max_fecha
      LEFT JOIN chat_assignments ca 
        ON m.numero_telefono = ca.numero_telefono
      LEFT JOIN contactos c
        ON m.numero_telefono = c.numero_telefono
      LEFT JOIN assistant_status asst
        ON m.numero_telefono = asst.numero_telefono
      ORDER BY m.fecha_hora DESC;
    `;
    const result = await ejecutarConReintento(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error en chat-list:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al obtener la lista de chats' });
  }
});

app.post('/mark-as-read/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const phoneNumber = req.params.phoneNumber;
    const updateQuery = `
      UPDATE mensajes
      SET leido = TRUE
      WHERE numero_telefono = $1 AND leido = FALSE
    `;
    await ejecutarConReintento(updateQuery, [phoneNumber]);
    res.json({ success: true, message: 'Mensajes marcados como leídos' });
  } catch (error) {
    console.error('Error al marcar mensajes como leídos:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al actualizar el estado de lectura' });
  }
});

// Resto de endpoints (messages, notes, scheduled-messages, chat-assignment, etc.)
app.get('/messages/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        numero_telefono,
        mensaje AS message,
        tipo_remitente AS sender_type,
        fecha_hora AS timestamp,
        nombre_usuario,
        usuario_id,
        tipo_contenido,
        url_archivo,
        nombre_archivo,
        tamano_archivo,
        estado,
        'message' AS type
      FROM mensajes 
      WHERE numero_telefono = $1 
      ORDER BY fecha_hora ASC;
    `;
    const result = await ejecutarConReintento(query, [req.params.phoneNumber]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ success: false, message: 'Error al obtener mensajes' });
  }
});

app.get('/notes/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT id, numero_telefono, nota, fecha_creacion, usuario_id, nombre_usuario
      FROM notas_internas 
      WHERE numero_telefono = $1 
      ORDER BY fecha_creacion DESC;
    `;
    const result = await ejecutarConReintento(query, [req.params.phoneNumber]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener notas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener notas' });
  }
});

app.get('/scheduled-messages/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT id, numero_telefono, mensaje, fecha_envio, usuario_id, nombre_usuario, enviado, mensaje_id
      FROM mensajes_programados 
      WHERE numero_telefono = $1 AND enviado = FALSE
      ORDER BY fecha_envio ASC;
    `;
    const result = await ejecutarConReintento(query, [req.params.phoneNumber]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener mensajes programados:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al obtener mensajes programados' });
  }
});

app.get('/assistant-status/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const query = `SELECT active FROM assistant_status WHERE numero_telefono = $1;`;
    const result = await ejecutarConReintento(query, [req.params.phoneNumber]);
    if (result.rows.length > 0) {
      res.json({ active: result.rows[0].active });
    } else {
      // Si no existe registro, devolvemos el valor por defecto (por ejemplo, TRUE)
      res.json({ active: true });
    }
  } catch (error) {
    console.error('Error al obtener estado del asistente:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al obtener estado del asistente' });
  }
});

app.get('/chat-assignment/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const query = `SELECT * FROM chat_assignments WHERE numero_telefono = $1;`;
    const result = await ejecutarConReintento(query, [req.params.phoneNumber]);
    if (result.rows.length > 0) {
      res.json({
        assigned: true,
        assignedTo: result.rows[0].nombre_usuario
      });
    } else {
      res.json({
        assigned: false,
        assignedTo: null
      });
    }
  } catch (error) {
    console.error('Error al verificar asignación:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al verificar asignación' });
  }
});

app.get('/chat-access/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const userType = req.user.userType;
    const phoneNumber = req.params.phoneNumber;
    if (userType === 'admin') {
      return res.json({ hasAccess: true, message: 'Acceso administrativo' });
    }
    const query = `SELECT * FROM chat_assignments WHERE numero_telefono = $1;`;
    const result = await ejecutarConReintento(query, [phoneNumber]);
    if (result.rows.length === 0) {
      return res.json({ hasAccess: true, message: 'Chat no asignado' });
    }
    const hasAccess = result.rows[0].nombre_usuario === req.user.username;
    res.json({
      hasAccess: hasAccess,
      message: hasAccess ? 'Chat asignado a ti' : 'Chat asignado a otro usuario',
      assignedTo: result.rows[0].nombre_usuario
    });
  } catch (error) {
    console.error('Error al verificar acceso:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al verificar acceso al chat' });
  }
});

app.post('/toggle-assistant', authenticateToken, async (req, res) => {
  try {
    const { numeroTelefono } = req.body;
    if (!req.user || !req.user.id) {
      return res
        .status(400)
        .json({ success: false, message: 'Usuario no identificado correctamente' });
    }
    const upsertQuery = `
      INSERT INTO assistant_status (numero_telefono, active)
      VALUES ($1, TRUE)
      ON CONFLICT (numero_telefono)
      DO UPDATE SET active = NOT assistant_status.active,
                    fecha_actualizacion = CURRENT_TIMESTAMP
      RETURNING active;
    `;
    const result = await ejecutarConReintento(upsertQuery, [numeroTelefono]);
    res.json({
      success: true,
      active: result.rows[0].active,
      message: result.rows[0].active
        ? 'Asistente activado'
        : 'Asistente desactivado'
    });
  } catch (error) {
    console.error('Error en toggle-assistant:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al cambiar estado del asistente' });
  }
});

app.post('/toggle-chat-assignment', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const checkQuery = 'SELECT * FROM chat_assignments WHERE numero_telefono = $1';
    const checkResult = await ejecutarConReintento(checkQuery, [phoneNumber]);
    if (checkResult.rows.length > 0) {
      const currentAssignment = checkResult.rows[0];
      if (
        currentAssignment.nombre_usuario !== req.user.username &&
        req.user.userType !== 'admin'
      ) {
        return res.status(403).json({
          success: false,
          message: 'No tienes permiso para desasignar este chat'
        });
      }
      const deleteQuery =
        'DELETE FROM chat_assignments WHERE numero_telefono = $1 RETURNING *';
      await ejecutarConReintento(deleteQuery, [phoneNumber]);
      res.json({
        success: true,
        message: 'Chat desasignado correctamente',
        assigned: false,
        assignedTo: null
      });
    } else {
      const assignQuery = `
        INSERT INTO chat_assignments (numero_telefono, usuario_id, nombre_usuario, fecha_asignacion)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        RETURNING *
      `;
      const result = await ejecutarConReintento(assignQuery, [
        phoneNumber,
        req.user.id,
        req.user.username
      ]);
      res.json({
        success: true,
        message: 'Chat asignado correctamente',
        assigned: true,
        assignedTo: req.user.username
      });
    }
  } catch (error) {
    console.error('Error en toggle-chat-assignment:', error);
    res.status(500).json({
      success: false,
      message: 'Error al cambiar asignación del chat',
      error: error.message
    });
  }
});

app.post('/upload-file', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const whatsappService = req.app.get('whatsappService');
    if (!whatsappService.isReady()) {
      return res
        .status(503)
        .json({ success: false, message: 'Servicio de WhatsApp no está listo' });
    }
    if (!req.file) {
      throw new Error('No se recibió ningún archivo');
    }
    const NGROK_URL = process.env.BASE_URL || process.env.NGROK_URL || `http://localhost:${PORT}`;
    const fileUrl = `${NGROK_URL}/uploads/${req.file.filename}`;
    const caption = req.body.caption || '';
    const result = await whatsappService.sendMessage(
      req.body.phoneNumber,
      caption + `\n[Archivo: ${fileUrl}]`
    );
    res.json({
      success: true,
      message: 'Archivo (caption) enviado correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error procesando archivo:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/programar-mensaje', authenticateToken, async (req, res) => {
  try {
    const { numeroTelefono, mensaje, fechaEnvio } = req.body;
    if (!numeroTelefono || !mensaje || !fechaEnvio) {
      return res
        .status(400)
        .json({ success: false, message: 'Todos los campos son requeridos' });
    }
    const query = `
      INSERT INTO mensajes_programados (numero_telefono, mensaje, fecha_envio, usuario_id, nombre_usuario, enviado)
      VALUES ($1, $2, $3, $4, $5, FALSE)
      RETURNING *;
    `;
    const result = await ejecutarConReintento(query, [
      numeroTelefono,
      mensaje,
      fechaEnvio,
      req.user.id,
      req.user.username
    ]);
    res.json({
      success: true,
      message: 'Mensaje programado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al programar mensaje:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al programar el mensaje' });
  }
});

app.post('/guardar-nota', authenticateToken, async (req, res) => {
  try {
    const { numeroTelefono, nota } = req.body;
    if (!numeroTelefono || !nota) {
      return res
        .status(400)
        .json({ success: false, message: 'Número de teléfono y nota son requeridos' });
    }
    const query = `
      INSERT INTO notas_internas (numero_telefono, nota, fecha_creacion, usuario_id, nombre_usuario)
      VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)
      RETURNING *;
    `;
    const result = await ejecutarConReintento(query, [
      numeroTelefono,
      nota,
      req.user.id,
      req.user.username
    ]);
    res.json({
      success: true,
      message: 'Nota guardada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al guardar nota:', error);
    res.status(500).json({ success: false, message: 'Error al guardar la nota' });
  }
});

app.delete('/delete-note/:id', authenticateToken, async (req, res) => {
  try {
    const query = 'DELETE FROM notas_internas WHERE id = $1 RETURNING *;';
    const result = await ejecutarConReintento(query, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Nota no encontrada' });
    }
    res.json({
      success: true,
      message: 'Nota eliminada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al eliminar nota:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al eliminar la nota' });
  }
});

app.delete('/delete-scheduled-message/:id', authenticateToken, async (req, res) => {
  try {
    const query = 'DELETE FROM mensajes_programados WHERE id = $1 RETURNING *;';
    const result = await ejecutarConReintento(query, [req.params.id]);
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Mensaje programado no encontrado' });
    }
    res.json({
      success: true,
      message: 'Mensaje programado eliminado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al eliminar mensaje programado:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al eliminar el mensaje programado' });
  }
});

app.post('/usuarios', authenticateToken, async (req, res) => {
  try {
    if (req.user.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'No autorizado' });
    }
    const { username, password, userType } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `
      INSERT INTO usuarios (nombre_usuario, password, tipo_usuario)
      VALUES ($1, $2, $3)
      RETURNING id, nombre_usuario, tipo_usuario;
    `;
    const result = await ejecutarConReintento(query, [
      username,
      hashedPassword,
      userType
    ]);
    res.status(201).json({
      success: true,
      message: 'Usuario creado correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res
      .status(500)
      .json({ message: 'Error al crear usuario', error: error.message });
  }
});

app.get('/api/etiquetas', authenticateToken, async (req, res) => {
  try {
    const query = 'SELECT * FROM etiquetas WHERE activo = TRUE;';
    const result = await ejecutarConReintento(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener etiquetas:', error);
    res
      .status(500)
      .json({ success: false, message: 'Error al obtener etiquetas' });
  }
});

app.post('/api/etiquetas', authenticateToken, async (req, res) => {
  try {
    const { nombre, color, descripcion, prioridad } = req.body;
    if (!nombre || nombre.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'El nombre de la etiqueta es requerido'
      });
    }
    const hexColorRegex = /^#([0-9A-F]{3}){1,2}$/i;
    if (!color || !hexColorRegex.test(color)) {
      return res.status(400).json({
        success: false,
        message: 'Color inválido. Debe ser un color hexadecimal válido'
      });
    }
    const existingTagQuery =
      'SELECT * FROM etiquetas WHERE LOWER(nombre) = LOWER($1);';
    const existingTagResult = await ejecutarConReintento(existingTagQuery, [
      nombre
    ]);
    if (existingTagResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe una etiqueta con este nombre'
      });
    }
    const ultimaPrioridadQuery =
      'SELECT MAX(prioridad) as ultima_prioridad FROM etiquetas;';
    const ultimaResult = await ejecutarConReintento(ultimaPrioridadQuery);
    const ultimaPrioridad = ultimaResult.rows[0].ultima_prioridad || 0;
    const nuevaPrioridad = prioridad || ultimaPrioridad + 1;
    const query = `
      INSERT INTO etiquetas (nombre, color, descripcion, prioridad, activo)
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING *;
    `;
    const result = await ejecutarConReintento(query, [
      nombre.trim(),
      color.toUpperCase(),
      descripcion ? descripcion.trim() : '',
      nuevaPrioridad
    ]);
    io.emit('tagsUpdated', {
      success: true,
      message: 'Nueva etiqueta creada',
      data: result.rows[0]
    });
    res.status(201).json({
      success: true,
      message: 'Etiqueta creada correctamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error al crear etiqueta:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear la etiqueta',
      error: error.message
    });
  }
});

app.get('/api/chat/etiquetas/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const etiquetas = await getEtiquetasChat(req.params.phoneNumber);
    res.json(etiquetas);
  } catch (error) {
    console.error('Error al obtener etiquetas del chat:', error);
    res.status(500).json({ message: 'Error al obtener etiquetas' });
  }
});
// server.js
app.post('/api/chat/etiqueta', authenticateToken, async (req, res) => {
  try {
    const { numeroTelefono, etiquetaId } = req.body;
    if (!numeroTelefono || !etiquetaId) {
      return res.status(400).json({
        success: false,
        message: 'Número de teléfono y ID de etiqueta son requeridos'
      });
    }

    // Asignar/desasignar etiqueta
    const result = await toggleEtiqueta(numeroTelefono, etiquetaId, req.user.id);

    // (1) Obtener la lista final de etiquetas del chat
    const updatedTags = await getEtiquetasChat(numeroTelefono);

    // (2) Emitir un único evento
    io.emit('tagsUpdated', {
      phoneNumber: numeroTelefono,
      changedTagId: etiquetaId,
      toggled: result.toggled,  // "added" o "removed"
      assignedTags: updatedTags, // Por si el front lo necesita
      success: true
    });
    console.log('Emitiendo evento tagsUpdated desde server:', {
      phoneNumber: numeroTelefono,
      changedTagId: etiquetaId,
      assignedTags: updatedTags
    });

    res.json({
      success: true,
      message: 'Etiqueta actualizada correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error en toggle de etiqueta:', error);
    res.status(500).json({
      success: false,
      message: 'Error al modificar etiqueta',
      error: error.message
    });
  }
});

// Función para mensajes programados y envío directo
async function checkAndSendScheduledMessages() {
  try {
    const query = `
      SELECT * FROM mensajes_programados 
      WHERE enviado = FALSE 
      AND fecha_envio <= CURRENT_TIMESTAMP;
    `;
    const result = await ejecutarConReintento(query);
    const whatsappService = app.get('whatsappService');

    for (const mensaje of result.rows) {
      try {
        // 1) Enviamos por Baileys
        await whatsappService.sendMessage(mensaje.numero_telefono, mensaje.mensaje);

        // 2) Insertamos en la tabla mensajes
        const insertQuery = `
          INSERT INTO mensajes (
            numero_telefono,
            mensaje,
            tipo_remitente,
            fecha_hora,
            usuario_id,
            nombre_usuario,
            tipo_contenido,
            url_archivo,
            estado
          )
          VALUES ($1, $2, 'sent', CURRENT_TIMESTAMP, $3, $4, $5, $6, 'sent')
          RETURNING id;
        `;
        const insertResult = await ejecutarConReintento(insertQuery, [
          mensaje.numero_telefono,
          mensaje.mensaje,
          mensaje.usuario_id,
          mensaje.nombre_usuario,
          mensaje.tipo_contenido,
          mensaje.url_archivo
        ]);

        // 3) Actualizamos mensaje_programado a enviado
        await ejecutarConReintento(
          'UPDATE mensajes_programados SET enviado = TRUE, mensaje_id = $1 WHERE id = $2;',
          [insertResult.rows[0].id, mensaje.id]
        );

        // 4) Emitir al frontend
        io.emit('newMessage', {
          phoneNumber: mensaje.numero_telefono,
          message: mensaje.mensaje,
          sender_type: 'sent',
          timestamp: new Date(),
          username: mensaje.nombre_usuario,
          tipo_contenido: mensaje.tipo_contenido,
          url_archivo: mensaje.url_archivo
        });
      } catch (error) {
        console.error(`Error al enviar mensaje programado ${mensaje.id}:`, error);
        await ejecutarConReintento(
          'UPDATE mensajes_programados SET error = $1 WHERE id = $2;',
          [error.message, mensaje.id]
        );
      }
    }
  } catch (error) {
    console.error('Error al verificar mensajes programados:', error);
  }
}

app.post('/send-message', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber, message, userId, username } = req.body;
    if (!phoneNumber || !message) {
      return res.status(400).json({ success: false, message: 'Faltan datos' });
    }

    const whatsappService = req.app.get('whatsappService');
    if (!whatsappService.isReady()) {
      return res
        .status(503)
        .json({ success: false, message: 'WhatsApp no está listo' });
    }

    // El whatsappService.sendMessage() YA guarda en BD y emite eventos
    // Solo necesitamos pasarle el nombre de usuario en las opciones
    await whatsappService.sendMessage(
      phoneNumber,
      message,
      null, // mediaUrl
      null, // mediaType
      null, // fileName
      { nombre_usuario: username || 'Usuario' } // options
    );

    res.json({ success: true, message: 'Mensaje enviado correctamente' });
  } catch (error) {
    console.error('Error en /send-message:', error);
    res.status(500).json({ success: false, message: 'Error al enviar mensaje' });
  }
});


// Bloquear un número
app.post('/block-number', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber, razon } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Falta phoneNumber' });
    }
    const userId = req.user.id; // el id del usuario logueado
    const insertQuery = `
      INSERT INTO blocked_numbers (numero_telefono, user_id, razon)
      VALUES ($1, $2, $3)
      ON CONFLICT (numero_telefono)
      DO NOTHING;
    `;
    await ejecutarConReintento(insertQuery, [phoneNumber, userId, razon || '']);
    res.json({ success: true, message: `Número ${phoneNumber} bloqueado con éxito` });
  } catch (error) {
    console.error('Error en /block-number:', error);
    res.status(500).json({ success: false, message: 'Error al bloquear' });
  }
});

// Desbloquear un número
app.delete('/block-number/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Falta phoneNumber' });
    }
    const deleteQuery = `
      DELETE FROM blocked_numbers
      WHERE numero_telefono = $1
    `;
    await ejecutarConReintento(deleteQuery, [phoneNumber]);
    res.json({ success: true, message: `Número ${phoneNumber} desbloqueado` });
  } catch (error) {
    console.error('Error en DELETE /block-number:', error);
    res.status(500).json({ success: false, message: 'Error al desbloquear' });
  }
});
// Verificar si un número está bloqueado
app.get('/block-number/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Falta phoneNumber' });
    }
    const checkQuery = `
      SELECT 1
      FROM blocked_numbers
      WHERE numero_telefono = $1
      LIMIT 1
    `;
    const result = await ejecutarConReintento(checkQuery, [phoneNumber]);
    const isBlocked = result.rows.length > 0;

    res.json({ success: true, blocked: isBlocked });
  } catch (error) {
    console.error('Error en GET /block-number/:phoneNumber:', error);
    res.status(500).json({ success: false, message: 'Error al verificar bloqueo' });
  }
});

app.delete('/api/etiquetas/:id', authenticateToken, async (req, res) => {
  try {
    const tagId = parseInt(req.params.id, 10);
    const defaultTagNames = ['Frio', 'SIC', 'MP', 'MCP', 'Seguimiento', 'Reservar', 'Cerrado'];
    const getTagQuery = 'SELECT nombre FROM etiquetas WHERE id = $1';
    const tagResult = await ejecutarConReintento(getTagQuery, [tagId]);

    if (tagResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Etiqueta no encontrada' });
    }

    // Si el nombre está en la lista de “prohibidos”, retornar error
    if (defaultTagNames.includes(tagResult.rows[0].nombre.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'No se pueden eliminar etiquetas predefinidas'
      });
    }
    const deleteChatEtiquetas = `
      DELETE FROM chat_etiquetas
      WHERE etiqueta_id = $1;
    `;
    await ejecutarConReintento(deleteChatEtiquetas, [tagId]);

    const deleteEtiquetaQuery = `
      DELETE FROM etiquetas
      WHERE id = $1
      RETURNING *;
    `;
    const result = await ejecutarConReintento(deleteEtiquetaQuery, [tagId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Etiqueta no encontrada'
      });
    }

    // Opcional: emitir un evento Socket.io “tagsUpdated”...
    res.json({ success: true, message: 'Etiqueta eliminada correctamente' });

  } catch (error) {
    console.error('Error al eliminar etiqueta:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar la etiqueta',
      error: error.message
    });
  }
});



app.delete('/delete-chat/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Falta phoneNumber' });
    }

    // 1) Recopilar rutas de archivos multimedia
    const selectFilesQuery = `
      SELECT am.ruta_archivo
      FROM archivos_multimedia am
      JOIN mensajes m ON am.mensaje_id = m.id
      WHERE m.numero_telefono = $1
    `;
    const filesResult = await ejecutarConReintento(selectFilesQuery, [phoneNumber]);

    // 2) Eliminar físicamente cada archivo
    for (const row of filesResult.rows) {
      const filePath = row.ruta_archivo;
      if (!filePath) continue;
      try {
        await fsPromises.unlink(filePath);
        console.log('Archivo eliminado:', filePath);
      } catch (err) {
        console.error('No se pudo eliminar el archivo:', filePath, err);
      }
    }

    // 3) Borrar de la tabla archivos_multimedia
    const deleteMediaQuery = `
      DELETE FROM archivos_multimedia
      USING mensajes
      WHERE archivos_multimedia.mensaje_id = mensajes.id
        AND mensajes.numero_telefono = $1
    `;
    await ejecutarConReintento(deleteMediaQuery, [phoneNumber]);

    // 4) Borrar mensajes, notas, etc.
    await ejecutarConReintento('DELETE FROM mensajes WHERE numero_telefono = $1;', [phoneNumber]);
    await ejecutarConReintento('DELETE FROM notas_internas WHERE numero_telefono = $1;', [phoneNumber]);
    await ejecutarConReintento('DELETE FROM chat_etiquetas WHERE numero_telefono = $1;', [phoneNumber]);
    await ejecutarConReintento('DELETE FROM mensajes_programados WHERE numero_telefono = $1;', [phoneNumber]);
    await ejecutarConReintento('DELETE FROM chat_assignments WHERE numero_telefono = $1;', [phoneNumber]);

    // Opcional: borrar de contactos
    // await ejecutarConReintento('DELETE FROM contactos WHERE numero_telefono = $1;', [phoneNumber]);

    res.json({
      success: true,
      message: `Todos los mensajes, multimedia y datos del número ${phoneNumber} fueron eliminados.`
    });

  } catch (error) {
    console.error('Error en DELETE /delete-chat:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar el chat (y multimedia).'
    });
  }
});

app.put('/contacts/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const { nombre } = req.body;
    if (!nombre || !phoneNumber) {
      return res.status(400).json({ success: false, message: 'Datos faltantes' });
    }

    const sql = `
      UPDATE contactos 
      SET nombre = $1, fecha_actualizacion = NOW() 
      WHERE numero_telefono = $2
      RETURNING *;
    `;
    const result = await ejecutarConReintento(sql, [nombre, phoneNumber]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'No encontrado' });
    }

    // Emitir evento por Socket.IO para que todas las instancias se actualicen
    io.emit('contactUpdated', {
      success: true,
      phoneNumber,
      nombre
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error en PUT /contacts:', error);
    res.status(500).json({ success: false, message: 'Error', error: error.message });
  }
});

// Ruta GET para obtener el contacto por número de teléfono
// GET /contacts - Obtener todos los contactos
app.get('/contacts', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;

    const query = `
      SELECT id, numero_telefono, nombre, email, fecha_creacion
      FROM contactos
      ORDER BY nombre ASC, numero_telefono ASC
      LIMIT $1 OFFSET $2;
    `;

    const result = await ejecutarConReintento(query, [limit, offset]);

    res.json({
      success: true,
      contacts: result.rows
    });
  } catch (error) {
    console.error('Error al obtener contactos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contactos'
    });
  }
});

app.get('/contacts/:phoneNumber', authenticateToken, async (req, res) => {
  try {
    const phoneNumber = req.params.phoneNumber;

    const query = `
      SELECT id, numero_telefono, nombre, email
      FROM contactos
      WHERE numero_telefono = $1
      LIMIT 1;
    `;

    const result = await ejecutarConReintento(query, [phoneNumber]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contacto no encontrado'
      });
    }

    // Retornamos la info en la propiedad "data" para que coincida con tu frontend
    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        numero_telefono: result.rows[0].numero_telefono,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email
      }
    });
  } catch (error) {
    console.error('Error al obtener contacto:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contacto'
    });
  }
});



// Ruta para enviar mensajes masivos
app.post('/send-bulk-messages', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const whatsappService = req.app.get('whatsappService');
    if (!whatsappService.isReady()) {
      return res.status(503).json({ success: false, message: 'Servicio de WhatsApp no está listo' });
    }

    let phoneNumbers = [];
    if (req.body.phoneNumbers) {
      try {
        phoneNumbers = JSON.parse(req.body.phoneNumbers);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Formato de números de teléfono inválido' });
      }
    }

    const message = req.body.message;
    const isScheduled = req.body.isScheduled === 'true';
    const scheduleDateTime = req.body.scheduleDateTime;

    if (!message || !phoneNumbers || !phoneNumbers.length) {
      return res.status(400).json({ success: false, message: 'Mensaje y números de teléfono son requeridos' });
    }

    // Manejar archivo adjunto si existe
    let fileUrl = null;
    let fileType = null;
    let fileName = null;

    if (req.file) {
      const NGROK_URL = process.env.NGROK_URL || `http://localhost:${PORT}`;
      fileUrl = `${NGROK_URL}/uploads/${req.file.filename}`;
      fileType = req.file.mimetype;
      fileName = req.file.originalname;
    }

    const results = [];
    const errors = [];

    // Formatear todos los números correctamente
    const formattedNumbers = phoneNumbers.map(num => {
      let clean = num.toString().replace(/\D/g, '');
      if (clean.length === 10) return `521${clean}`;
      if (clean.length === 11 && clean.startsWith('52')) return `521${clean.substring(2)}`;
      return clean;
    });

    // Enviar mensajes programados o inmediatos
    if (isScheduled && scheduleDateTime) {
      const scheduledDate = new Date(scheduleDateTime);

      for (const phoneNumber of formattedNumbers) {
        try {
          await ejecutarConReintento(`
            INSERT INTO mensajes_programados (
              numero_telefono, 
              mensaje, 
              fecha_envio, 
              usuario_id, 
              nombre_usuario, 
              enviado,
              tipo_contenido,
              url_archivo,
              nombre_archivo
            )
            VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8)
          `, [
            phoneNumber,
            message,
            scheduledDate,
            req.user.id,
            req.user.username,
            fileType,
            fileUrl,
            fileName
          ]);

          results.push({ phoneNumber, success: true });
        } catch (error) {
          console.error(`Error al programar mensaje para ${phoneNumber}:`, error);
          errors.push({ phoneNumber, error: error.message });
        }
      }

      res.json({
        success: true,
        message: `${results.length} mensajes programados para ${scheduledDate.toLocaleString()}`,
        total: formattedNumbers.length,
        successful: results.length,
        failed: errors.length,
        errors
      });

    } else {
      // Envío inmediato
      for (const phoneNumber of formattedNumbers) {
        try {
          await whatsappService.sendMessage(
            phoneNumber,
            message,
            fileUrl,
            fileType ? (fileType.startsWith('image') ? 'image' :
              fileType.startsWith('video') ? 'video' : 'document') : null,
            fileName
          );

          // Registrar en la base de datos
          const insertSql = `
            INSERT INTO mensajes (
              numero_telefono,
              mensaje,
              tipo_remitente,
              fecha_hora,
              usuario_id,
              nombre_usuario,
              tipo_contenido,
              url_archivo,
              nombre_archivo,
              estado
            )
            VALUES (
              $1, $2, 'sent', CURRENT_TIMESTAMP, $3, $4, $5, $6, $7, 'sent'
            )
          `;

          await ejecutarConReintento(insertSql, [
            phoneNumber,
            message,
            req.user.id,
            req.user.username,
            fileType,
            fileUrl,
            fileName
          ]);

          results.push({ phoneNumber, success: true });

          // Emitir evento para actualizar la interfaz
          io.emit('messageSent', {
            phoneNumber,
            message,
            sender_type: 'sent',
            timestamp: new Date(),
            username: req.user.username
          });

        } catch (error) {
          console.error(`Error al enviar mensaje a ${phoneNumber}:`, error);
          errors.push({ phoneNumber, error: error.message });
        }
      }

      res.json({
        success: true,
        message: `Mensajes enviados a ${results.length} de ${formattedNumbers.length} destinatarios`,
        total: formattedNumbers.length,
        successful: results.length,
        failed: errors.length,
        errors
      });
    }

  } catch (error) {
    console.error('Error en /send-bulk-messages:', error);
    res.status(500).json({
      success: false,
      message: 'Error al procesar mensajes masivos',
      error: error.message
    });
  }
});




// =========================
// RESERVAS & PAGOS (Core Operativo)
// =========================

// Utilidad: obtener porcentaje de comisión por proveedor según método
async function _getProveedorPct(client, proveedorId, metodo) {
  const q = `SELECT comision_efectivo, comision_tarjeta FROM proveedores WHERE id = $1`;
  const { rows } = await client.query(q, [proveedorId]);
  if (!rows.length) throw new Error(`Proveedor ${proveedorId} no existe`);
  const { comision_efectivo = 15, comision_tarjeta = 10 } = rows[0];
  if (metodo === 'TARJETA') return Number(comision_tarjeta) || 10;
  // TRANSFERENCIA => tratamos como EFECTIVO por política
  return Number(comision_efectivo) || 15;
}

// Utilidad: recalcular estado de la reserva (APARTADA / LIQUIDADA)
async function _actualizarEstadoReserva(client, reservaId) {
  // Totales
  const totSql = `
    WITH tot AS (
      SELECT r.id AS reserva_id,
             COALESCE(SUM(ri.precio_cliente),0) AS total_cliente
      FROM reservas r
      LEFT JOIN reservas_items ri ON ri.reserva_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
    ),
    cob AS (
      SELECT reserva_id, COALESCE(SUM(monto),0) AS cobrado
      FROM pagos_clientes
      WHERE reserva_id = $1 AND estado='CONFIRMADO'
      GROUP BY reserva_id
    )
    SELECT t.reserva_id, t.total_cliente, COALESCE(c.cobrado,0) AS cobrado,
           (t.total_cliente - COALESCE(c.cobrado,0)) AS saldo_cliente
    FROM tot t
    LEFT JOIN cob c ON c.reserva_id = t.reserva_id
  `;
  const tot = await client.query(totSql, [reservaId]);
  if (!tot.rows.length) return;
  const { total_cliente, cobrado, saldo_cliente } = tot.rows[0];

  // Estado actual + anticipo requerido
  const est = await client.query(`SELECT estado FROM reservas WHERE id=$1`, [reservaId]);
  const estadoActual = est.rows[0]?.estado || 'COTIZADA';
  const ant = await client.query(`SELECT COALESCE(valor_numero,30) AS anticipo FROM parametros_globales WHERE clave='ANTICIPO_MIN_PORC'`);
  const anticipoPct = (ant.rows[0]?.anticipo || 30) / 100.0;

  if (estadoActual === 'COTIZADA' && Number(cobrado) >= Number(total_cliente) * anticipoPct) {
    await client.query(`UPDATE reservas SET estado='APARTADA', updated_at=NOW() WHERE id=$1`, [reservaId]);
  }

  if (Number(saldo_cliente) === 0 && ['APARTADA', 'CONFIRMADA', 'COTIZADA'].includes(estadoActual)) {
    await client.query(`UPDATE reservas SET estado='LIQUIDADA', updated_at=NOW() WHERE id=$1`, [reservaId]);
    // TODO: liberar comisiones de vendedor (fase 3)
  }
}

// ========== RESERVAS & PAGOS ==========
const reservasService = require('./src/services/reservas.service');
const pagosService = require('./src/services/pagos.service');
const proveedoresService = require('./src/services/proveedores.service');
const usuariosService = require('./src/services/usuarios.service');
const cotizacionesService = require('./src/services/cotizaciones.service');

// GET /api/reservas — listar reservas con filtros
app.get('/api/reservas', authenticateToken, async (req, res) => {
  try {
    const filtros = {
      estado: req.query.estado,
      vendedor_id: req.query.vendedor_id,
      contacto_id: req.query.contacto_id,
      desde: req.query.desde,
      hasta: req.query.hasta,
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0
    };

    const reservas = await reservasService.listarReservas(filtros);
    res.json({ success: true, reservas });
  } catch (err) {
    console.error('Error GET /api/reservas:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reservas/:id — obtener reserva completa
app.get('/api/reservas/:id', authenticateToken, async (req, res) => {
  try {
    const reservaId = Number(req.params.id);
    const reserva = await reservasService.getReserva(reservaId);

    if (!reserva) {
      return res.status(404).json({ success: false, message: 'Reserva no encontrada' });
    }

    res.json({ success: true, reserva });
  } catch (err) {
    console.error('Error GET /api/reservas/:id:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reservas — crear reserva e ítems
app.post('/api/reservas', authenticateToken, async (req, res) => {
  try {
    const result = await reservasService.crearReserva(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error POST /api/reservas:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /reservas/:id/planes/cliente — crea/actualiza plan y cuotas del cliente
app.post('/reservas/:id/planes/cliente', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const reservaId = Number(req.params.id);
    const { cuotas = [], moneda = 'MXN' } = req.body || {};
    if (!reservaId || !Array.isArray(cuotas) || cuotas.length === 0) {
      return res.status(400).json({ message: 'Reseva y cuotas requeridas' });
    }

    await client.query('BEGIN');

    // Asegurar que la reserva exista
    const ex = await client.query(`SELECT id FROM reservas WHERE id=$1`, [reservaId]);
    if (!ex.rows.length) throw new Error('Reserva no existe');

    // Upsert plan
    const selPlan = await client.query(`SELECT id FROM planes_pago_cliente WHERE reserva_id=$1`, [reservaId]);
    let planId;
    if (selPlan.rows.length) {
      planId = selPlan.rows[0].id;
      await client.query(`UPDATE planes_pago_cliente SET moneda=$1 WHERE id=$2`, [moneda, planId]);
      await client.query(`DELETE FROM cuotas_cliente WHERE plan_id=$1`, [planId]);
    } else {
      const insPlan = await client.query(
        `INSERT INTO planes_pago_cliente (reserva_id, moneda) VALUES ($1,$2) RETURNING id`,
        [reservaId, moneda]
      );
      planId = insPlan.rows[0].id;
    }

    // Insertar cuotas
    const insC = `INSERT INTO cuotas_cliente (plan_id, numero, fecha_limite, monto) VALUES ($1,$2,$3,$4) RETURNING id`;
    const inserted = [];
    for (const c of cuotas) {
      const { numero, fecha_limite, monto } = c || {};
      if (numero == null || !fecha_limite || monto == null) {
        throw new Error('Cada cuota requiere numero, fecha_limite, monto');
      }
      const ci = await client.query(insC, [planId, numero, fecha_limite, monto]);
      inserted.push(ci.rows[0].id);
    }

    await client.query('COMMIT');
    res.json({ success: true, plan_id: planId, cuotas: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error POST /reservas/:id/planes/cliente:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// GET /pagos/cliente/pendientes — listar pagos pendientes
app.get('/pagos/cliente/pendientes', authenticateToken, async (req, res) => {
  try {
    const filtros = {
      reserva_id: req.query.reserva_id,
      vendedor_id: req.query.vendedor_id,
      limit: Number(req.query.limit) || 50
    };

    const pagos = await pagosService.listarPagosPendientes(filtros);
    res.json({ success: true, pagos });
  } catch (err) {
    console.error('Error GET /pagos/cliente/pendientes:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /pagos/cliente — crear pago PENDIENTE
app.post('/pagos/cliente', authenticateToken, async (req, res) => {
  try {
    const data = {
      ...req.body,
      usuario_id: req.user?.id
    };

    const result = await pagosService.crearPagoCliente(data);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error POST /pagos/cliente:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /pagos/cliente/:id/confirmar — confirma pago, marca cuota y actualiza estado de reserva
app.post('/pagos/cliente/:id/confirmar', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const pagoId = Number(req.params.id);
    const usuarioId = req.user?.id || null;
    if (!pagoId) return res.status(400).json({ message: 'ID de pago inválido' });

    await client.query('BEGIN');

    // Obtener pago y reserva
    const pago = await client.query(`SELECT id, reserva_id, cuota_cliente_id, monto FROM pagos_clientes WHERE id=$1`, [pagoId]);
    if (!pago.rows.length) throw new Error('Pago no encontrado');
    const { reserva_id, cuota_cliente_id } = pago.rows[0];

    // Confirmar pago
    await client.query(
      `UPDATE pagos_clientes
       SET estado='CONFIRMADO', confirmado_por=$1, confirmado_at=NOW()
       WHERE id=$2`,
      [usuarioId, pagoId]
    );

    // Marcar cuota como CONFIRMADA (si existe vínculo)
    if (cuota_cliente_id) {
      await client.query(
        `UPDATE cuotas_cliente SET estado='CONFIRMADA' WHERE id=$1`,
        [cuota_cliente_id]
      );
    }

    // Auditoría
    await client.query(
      `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id)
       VALUES ('pago_cliente',$1,'CONFIRM',$2)`,
      [pagoId, usuarioId]
    );

    // Recalcular estado de la reserva
    await _actualizarEstadoReserva(client, reserva_id);

    // Generar y adjuntar recibo
    let reciboUrl = null;
    let reciboFilePath = null;
    try {
      const rpdf = await generateReceiptPDF(client, pagoId); // usa pdfkit
      reciboUrl = rpdf.url;              // ej: /uploads/receipts/recibo_123.pdf
      reciboFilePath = rpdf.filePath;    // ruta local absoluta

      await client.query(
        `INSERT INTO evidencias (reserva_id, tipo, archivo_url)
     VALUES ($1,'PAGO_CLIENTE',$2)`,
        [reserva_id, reciboUrl]
      );

      appLog('info', 'RECIBO_EMITIDO', { reqId: req.reqId, pagoId, reserva_id, reciboUrl });
    } catch (e) {
      appLog('error', 'RECIBO_FALLO', { reqId: req.reqId, pagoId, error: e.message });
      // seguimos; no deshacemos la confirmación por falla de PDF
    }

    // Enviar recibo por WhatsApp al cliente (si hay teléfono)
    try {
      const qTel = `
    SELECT c.telefono AS tel, c.nombre AS cliente
    FROM reservas r
    JOIN contactos c ON c.id = r.contacto_id
    WHERE r.id = $1
    LIMIT 1
  `;
      const rTel = await client.query(qTel, [reserva_id]);
      const telRaw = rTel.rows[0]?.tel || '';
      const clienteNombre = rTel.rows[0]?.cliente || 'Cliente';
      const phoneNumber = (telRaw || '').replace(/\D/g, '');

      // Construir URL absoluta (por si tu sendMessage necesita http)
      const absUrl = reciboUrl
        ? `${req.protocol}://${req.get('host')}${reciboUrl}`
        : null;

      const whatsappService = req.app.get('whatsappService');

      if (whatsappService && phoneNumber && reciboUrl) {
        const caption = `¡${clienteNombre}!, tu pago fue CONFIRMADO.\nTe comparto tu recibo PDF.`;
        // Opción A (segura): usar la URL pública que ya sirves en /uploads
        await whatsappService.sendMessage(
          phoneNumber,
          caption,
          absUrl,
          'document',
          `recibo_${pagoId}.pdf`,
          { nombre_usuario: 'Caja' }
        );

        appLog('info', 'RECIBO_ENVIADO_WA', { reqId: req.reqId, pagoId, reserva_id, phoneNumber });
      } else {
        appLog('info', 'RECIBO_NO_ENVIADO_WA', {
          reqId: req.reqId,
          motivo: !phoneNumber ? 'sin_telefono' : !reciboUrl ? 'sin_recibo' : 'sin_servicio'
        });
      }
      // Mensaje de confirmación (copy con desglose)
      try {
        // Recalcular totales + próxima cuota pendiente
        const infoSaldo = await client.query(`
    WITH tot AS (
      SELECT r.id AS reserva_id,
             COALESCE(SUM(ri.precio_cliente),0) AS total_cliente
      FROM reservas r
      LEFT JOIN reservas_items ri ON ri.reserva_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
    ),
    cob AS (
      SELECT reserva_id, COALESCE(SUM(monto),0) AS cobrado
      FROM pagos_clientes
      WHERE reserva_id = $1 AND estado='CONFIRMADO'
      GROUP BY reserva_id
    ),
    nextc AS (
      SELECT cc.numero, cc.fecha_limite, cc.monto
      FROM planes_pago_cliente p
      JOIN cuotas_cliente cc ON cc.plan_id = p.id
      WHERE p.reserva_id = $1 AND cc.estado='PENDIENTE'
      ORDER BY cc.numero ASC
      LIMIT 1
    )
    SELECT t.total_cliente,
           COALESCE(c.cobrado,0) AS cobrado,
           (t.total_cliente - COALESCE(c.cobrado,0)) AS saldo,
           (SELECT numero FROM nextc)        AS prox_num,
           (SELECT fecha_limite FROM nextc)  AS prox_fecha,
           (SELECT monto FROM nextc)         AS prox_monto
    FROM tot t LEFT JOIN cob c ON c.reserva_id = t.reserva_id
  `, [reserva_id]);

        const d = infoSaldo.rows[0] || {};
        const total = Number(d.total_cliente || 0);
        const cobrado = Number(d.cobrado || 0);
        const saldo = Number(d.saldo || 0);
        const proxNum = d.prox_num;
        const proxFechaStr = d.prox_fecha ? new Date(d.prox_fecha).toLocaleDateString('es-MX') : null;
        const proxMonto = d.prox_monto != null ? Number(d.prox_monto) : null;

        // armamos el mensaje
        const lineas = [];
        lineas.push(`¡${clienteNombre}!, tu pago por $${Number(pago.rows[0].monto).toFixed(2)} MXN fue CONFIRMADO ✅`, '');
        lineas.push(`Total: $${total.toFixed(2)} MXN`);
        lineas.push(`Pagado a la fecha: $${cobrado.toFixed(2)} MXN`);
        lineas.push(`Saldo por pagar: $${saldo.toFixed(2)} MXN`, '');

        if (saldo > 0 && proxFechaStr && proxMonto != null) {
          lineas.push(`Próxima cuota (No. ${proxNum}): $${proxMonto.toFixed(2)} MXN — límite ${proxFechaStr}`, '');
        } else if (saldo === 0) {
          lineas.push('¡Tu reserva está LIQUIDADA! 🎉', '');
        }

        if (absUrl) {
          lineas.push(`Tu recibo en PDF: ${absUrl}`);
        }
        lineas.push('Gracias por tu preferencia 🙌');

        const msg = lineas.join('\n');

        if (whatsappService && phoneNumber) {
          await whatsappService.sendMessage(
            phoneNumber,
            msg,
            null,           // sin media
            null,           // sin tipo de media
            null,
            { nombre_usuario: 'Caja' }
          );
          appLog('info', 'COPY_ENVIADO_WA', { reqId: req.reqId, pagoId, reserva_id, phoneNumber });
        } else {
          appLog('info', 'COPY_NO_ENVIADO_WA', {
            reqId: req.reqId,
            motivo: !phoneNumber ? 'sin_telefono' : 'sin_servicio'
          });
        }
      } catch (e) {
        appLog('error', 'COPY_FALLO_WA', { reqId: req.reqId, pagoId, error: e.message });
      }

    } catch (e) {
      appLog('error', 'WA_FALLO_ENVIO_RECIBO', { reqId: req.reqId, pagoId, error: e.message });
    }
    await client.query('COMMIT');

    // Regresar saldos
    const sal = await client.query(`
  WITH tot AS (
    SELECT r.id AS reserva_id,
           COALESCE(SUM(ri.precio_cliente),0) AS total_cliente
    FROM reservas r
    LEFT JOIN reservas_items ri ON ri.reserva_id = r.id
    WHERE r.id = $1
    GROUP BY r.id
  ),
  cob AS (
    SELECT reserva_id, COALESCE(SUM(monto),0) AS cobrado
    FROM pagos_clientes
    WHERE reserva_id = $1 AND estado='CONFIRMADO'
    GROUP BY reserva_id
  )
  SELECT t.total_cliente, COALESCE(c.cobrado,0) AS cobrado,
         (t.total_cliente - COALESCE(c.cobrado,0)) AS saldo_cliente
  FROM tot t LEFT JOIN cob c ON c.reserva_id = t.reserva_id
`, [reserva_id]);


    res.json({
      success: true,
      pago_id: pagoId,
      reserva_id,
      saldos: sal.rows[0] || null,
      recibo: reciboUrl ? { url: reciboUrl } : { pending: true }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error POST /pagos/cliente/:id/confirmar:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});


///////////////////////////////////////////////////////////////////////////////////

// ==========================
// DEV: Salud de BD (solo desarrollo)
// ==========================
app.get('/api/db/health', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).send('Not found');
    }
    const client = await pool.connect();
    try {
      const checks = {};
      const q = async (name, sql) => {
        try {
          const r = await client.query(sql);
          checks[name] = r.rows[0] || { ok: true };
        } catch (e) {
          checks[name] = { ok: false, error: e.message };
        }
      };

      await q('reservas', "SELECT to_regclass('public.reservas') AS exists");
      await q('reservas_items', "SELECT to_regclass('public.reservas_items') AS exists");
      await q('pagos_clientes', "SELECT to_regclass('public.pagos_clientes') AS exists");
      await q('planes_pago_cliente', "SELECT to_regclass('public.planes_pago_cliente') AS exists");
      await q('cuotas_cliente', "SELECT to_regclass('public.cuotas_cliente') AS exists");
      await q('proveedores', "SELECT to_regclass('public.proveedores') AS exists");
      await q('trg_check_metodo_pago_unico', "SELECT tgname AS trigger FROM pg_trigger WHERE tgname='check_metodo_pago_unico' LIMIT 1");
      await q('trg_no_sobrepago_cliente', "SELECT tgname AS trigger FROM pg_trigger WHERE tgname='no_sobrepago_cliente' LIMIT 1");

      const totals = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM reservas)          AS reservas,
          (SELECT COUNT(*) FROM reservas_items)    AS items,
          (SELECT COUNT(*) FROM pagos_clientes)    AS pagos,
          (SELECT COUNT(*) FROM cuotas_cliente)    AS cuotas
      `);

      res.json({
        ok: true,
        environment: process.env.NODE_ENV || 'development',
        checks,
        totals: totals.rows[0]
      });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DEV helper: obtener IDs existentes para pruebas rápidas (no modifica nada)
app.get('/api/db/first-ids', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).send('Not found');
    }
    const client = await pool.connect();
    try {
      const r1 = await client.query(`SELECT id, nombre FROM contactos ORDER BY id ASC LIMIT 1`);
      const r2 = await client.query(`SELECT id, nombre FROM proveedores ORDER BY id ASC LIMIT 1`);
      res.json({
        ok: true,
        contacto: r1.rows[0] || null,
        proveedor: r2.rows[0] || null
      });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});



// Asegura subcarpetas en /uploads
function ensureUploadsSubdir(sub) {
  const base = typeof UPLOAD_DIR !== 'undefined' ? UPLOAD_DIR : path.join(__dirname, 'uploads');
  const dir = path.join(base, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Carga la hoja membretada si existe (opcional)
function tryFindLetterhead() {
  const base = typeof UPLOAD_DIR !== 'undefined' ? UPLOAD_DIR : path.join(__dirname, 'uploads');
  const candidates = [
    path.join(base, 'assets', 'hoja-membretada.png'),
    path.join(base, 'assets', 'hoja-membretada.jpg'),
    path.join(base, 'assets', 'letterhead.png'),
    path.join(base, 'assets', 'letterhead.jpg')
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Generador de PDF con pdfkit
let PDFDocument;
try {
  PDFDocument = require('pdfkit');
} catch (e) {
  PDFDocument = null;
}

// Genera recibo PDF y devuelve { url, filePath }
async function generateReceiptPDF(dbClient, pagoId) {
  if (!PDFDocument) {
    throw new Error('pdfkit no está instalado. Ejecuta: npm i pdfkit');
  }

  // Consulta de datos para el recibo
  const q = `
    SELECT
      p.id                AS pago_id,
      p.monto             AS monto,
      p.confirmado_at     AS fecha_confirmacion,
      p.cuota_cliente_id  AS cuota_id,
      r.id                AS reserva_id,
      r.metodo_pago       AS metodo_reserva,
      r.vendedor_id       AS vendedor_id,
      c.nombre            AS nombre_cliente,
      u.nombre            AS nombre_vendedor,
      cc.numero           AS cuota_numero,
      -- Totales/saldo
      (SELECT COALESCE(SUM(ri.precio_cliente),0) FROM reservas_items ri WHERE ri.reserva_id = r.id) AS total_cliente,
      (SELECT COALESCE(SUM(pc.monto),0) FROM pagos_clientes pc WHERE pc.reserva_id = r.id AND pc.estado='CONFIRMADO') AS cobrado
    FROM pagos_clientes p
    JOIN reservas r ON r.id = p.reserva_id
    JOIN contactos c ON c.id = r.contacto_id
    LEFT JOIN usuarios u ON u.id = r.vendedor_id
    LEFT JOIN cuotas_cliente cc ON cc.id = p.cuota_cliente_id
    WHERE p.id = $1
    LIMIT 1
  `;
  const { rows } = await dbClient.query(q, [pagoId]);
  if (!rows.length) throw new Error(`Pago ${pagoId} no encontrado para recibo`);
  const info = rows[0];
  const saldo_restante = Number(info.total_cliente) - Number(info.cobrado);

  const receiptsDir = ensureUploadsSubdir('receipts');
  const fileName = `recibo_${info.pago_id}_reserva_${info.reserva_id}.pdf`;
  const filePath = path.join(receiptsDir, fileName);
  const publicUrl = `/uploads/receipts/${fileName}`;

  const letterheadPath = tryFindLetterhead();

  // Crear PDF
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Membrete (si existe)
  if (letterheadPath) {
    try {
      // ancho página ~ 612pt, dejamos márgenes
      doc.image(letterheadPath, 40, 30, { width: 532 });
      doc.moveDown(2.2);
    } catch (e) {
      // si falla la imagen, continuamos con texto
    }
  }

  // Encabezado
  doc.fontSize(16).text('OLAS Y RAÍCES', { align: 'right' });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`RECIBO DE PAGO #${info.pago_id}`, { align: 'right' });
  doc.moveDown(1);

  // Datos del recibo
  doc.fontSize(11);
  doc.text(`Cliente: ${info.nombre_cliente}`);
  doc.text(`Reserva: ${info.reserva_id}`);
  doc.text(`Vendedor: ${info.nombre_vendedor || '—'}`);
  doc.text(`Fecha confirmación: ${new Date(info.fecha_confirmacion).toLocaleString()}`);
  doc.text(`Método: ${info.metodo_reserva}`);
  doc.text(`Concepto: Abono a plan de pagos${info.cuota_numero ? ` (Cuota ${info.cuota_numero})` : ''}`);
  doc.moveDown(0.6);

  doc.fontSize(13).text(`Monto: $${Number(info.monto).toFixed(2)} MXN`, { bold: true });
  doc.moveDown(0.3);
  doc.fontSize(12).text(`Saldo restante: $${Number(saldo_restante).toFixed(2)} MXN`);
  doc.moveDown(1);

  doc.fontSize(10).fillColor('#666').text('Gracias por tu preferencia.', { align: 'left' });
  doc.text('Contacto: 33-0000-0000 | hola@izland.tours', { align: 'left' });
  doc.fillColor('#000');

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { url: publicUrl, filePath };
}


// Función para asegurar que exista la carpeta 'uploads'
async function ensureUploadsDirectory() {
  const uploadDir = path.join(process.cwd(), 'uploads');
  try {
    await fsPromises.access(uploadDir);
    console.log("La carpeta 'uploads' ya existe.");
  } catch {
    await fsPromises.mkdir(uploadDir, { recursive: true });
    console.log("Carpeta 'uploads' creada.");
  }
}
// Auxiliares para entorno
const isProd = config.nodeEnv === 'production';
const PUBLIC_URL = config.baseUrl || `http://localhost:${PORT}`;

// Detecta si tenemos token de Gmail disponible (archivo o env/secret)
function hasGmailTokenAvailable() {
  // 1) Secret file (Render → Secret Files) ej. /etc/secrets/token.json
  const fs = require('fs');
  if (config.gmail.tokenPath && fs.existsSync(config.gmail.tokenPath)) return true;

  // 2) Variable de entorno con JSON del token (si decides guardarlo así)
  if (config.gmail.tokenJSON) return true;

  // 3) Token en repo (NO recomendado en prod), solo por compatibilidad local
  if (fs.existsSync(require('path').join(__dirname, 'token.json'))) return true;

  return false;
}

async function safeInitGmail() {
  try {
    if (!config.gmail.enabled) {
      console.log('[gmail] Deshabilitado vía configuración (GMAIL_ENABLED).');
      return;
    }

    // En producción, NO bloquees pidiendo código. Solo inicializa si ya hay token listo.
    if (isProd && !hasGmailTokenAvailable()) {
      console.warn('[gmail] Saltando Gmail en producción: no hay token preautorizado. (No se puede usar flujo interactivo en Render).');
      return;
    }

    console.log('Inicializando Gmail API...');
    await gmailService.initialize({
      // Opcional: pásale rutas/valores si tu gmailService lo soporta
      tokenPath: config.gmail.tokenPath, // ej. /etc/secrets/token.json
      tokenJSON: config.gmail.tokenJSON, // alternativa, JSON en env
    });
    console.log('Gmail API lista');
  } catch (e) {
    console.warn('[gmail] No se pudo inicializar (continuamos sin Gmail):', e?.message || e);
  }
}

async function safeInitWhatsApp(io) {
  try {
    console.log('Iniciando servicio de WhatsApp...');
    const whatsappService = new WhatsAppService(io);
    const initialized = await whatsappService.initialize();
    if (!initialized) throw new Error('initialize() devolvió false');
    console.log('Servicio de WhatsApp iniciado correctamente');

    // OpenAIHandler si WhatsApp quedó bien
    try {
      const openAIHandler = new OpenAIHandler(whatsappService);
      whatsappService.openAIHandler = openAIHandler;
      app.set('openAIHandler', openAIHandler);
      console.log('OpenAIHandler listo');
    } catch (e) {
      console.warn('[openai] No se pudo inicializar OpenAIHandler:', e?.message || e);
    }

    app.set('whatsappService', whatsappService);
  } catch (e) {
    console.warn('[whatsapp] No se pudo iniciar (modo degradado):', e?.message || e);
    app.set('whatsappService', null);
  }
}

// ✅ REEMPLAZA COMPLETO startServer POR ESTE
async function startServer() {
  console.log('Iniciando servidor...');

  // 1) uploads (no crítico)
  try {
    await ensureUploadsDirectory();
    console.log("La carpeta 'uploads' verificada/creada.");
  } catch (e) {
    console.warn("[uploads] No se pudo verificar/crear la carpeta:", e?.message || e);
  }

  // 2) DB (CRÍTICO)
  try {
    await initDatabase();
    console.log('Base de datos inicializada correctamente');
    await ensureManagerUserSimple();

  } catch (e) {
    console.error('[db] Error al inicializar la base de datos:', e?.message || e);
    process.exit(1);
  }

  // 3) LEVANTAR HTTP YA MISMO (para que Railway detecte el puerto)
  const HOST = '0.0.0.0'; // Necesario para Railway/Docker
  server.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en ${HOST}:${PORT} (${PUBLIC_URL})`);
  });

  // 4) Inicializaciones NO críticas en background (no bloquean el arranque)
  //    WhatsApp:
  safeInitWhatsApp(io);
  //    Gmail:
  safeInitGmail();

  // 5) Jobs (tampoco críticos; si necesitas whatsappService, espera a que esté listo)
  setImmediate(() => {
    try {
      const RecordatoriosJob = require('./src/jobs/recordatorios.job');
      const recordatoriosJob = new RecordatoriosJob(app.get('whatsappService'));
      recordatoriosJob.iniciar();
      console.log('RecordatoriosJob iniciado');
    } catch (e) {
      console.warn('[jobs] RecordatoriosJob no se pudo iniciar:', e?.message || e);
    }

    try {
      const CotizacionesLimpiezaJob = require('./src/jobs/cotizaciones-limpieza.job');
      const cotizacionesLimpiezaJob = new CotizacionesLimpiezaJob();
      cotizacionesLimpiezaJob.iniciar();
      console.log('CotizacionesLimpiezaJob iniciado');
    } catch (e) {
      console.warn('[jobs] CotizacionesLimpiezaJob no se pudo iniciar:', e?.message || e);
    }
  });
}

startServer();

// Healthcheck para Render (asegúrate de tenerlo)
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

// Manejo global de errores
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
