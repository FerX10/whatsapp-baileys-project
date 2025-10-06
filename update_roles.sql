-- Script para actualizar sistema de roles
-- Ejecutar este script para implementar el sistema de gerente/admin/operador

-- 1. Marcar asistente_bot como usuario de sistema (no editable/eliminable)
UPDATE usuarios
SET usuario_sistema = TRUE
WHERE nombre_usuario = 'asistente_bot';

-- 2. Si quieres convertir tu usuario actual a gerente, ejecuta esto:
-- Reemplaza 'TU_NOMBRE_USUARIO' con tu nombre de usuario real
-- UPDATE usuarios
-- SET tipo_usuario = 'gerente'
-- WHERE nombre_usuario = 'TU_NOMBRE_USUARIO';

-- 3. Verificar usuarios actuales
SELECT id, nombre_usuario, tipo_usuario, usuario_sistema, activo
FROM usuarios
ORDER BY id;
