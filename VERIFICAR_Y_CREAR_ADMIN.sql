-- SCRIPT PARA VERIFICAR Y CREAR USUARIOS ADMIN
-- Ejecuta esto en pgAdmin o psql

-- 1. Ver todos los usuarios actuales
SELECT
    id,
    nombre_usuario,
    tipo_usuario,
    nombre_completo,
    email,
    activo,
    fecha_creacion
FROM usuarios
ORDER BY id;

-- 2. Si NO HAY USUARIOS, crear un admin por defecto
-- Contraseña: admin123
INSERT INTO usuarios (nombre_usuario, password, tipo_usuario, nombre_completo, activo)
VALUES (
    'admin',
    '$2b$10$YourHashedPasswordHere', -- Cambia esto por un hash bcrypt real
    'admin',
    'Administrador Principal',
    true
)
ON CONFLICT (nombre_usuario) DO NOTHING;

-- 3. Si YA TIENES UN USUARIO pero NO ES ADMIN, conviértelo en admin:
-- Reemplaza 'tu_usuario' con tu nombre de usuario actual
UPDATE usuarios
SET tipo_usuario = 'admin'
WHERE nombre_usuario = 'tu_usuario';

-- 4. Verificar el resultado
SELECT
    id,
    nombre_usuario,
    tipo_usuario,
    nombre_completo,
    activo
FROM usuarios
WHERE tipo_usuario = 'admin';
