-- Migración para corregir columna created_at en notas_internas
-- Ejecutar este script en Railway para corregir el error

-- 1. Verificar si existe fecha_creacion y renombrarla a created_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'notas_internas' AND column_name = 'fecha_creacion') THEN
    ALTER TABLE notas_internas RENAME COLUMN fecha_creacion TO created_at;
    RAISE NOTICE 'Columna fecha_creacion renombrada a created_at';
  END IF;
END $$;

-- 2. Agregar created_at si no existe (para bases de datos sin migración previa)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'notas_internas' AND column_name = 'created_at') THEN
    ALTER TABLE notas_internas ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
    RAISE NOTICE 'Columna created_at agregada';
  ELSE
    RAISE NOTICE 'Columna created_at ya existe';
  END IF;
END $$;

-- 3. Verificar el resultado
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'notas_internas'
ORDER BY ordinal_position;
