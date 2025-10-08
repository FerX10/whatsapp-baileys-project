// ./src/database/db.js
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { config } = require('../config/env');

if (config.nodeEnv !== 'production') {
  console.log('[db] Configuración (segura):', {
    host: config.db.host,
    user: config.db.user,
    hasPassword: !!config.db.pass,
    database: config.db.name,
    port: config.db.port,
    usingDatabaseUrl: !!config.databaseUrl
  });
}

// === Pool compatible local / Render ===
const isRender = !!config.databaseUrl;

const pool = isRender
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false } // Render Postgres requiere SSL
    })
  : new Pool({
      host: config.db.host,
      user: config.db.user,
      password: config.db.pass,
      database: config.db.name,
      port: config.db.port
    });


/**
 * Inicializa la base de datos con las tablas necesarias
 * y crea un usuario admin por defecto (admin/admin123).
 * También define la tabla chat_assignments con asistente_activo = TRUE por defecto.
 */
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Asegurar encoding UTF8
    await client.query("SET client_encoding TO 'UTF8'");

    // Crear tablas y demás objetos
    await client.query(`
      -- Tabla de usuarios
      CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          nombre_usuario VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          tipo_usuario VARCHAR(20) NOT NULL DEFAULT 'operador',
          fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          activo BOOLEAN DEFAULT TRUE
      );

      -- Ampliar usuarios con campos adicionales
      ALTER TABLE usuarios
        ADD COLUMN IF NOT EXISTS nombre_completo VARCHAR(180),
        ADD COLUMN IF NOT EXISTS numero_whatsapp VARCHAR(20),
        ADD COLUMN IF NOT EXISTS email VARCHAR(180),
        ADD COLUMN IF NOT EXISTS comision_porcentaje NUMERIC(5,2) DEFAULT 25.00,
        ADD COLUMN IF NOT EXISTS usuario_sistema BOOLEAN DEFAULT FALSE;

      -- Tabla de mensajes
CREATE TABLE IF NOT EXISTS mensajes (
    id SERIAL PRIMARY KEY,
    numero_telefono VARCHAR(20) NOT NULL,
    mensaje TEXT NOT NULL,
    tipo_remitente VARCHAR(10) NOT NULL,
    fecha_hora TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_id INTEGER REFERENCES usuarios(id),
    nombre_usuario VARCHAR(50),
    tipo_contenido VARCHAR(50),
    url_archivo TEXT,
    nombre_archivo VARCHAR(255),
    tamano_archivo BIGINT,
    mensaje_whatsapp_id VARCHAR(100),
    estado VARCHAR(20),
    leido BOOLEAN DEFAULT FALSE,  -- <-- NUEVO CAMPO
    fecha_actualizacion TIMESTAMP WITH TIME ZONE,
    intentos INTEGER DEFAULT 0,
    ultimo_error TEXT,
    fecha_ultimo_intento TIMESTAMP WITH TIME ZONE
);


      -- Tabla de archivos multimedia
      CREATE TABLE IF NOT EXISTS archivos_multimedia (
          id SERIAL PRIMARY KEY,
          mensaje_id INTEGER REFERENCES mensajes(id) ON DELETE CASCADE,
          tipo_contenido VARCHAR(50) NOT NULL,
          nombre_archivo VARCHAR(255) NOT NULL,
          ruta_archivo TEXT NOT NULL,
          tamano_archivo BIGINT NOT NULL,
          fecha_subida TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          hash_archivo VARCHAR(64),
          metadata JSONB
      );

      -- Tabla de asignación de chats
      CREATE TABLE IF NOT EXISTS chat_assignments (
          id SERIAL PRIMARY KEY,
          numero_telefono VARCHAR(20) NOT NULL UNIQUE,
          usuario_id INTEGER REFERENCES usuarios(id),
          nombre_usuario VARCHAR(50),
          chat_asignado BOOLEAN DEFAULT FALSE,
          fecha_asignacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

       -- NUEVA TABLA: Estado del asistente
      CREATE TABLE IF NOT EXISTS assistant_status (
          id SERIAL PRIMARY KEY,
          numero_telefono VARCHAR(20) NOT NULL UNIQUE,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Tabla de etiquetas
      CREATE TABLE IF NOT EXISTS etiquetas (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(50) NOT NULL UNIQUE,
          color VARCHAR(7) NOT NULL,
          descripcion TEXT,
          prioridad INTEGER NOT NULL DEFAULT 0,
          activo BOOLEAN DEFAULT TRUE,
          fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Tabla de relación chat-etiquetas
      CREATE TABLE IF NOT EXISTS chat_etiquetas (
          id SERIAL PRIMARY KEY,
          numero_telefono VARCHAR(20) NOT NULL,
          etiqueta_id INTEGER REFERENCES etiquetas(id),
          usuario_id INTEGER REFERENCES usuarios(id),
          fecha_asignacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          activo BOOLEAN DEFAULT TRUE,
          UNIQUE(numero_telefono, etiqueta_id)
      );

      -- Tabla de mensajes programados
      CREATE TABLE IF NOT EXISTS mensajes_programados (
          id SERIAL PRIMARY KEY,
          numero_telefono VARCHAR(20) NOT NULL,
          mensaje TEXT NOT NULL,
          fecha_envio TIMESTAMP WITH TIME ZONE NOT NULL,
          enviado BOOLEAN DEFAULT FALSE,
          mensaje_id INTEGER REFERENCES mensajes(id),
          usuario_id INTEGER REFERENCES usuarios(id),
          nombre_usuario VARCHAR(50)
      );

      -- Tabla de notas internas
      CREATE TABLE IF NOT EXISTS notas_internas (
          id SERIAL PRIMARY KEY,
          numero_telefono VARCHAR(20) NOT NULL,
          nota TEXT NOT NULL,
          fecha_creacion TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          usuario_id INTEGER REFERENCES usuarios(id),
          nombre_usuario VARCHAR(50)
      );

      -- Tabla de sesiones de WhatsApp
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
          id SERIAL PRIMARY KEY,
          session_data JSONB NOT NULL,
          fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          activa BOOLEAN DEFAULT TRUE
      );

      -- sincronía mínima
ALTER TABLE IF EXISTS usuarios
  ADD COLUMN IF NOT EXISTS numero_whatsapp VARCHAR(20),
  ADD COLUMN IF NOT EXISTS email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS comision_porcentaje NUMERIC(5,2) DEFAULT 25.00,
  ADD COLUMN IF NOT EXISTS usuario_sistema BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS mensajes
  ADD COLUMN IF NOT EXISTS leido BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS contactos
  ADD COLUMN IF NOT EXISTS email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS rfc VARCHAR(20),
  ADD COLUMN IF NOT EXISTS razon_social VARCHAR(180),
  ADD COLUMN IF NOT EXISTS cp VARCHAR(10);

ALTER TABLE IF EXISTS proveedores
  ADD COLUMN IF NOT EXISTS rfc VARCHAR(20),
  ADD COLUMN IF NOT EXISTS razon_social VARCHAR(180),
  ADD COLUMN IF NOT EXISTS constancia_fiscal_url TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();


      -- Índices
      CREATE INDEX IF NOT EXISTS idx_mensajes_numero_telefono ON mensajes(numero_telefono);
      CREATE INDEX IF NOT EXISTS idx_mensajes_fecha_hora ON mensajes(fecha_hora);
      CREATE INDEX IF NOT EXISTS idx_chat_assignments_numero ON chat_assignments(numero_telefono);
      CREATE INDEX IF NOT EXISTS idx_chat_etiquetas_numero ON chat_etiquetas(numero_telefono);
      CREATE INDEX IF NOT EXISTS idx_notas_numero ON notas_internas(numero_telefono);
    
        -- NUEVA TABLA: Contactos
      CREATE TABLE IF NOT EXISTS contactos (
        id SERIAL PRIMARY KEY,
        numero_telefono VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(50),
        fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );


      -- Tabla de conversaciones de OpenAI (persistencia por número)
CREATE TABLE IF NOT EXISTS openai_conversations (
  id SERIAL PRIMARY KEY,
  numero_telefono VARCHAR(20) UNIQUE NOT NULL,
  conversation_id VARCHAR(120) NOT NULL,
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openai_conv_numero ON openai_conversations(numero_telefono);


-- Tabla de Promos
CREATE TABLE IF NOT EXISTS promos (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(150) NOT NULL,
  destino VARCHAR(80) NOT NULL,
  descripcion TEXT,
  todo_incluido BOOLEAN DEFAULT FALSE,
  con_transporte BOOLEAN DEFAULT FALSE,
  transporte_tipo VARCHAR(10), -- 'camion' | 'avion' | NULL
  traslados BOOLEAN DEFAULT FALSE,
  incluye_desayuno_llegada BOOLEAN DEFAULT FALSE,
  menores_gratis BOOLEAN DEFAULT FALSE,
  menores_gratis_politica TEXT,
  ninos_2x1 BOOLEAN DEFAULT FALSE,
  entrega_anticipada BOOLEAN DEFAULT FALSE,
  precio_adulto NUMERIC(10,2),
  precio_menor NUMERIC(10,2),
  precio_bus_menor NUMERIC(10,2),
  fecha_salida DATE NOT NULL,
  fecha_llegada DATE NOT NULL,
  reserva_inicio DATE,
  reserva_fin DATE,
  imagenes JSONB NOT NULL DEFAULT '[]'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_promos_destino ON promos(destino);
CREATE INDEX IF NOT EXISTS idx_promos_fecha_salida ON promos(fecha_salida);
CREATE INDEX IF NOT EXISTS idx_promos_activo ON promos(activo);

CREATE TABLE IF NOT EXISTS hotel_folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  parent_id INTEGER REFERENCES hotel_folders(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_folders_parent ON hotel_folders(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hotel_folders_parent_lower_name
  ON hotel_folders (parent_id, LOWER(name));

-- Hoteles
CREATE TABLE IF NOT EXISTS hotels (
  id SERIAL PRIMARY KEY,
  folder_id INTEGER REFERENCES hotel_folders(id) ON DELETE SET NULL,
  name VARCHAR(180) NOT NULL,
  destination VARCHAR(120),
  zone VARCHAR(120),
  stars NUMERIC(2,1),
  pools SMALLINT,
  restaurants SMALLINT,
  specialties TEXT,
  has_gym BOOLEAN DEFAULT FALSE,
  has_spa BOOLEAN DEFAULT FALSE,
  has_kids_club BOOLEAN DEFAULT FALSE,
  adults_only BOOLEAN DEFAULT FALSE,
  description TEXT,
  personal_tip TEXT,
  tiktok_url TEXT,
  external_video_url TEXT,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotels_folder ON hotels(folder_id);
CREATE INDEX IF NOT EXISTS idx_hotels_destination ON hotels(destination);
CREATE INDEX IF NOT EXISTS idx_hotels_activo ON hotels(activo);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hotels_lower_name
  ON hotels (LOWER(name));

-- Enlaces categorizados por hotel (secciones)
CREATE TABLE IF NOT EXISTS hotel_links (
  id SERIAL PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  section VARCHAR(80) NOT NULL,        -- Ej: habitaciones, playa, restaurantes, albercas, snacks...
  title VARCHAR(180),
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_links_hotel ON hotel_links(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotel_links_section ON hotel_links(section);

      
      -- NUEVA TABLA: Bloqueo de números
      CREATE TABLE IF NOT EXISTS blocked_numbers (
        id SERIAL PRIMARY KEY,
        numero_telefono VARCHAR(20) NOT NULL UNIQUE,
        fecha_bloqueo TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER REFERENCES usuarios(id),
        razon TEXT
      );

-- =========================
-- [NUEVO] Reservas & Pagos (Core Operativo)
-- =========================

-- 0) Ampliaciones sobre tablas existentes
ALTER TABLE IF EXISTS contactos
  ADD COLUMN IF NOT EXISTS email VARCHAR(180),
  ADD COLUMN IF NOT EXISTS rfc VARCHAR(20),
  ADD COLUMN IF NOT EXISTS razon_social VARCHAR(180),
  ADD COLUMN IF NOT EXISTS cp VARCHAR(10);

-- 1) Catálogos
CREATE TABLE IF NOT EXISTS proveedores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  comision_efectivo NUMERIC(5,2) DEFAULT 15.00,
  comision_tarjeta  NUMERIC(5,2) DEFAULT 10.00,
  email_pagos VARCHAR(180),
  email_facturacion VARCHAR(180),
  portal_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  rfc VARCHAR(20),
  razon_social VARCHAR(180),
  constancia_fiscal_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proveedores_activo ON proveedores(activo);

CREATE TABLE IF NOT EXISTS parametros_globales (
  clave VARCHAR(40) PRIMARY KEY,
  valor_texto TEXT,
  valor_numero NUMERIC(12,2),
  valor_bool BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Valor por defecto 30%
INSERT INTO parametros_globales (clave, valor_numero, updated_at)
VALUES ('ANTICIPO_MIN_PORC', 30.00, now())
ON CONFLICT (clave) DO NOTHING;

-- Información fiscal de la agencia
CREATE TABLE IF NOT EXISTS agencia_info_fiscal (
  id SERIAL PRIMARY KEY,
  rfc VARCHAR(20) NOT NULL,
  razon_social VARCHAR(180) NOT NULL,
  regimen_fiscal VARCHAR(10),
  cp VARCHAR(10),
  calle VARCHAR(180),
  numero_ext VARCHAR(20),
  numero_int VARCHAR(20),
  colonia VARCHAR(100),
  ciudad VARCHAR(100),
  estado VARCHAR(100),
  constancia_fiscal_url TEXT,
  email_facturacion VARCHAR(180),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Solo debe haber un registro activo
CREATE UNIQUE INDEX IF NOT EXISTS idx_agencia_fiscal_activo ON agencia_info_fiscal(activo) WHERE activo = TRUE;

-- 2) Reservas e Ítems
CREATE TABLE IF NOT EXISTS reservas (
  id SERIAL PRIMARY KEY,
  contacto_id INT NOT NULL REFERENCES contactos(id),
  vendedor_id INT REFERENCES usuarios(id),
  destino VARCHAR(120) NOT NULL,
  check_in DATE,
  check_out DATE,
  ocupacion JSONB,
  metodo_pago VARCHAR(15) NOT NULL CHECK (metodo_pago IN ('EFECTIVO','TARJETA','TRANSFERENCIA')),
  moneda VARCHAR(8) NOT NULL DEFAULT 'MXN',
  estado VARCHAR(20) NOT NULL DEFAULT 'COTIZADA',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservas_contacto ON reservas(contacto_id);
CREATE INDEX IF NOT EXISTS idx_reservas_estado ON reservas(estado);

CREATE TABLE IF NOT EXISTS reservas_items (
  id SERIAL PRIMARY KEY,
  reserva_id INT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
  proveedor_id INT NOT NULL REFERENCES proveedores(id),
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('HOTEL','TRANSPORTE','VUELO','TRASLADO','HOTEL_TRANSPORTE','HOTEL_VUELO_TRASLADO','PUEBLO_MAGICO','OTRO')),
  descripcion TEXT,
  precio_neto NUMERIC(12,2) NOT NULL,
  precio_proveedor NUMERIC(12,2) NOT NULL,
  precio_cliente NUMERIC(12,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_reserva ON reservas_items(reserva_id);
CREATE INDEX IF NOT EXISTS idx_items_proveedor ON reservas_items(proveedor_id);

-- 3) Plan del cliente y cuotas
CREATE TABLE IF NOT EXISTS planes_pago_cliente (
  id SERIAL PRIMARY KEY,
  reserva_id INT UNIQUE REFERENCES reservas(id) ON DELETE CASCADE,
  moneda VARCHAR(8) DEFAULT 'MXN'
);
CREATE TABLE IF NOT EXISTS cuotas_cliente (
  id SERIAL PRIMARY KEY,
  plan_id INT REFERENCES planes_pago_cliente(id) ON DELETE CASCADE,
  numero SMALLINT NOT NULL,
  fecha_limite DATE NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  estado VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE|CONFIRMADA|VENCIDA
  UNIQUE (plan_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha ON cuotas_cliente(fecha_limite);

-- 4) Pagos del cliente
CREATE TABLE IF NOT EXISTS pagos_clientes (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE CASCADE,
  cuota_cliente_id INT REFERENCES cuotas_cliente(id),
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  evidencia_url TEXT,
  estado VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE|CONFIRMADO|RECHAZADO
  referencia_gateway TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmado_por INT REFERENCES usuarios(id),
  confirmado_at TIMESTAMPTZ,
  metodo_reportado VARCHAR(20)
);
CREATE INDEX IF NOT EXISTS idx_pagoscli_reserva ON pagos_clientes(reserva_id);
CREATE INDEX IF NOT EXISTS idx_pagoscli_estado ON pagos_clientes(estado);

-- 5) Plan del proveedor y cuotas
CREATE TABLE IF NOT EXISTS planes_pago_proveedor (
  id SERIAL PRIMARY KEY,
  reserva_item_id INT REFERENCES reservas_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS cuotas_proveedor (
  id SERIAL PRIMARY KEY,
  plan_prov_id INT REFERENCES planes_pago_proveedor(id) ON DELETE CASCADE,
  numero SMALLINT NOT NULL,
  fecha_limite DATE NOT NULL,
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  pagada BOOLEAN DEFAULT FALSE,
  UNIQUE (plan_prov_id, numero)
);

-- 6) Pagos al proveedor y facturas
CREATE TABLE IF NOT EXISTS pagos_proveedores (
  id SERIAL PRIMARY KEY,
  reserva_item_id INT REFERENCES reservas_items(id) ON DELETE CASCADE,
  cuota_proveedor_id INT REFERENCES cuotas_proveedor(id),
  monto NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  fecha_pago DATE,
  evidencia_url TEXT,
  enviado_a_email_pagos BOOLEAN DEFAULT FALSE,
  solicito_factura BOOLEAN DEFAULT FALSE,
  enviado_a_email_facturacion BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS facturas (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE CASCADE,
  tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('CLIENTE','PROVEEDOR')),
  folio VARCHAR(80),
  total NUMERIC(12,2),
  xml_url TEXT,
  pdf_url TEXT,
  receptor_rfc VARCHAR(20),
  receptor_razon VARCHAR(180),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7) Cotizaciones temporales (24 horas)
CREATE TABLE IF NOT EXISTS cotizaciones_temp (
  id SERIAL PRIMARY KEY,
  contacto_id INT REFERENCES contactos(id) ON DELETE CASCADE,
  numero_telefono VARCHAR(20) NOT NULL,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('PROMO','PERSONALIZADA')),
  promo_id INT REFERENCES promos(id),
  datos_cotizacion JSONB NOT NULL,
  imagen_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_contacto ON cotizaciones_temp(contacto_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_expires ON cotizaciones_temp(expires_at);

-- 7b) Evidencias (OCR) y Auditoría
CREATE TABLE IF NOT EXISTS evidencias (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE CASCADE,
  reserva_item_id INT REFERENCES reservas_items(id),
  tipo VARCHAR(30) CHECK (tipo IN ('PAGO_CLIENTE','PLAN_PROVEEDOR','PAGO_PROVEEDOR','PLAN_PAGOS_OCR')),
  archivo_url TEXT NOT NULL,
  ocr_json JSONB,
  ocr_confidence NUMERIC(5,2)
);
CREATE TABLE IF NOT EXISTS auditoria (
  id SERIAL PRIMARY KEY,
  entidad VARCHAR(40) NOT NULL,        -- 'pago_cliente','cuota_cliente','reserva_item', etc.
  entidad_id INT NOT NULL,
  accion VARCHAR(20) NOT NULL,         -- CREATE|UPDATE|CONFIRM|CANCEL|DELETE|SENDMAIL
  usuario_id INT REFERENCES usuarios(id),
  detalle JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8) Contabilidad y comisiones del vendedor
CREATE TABLE IF NOT EXISTS cat_gastos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL   -- 'Renta','Nómina','Ads','Luz','Comisión Pasarela', etc.
);
CREATE TABLE IF NOT EXISTS movimientos_contables (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id),
  tipo VARCHAR(25) CHECK (tipo IN ('INGRESO','COSTO','GASTO_FIJO','GASTO_VAR','COMISION_VENDEDOR')),
  categoria_id INT REFERENCES cat_gastos(id),
  concepto TEXT,
  monto NUMERIC(12,2) NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comisiones_vendedores (
  id SERIAL PRIMARY KEY,
  reserva_id INT REFERENCES reservas(id) ON DELETE CASCADE,
  vendedor_id INT REFERENCES usuarios(id),
  porcentaje NUMERIC(5,2) NOT NULL,        -- ej. 20
  base VARCHAR(25) NOT NULL CHECK (base IN ('INGRESO_AGENCIA','UTILIDAD_NETA')),
  monto_calculado NUMERIC(12,2) DEFAULT 0,
  estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE|LIBERADA
  liberada_at TIMESTAMPTZ
);

-- 9) Triggers críticos
-- A) Enforce “método único por reserva”
CREATE OR REPLACE FUNCTION trg_check_metodo_pago_unico()
RETURNS TRIGGER AS $$
DECLARE
  metodo_reserva VARCHAR(20);
BEGIN
  SELECT metodo_pago INTO metodo_reserva FROM reservas WHERE id = NEW.reserva_id;
  IF NEW.metodo_reportado IS NOT NULL AND NEW.metodo_reportado <> metodo_reserva THEN
    RAISE EXCEPTION 'El método de pago del pago (%) no coincide con el método de la reserva (%)',
      NEW.metodo_reportado, metodo_reserva;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'check_metodo_pago_unico'
  ) THEN
    CREATE TRIGGER check_metodo_pago_unico
    BEFORE INSERT OR UPDATE ON pagos_clientes
    FOR EACH ROW
    EXECUTE FUNCTION trg_check_metodo_pago_unico();
  END IF;
END $$;

-- B) No sobrepago del cliente (contra total_cliente)
CREATE OR REPLACE FUNCTION trg_no_sobrepago_cliente()
RETURNS TRIGGER AS $$
DECLARE
  total_cliente NUMERIC(12,2);
  cobrado NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(precio_cliente),0) INTO total_cliente
  FROM reservas_items WHERE reserva_id = NEW.reserva_id;

  SELECT COALESCE(SUM(monto),0) INTO cobrado
  FROM pagos_clientes
  WHERE reserva_id = NEW.reserva_id AND estado = 'CONFIRMADO';

  IF (cobrado + NEW.monto) > total_cliente THEN
    RAISE EXCEPTION 'Sobrepago: monto supera el total del cliente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'no_sobrepago_cliente'
  ) THEN
    CREATE TRIGGER no_sobrepago_cliente
    BEFORE INSERT ON pagos_clientes
    FOR EACH ROW
    EXECUTE FUNCTION trg_no_sobrepago_cliente();
  END IF;
END $$;


      `);

    // Crear usuario admin por defecto (admin / admin123)
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO usuarios (nombre_usuario, password, tipo_usuario)
      VALUES ($1, $2, $3)
      ON CONFLICT (nombre_usuario)
      DO UPDATE SET password = EXCLUDED.password
      RETURNING id;
    `, ['admin', hashedPassword, 'admin']);

    // Crear etiquetas predefinidas
    const etiquetasBase = [
      { nombre: 'Frio', color: '#9ca3af', prioridad: 10, activo: true },
      { nombre: 'SIC', color: '#60a5fa', prioridad: 20, activo: true }, // Solicitud de info para cotizar
      { nombre: 'MP', color: '#34d399', prioridad: 30, activo: true }, // Se mandó promoción BD
      { nombre: 'MCP', color: '#f59e0b', prioridad: 40, activo: true }, // Cotización personalizada
      { nombre: 'Seguimiento', color: '#f472b6', prioridad: 50, activo: true },
      { nombre: 'Reservar', color: '#a78bfa', prioridad: 60, activo: true },
      { nombre: 'Cerrado', color: '#22c55e', prioridad: 70, activo: true },
    ];


    // Siembra/actualiza las etiquetas base (idempotente)
    for (const et of etiquetasBase) {
      await ejecutarConReintento(`
    INSERT INTO etiquetas (nombre, color, prioridad, activo)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (nombre) DO UPDATE
    SET color = EXCLUDED.color,
        prioridad = EXCLUDED.prioridad,
        activo = EXCLUDED.activo
  `, [et.nombre, et.color, et.prioridad, et.activo]);
    }


    console.log('Base de datos inicializada correctamente');
  } catch (err) {
    console.error('Error al inicializar la base de datos:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ejecuta una consulta con reintentos, para evitar errores transitorios.
 */
async function ejecutarConReintento(consulta, valores, maxReintentos = 3) {
  let ultimoError;
  for (let intento = 1; intento <= maxReintentos; intento++) {
    const client = await pool.connect();
    try {
      await client.query("SET client_encoding TO 'UTF8'");
      await client.query("SET standard_conforming_strings TO on");

      if (valores) {
        // Para normalizar saltos de línea en caso de problemas
        valores = valores.map(valor =>
          typeof valor === 'string'
            ? valor.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            : valor
        );
      }

      const result = await client.query(consulta, valores);
      client.release();
      return result;
    } catch (err) {
      client.release();
      ultimoError = err;
      console.error(`Error en intento ${intento}:`, err);
      if (intento === maxReintentos) {
        throw new Error(`Error después de ${maxReintentos} intentos: ${err.message}`);
      }
      // Espera incremental antes del siguiente intento
      await new Promise(r => setTimeout(r, 1000 * intento));
    }
  }
}

/**
 * Retorna las etiquetas asignadas a un número de teléfono.
 */
async function getEtiquetasChat(phoneNumber) {
  const query = `
      SELECT 
        e.id, 
        e.nombre, 
        e.color, 
        e.descripcion, 
        e.prioridad,
        COALESCE(ce.activo, false) AS activo
      FROM etiquetas e
      LEFT JOIN chat_etiquetas ce 
        ON ce.etiqueta_id = e.id AND ce.numero_telefono = $1
      WHERE e.activo = TRUE
      ORDER BY e.prioridad;
    `;
  const result = await ejecutarConReintento(query, [phoneNumber]);
  return result.rows;
}


/**
 * Inserta un mensaje (ya parseado) en la tabla 'mensajes'.
 * msg = { phoneNumber, message, timestamp, sender_type, pushName, broadcast }
 */
// Modificación a la función insertarMensajeEnDB en db.js
async function insertarMensajeEnDB(msg) {
  try {
    // Si msg.timestamp no es válido, usar la fecha actual
    const ts = (msg.timestamp && !isNaN(msg.timestamp)) ? msg.timestamp : Date.now();

    const query = `
      INSERT INTO mensajes (
        numero_telefono,
        mensaje,
        tipo_remitente,
        fecha_hora,
        nombre_usuario,
        estado,
        tipo_contenido,
        url_archivo,
        nombre_archivo,
        tamano_archivo
      )
      VALUES (
        $1,
        $2,
        $3,
        to_timestamp($4/1000.0),
        $5,
        'received',
        $6,
        $7,
        $8,
        $9
      )
    `;
    const values = [
      msg.phoneNumber,
      msg.message,
      msg.sender_type,
      ts,
      msg.nombre_usuario || msg.pushName || null,
      msg.tipo_contenido || null,
      msg.url_archivo || null,
      msg.nombre_archivo || null,
      msg.tamano_archivo || null
    ];
    await ejecutarConReintento(query, values);

    // Insertar contacto SOLO SI NO EXISTE YA
    const nombreParaContacto = msg.subject || msg.pushName;
    if (nombreParaContacto) {
      // Primero verificar si ya existe un contacto con este número
      const checkContacto = `
        SELECT nombre, fecha_actualizacion 
        FROM contactos 
        WHERE numero_telefono = $1
      `;
      const contactoExistente = await ejecutarConReintento(checkContacto, [msg.phoneNumber]);

      // Insertar solo si no existe, o si existe pero sin nombre personalizado
      if (contactoExistente.rows.length === 0) {
        // No existe contacto, crearlo
        const insertContacto = `
          INSERT INTO contactos (numero_telefono, nombre)
          VALUES ($1, $2)
        `;
        await ejecutarConReintento(insertContacto, [msg.phoneNumber, nombreParaContacto]);
      } else if (!contactoExistente.rows[0].nombre) {
        // Existe pero sin nombre, actualizarlo
        const updateContacto = `
          UPDATE contactos 
          SET nombre = $2, fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE numero_telefono = $1 AND nombre IS NULL
        `;
        await ejecutarConReintento(updateContacto, [msg.phoneNumber, nombreParaContacto]);
      }
      // Si ya existe con nombre, no hacer nada para preservar el nombre personalizado
    }
  } catch (error) {
    console.error('Error al insertar mensaje en DB:', error);
  }
}


async function checkIfBlocked(numeroTelefono) {
  const query = `
    SELECT 1 
    FROM blocked_numbers 
    WHERE numero_telefono = $1 
    LIMIT 1;
  `;
  const result = await ejecutarConReintento(query, [numeroTelefono]);
  return result.rows.length > 0;
}


async function getConversationId(numeroTelefono) {
  const q = `SELECT conversation_id FROM openai_conversations WHERE numero_telefono = $1 LIMIT 1`;
  const r = await ejecutarConReintento(q, [numeroTelefono]);
  return r.rows.length ? r.rows[0].conversation_id : null;
}

async function upsertConversationId(numeroTelefono, conversationId) {
  const q = `
    INSERT INTO openai_conversations (numero_telefono, conversation_id)
    VALUES ($1, $2)
    ON CONFLICT (numero_telefono)
    DO UPDATE SET conversation_id = EXCLUDED.conversation_id,
                  fecha_actualizacion = CURRENT_TIMESTAMP
    RETURNING conversation_id;
  `;
  const r = await ejecutarConReintento(q, [numeroTelefono, conversationId]);
  return r.rows[0].conversation_id;
}


/**
 * Ejemplo de una función toggleEtiqueta (así no falte nada).
 * Puedes personalizarla si manejas la asignación en tu UI.
 */
async function toggleEtiqueta(phoneNumber, etiquetaId, userId) {
  // Lógica para asignar/desasignar una etiqueta en chat_etiquetas
  // Este es un ejemplo mínimo. Ajusta según tu flow.
  const check = `
    SELECT * FROM chat_etiquetas
    WHERE numero_telefono = $1
      AND etiqueta_id = $2
      AND activo = TRUE
  `;
  const checkRes = await ejecutarConReintento(check, [phoneNumber, etiquetaId]);
  if (checkRes.rows.length > 0) {
    // Desactivar
    const desactiva = `
      UPDATE chat_etiquetas
      SET activo = FALSE
      WHERE numero_telefono = $1
        AND etiqueta_id = $2
    `;
    await ejecutarConReintento(desactiva, [phoneNumber, etiquetaId]);
    return { toggled: 'removed' };
  } else {
    // Asignar (activar)
    const asigna = `
      INSERT INTO chat_etiquetas (numero_telefono, etiqueta_id, usuario_id, activo)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (numero_telefono, etiqueta_id)
      DO UPDATE SET activo = EXCLUDED.activo;
    `;
    await ejecutarConReintento(asigna, [phoneNumber, etiquetaId, userId]);
    return { toggled: 'added' };
  }
}

// Asegura assistant_status para un número
async function setAssistantStatus(phoneNumber, active) {
  const q = `UPDATE contactos SET assistant_status=$2, fecha_actualizacion=CURRENT_TIMESTAMP WHERE numero_telefono=$1`;
  await ejecutarConReintento(q, [phoneNumber, !!active]);
  return true;
}

// Busca top 3 promos por filtros simples (mismo SQL que usa openai-handler)
// Útil si luego quieres mover esta lógica fuera del handler.
async function findPromosDB(filters = {}) {
  const { destino, mes, TI, transporte } = filters || {};
  const params = [];
  const where = ['activo = TRUE'];
  if (destino) { params.push(`%${destino}%`); where.push(`LOWER(destino) LIKE LOWER($${params.length})`); }
  if (typeof TI === 'boolean') { params.push(TI); where.push(`todo_incluido = $${params.length}`); }
  if (transporte) { params.push(transporte); where.push(`transporte_tipo = $${params.length}`); }
  if (mes) { params.push(mes); where.push(`EXTRACT(YEAR FROM fecha_salida)||'-'||LPAD(EXTRACT(MONTH FROM fecha_salida)::text,2,'0') = $${params.length}`); }

  const sql = `
    SELECT id, titulo, destino, descripcion, todo_incluido, con_transporte, transporte_tipo, traslados,
           incluye_desayuno_llegada, menores_gratis, menores_gratis_politica, ninos_2x1, entrega_anticipada,
           precio_adulto, precio_menor, precio_bus_menor, fecha_salida, fecha_llegada, reserva_inicio, reserva_fin, imagenes
    FROM promos
    WHERE ${where.join(' AND ')}
    ORDER BY fecha_salida NULLS LAST, id DESC
    LIMIT 3
  `;
  const { rows } = await ejecutarConReintento(sql, params);
  for (const p of rows) {
    try { p.imagenes = p.imagenes ? JSON.parse(p.imagenes) : []; } catch { p.imagenes = []; }
  }
  return rows;
}

module.exports = {
  pool,
  initDatabase,
  checkIfBlocked,
  ejecutarConReintento,
  getEtiquetasChat,
  insertarMensajeEnDB,
  toggleEtiqueta,
  getConversationId,
  upsertConversationId,
  setAssistantStatus,
  findPromosDB
};
