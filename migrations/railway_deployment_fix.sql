-- ============================================
-- MIGRACIÓN COMPLETA PARA RAILWAY
-- ============================================
-- Este script corrige ambos problemas:
-- 1. Columna created_at faltante en notas_internas
-- 2. Tabla whatsapp_sessions para persistencia en Railway

-- ============================================
-- PARTE 1: Corregir notas_internas
-- ============================================

-- 1.1 Verificar si existe fecha_creacion y renombrarla a created_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notas_internas' AND column_name = 'fecha_creacion') THEN
    ALTER TABLE notas_internas RENAME COLUMN fecha_creacion TO created_at;
    RAISE NOTICE '✓ Columna fecha_creacion renombrada a created_at';
  END IF;
END $$;

-- 1.2 Agregar created_at si no existe (para bases de datos sin migración previa)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'notas_internas' AND column_name = 'created_at') THEN
    ALTER TABLE notas_internas ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
    RAISE NOTICE '✓ Columna created_at agregada';
  ELSE
    RAISE NOTICE '✓ Columna created_at ya existe';
  END IF;
END $$;

-- ============================================
-- PARTE 2: Recrear tabla whatsapp_sessions para Railway
-- ============================================

-- 2.1 Respaldar datos existentes (si hay)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_sessions') THEN
    CREATE TEMP TABLE IF NOT EXISTS whatsapp_sessions_backup AS
    SELECT * FROM whatsapp_sessions WHERE activa = true LIMIT 1;
    RAISE NOTICE '✓ Respaldo de sesión activa creado';
  END IF;
END $$;

-- 2.2 Eliminar tabla antigua
DROP TABLE IF EXISTS whatsapp_sessions CASCADE;

-- 2.3 Crear nueva tabla optimizada para Railway
CREATE TABLE whatsapp_sessions (
  id SERIAL PRIMARY KEY,
  session_key VARCHAR(100) UNIQUE NOT NULL,  -- creds, app-state-sync-key-{id}, etc.
  session_value JSONB NOT NULL,              -- Datos serializados con BufferJSON
  activa BOOLEAN DEFAULT TRUE,
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2.4 Crear índices para mejor performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_key ON whatsapp_sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_activa ON whatsapp_sessions(activa) WHERE activa = true;

-- 2.5 Crear función de actualización automática del timestamp
CREATE OR REPLACE FUNCTION update_whatsapp_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2.6 Crear trigger para actualización automática
DROP TRIGGER IF EXISTS trg_update_whatsapp_session_timestamp ON whatsapp_sessions;
CREATE TRIGGER trg_update_whatsapp_session_timestamp
  BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_session_timestamp();

-- ============================================
-- PARTE 3: Verificaciones
-- ============================================

-- 3.1 Verificar estructura de notas_internas
SELECT
  '✓ NOTAS_INTERNAS: Estructura verificada' as status,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'notas_internas' AND column_name IN ('id', 'created_at', 'nota')
ORDER BY ordinal_position;

-- 3.2 Verificar estructura de whatsapp_sessions
SELECT
  '✓ WHATSAPP_SESSIONS: Estructura verificada' as status,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'whatsapp_sessions'
ORDER BY ordinal_position;

-- ============================================
-- NOTAS IMPORTANTES PARA RAILWAY:
-- ============================================
-- 1. Esta migración debe ejecutarse UNA SOLA VEZ en Railway
-- 2. La sesión de WhatsApp actual se perderá (deberás escanear QR nuevamente)
-- 3. Después de esta migración, la app usará PostgreSQL para guardar la sesión
-- 4. La sesión persistirá entre reinicios del contenedor
-- ============================================

-- Mensaje final
DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE '✓ MIGRACIÓN COMPLETADA EXITOSAMENTE';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Próximos pasos:';
  RAISE NOTICE '1. Desplegar código actualizado en Railway';
  RAISE NOTICE '2. Escanear QR de WhatsApp nuevamente';
  RAISE NOTICE '3. La sesión ahora persistirá en PostgreSQL';
  RAISE NOTICE '============================================';
END $$;
