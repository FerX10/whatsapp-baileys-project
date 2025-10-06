// src/services/usuarios.service.js
const { ejecutarConReintento } = require('../database/db');
const bcrypt = require('bcrypt');

class UsuariosService {
  /**
   * Listar usuarios (opcionalmente solo activos)
   */
  async listarUsuarios(soloActivos = false) {
    let query = `
      SELECT
        id, nombre_usuario, tipo_usuario, nombre_completo,
        numero_whatsapp, email, comision_porcentaje, activo, usuario_sistema, fecha_creacion
      FROM usuarios
    `;

    if (soloActivos) {
      query += ' WHERE activo = TRUE';
    }

    query += ' ORDER BY fecha_creacion DESC';

    const result = await ejecutarConReintento(query);
    return result.rows;
  }

  /**
   * Obtener un usuario por ID
   */
  async getUsuario(id) {
    const query = `
      SELECT
        id, nombre_usuario, tipo_usuario, nombre_completo,
        numero_whatsapp, email, comision_porcentaje, activo, usuario_sistema, fecha_creacion
      FROM usuarios
      WHERE id = $1
    `;

    const result = await ejecutarConReintento(query, [id]);

    if (!result.rows.length) {
      throw new Error('Usuario no encontrado');
    }

    return result.rows[0];
  }

  /**
   * Crear un nuevo usuario
   */
  async crearUsuario(data) {
    const {
      nombre_usuario,
      password,
      tipo_usuario = 'operador',
      nombre_completo,
      numero_whatsapp,
      email,
      comision_porcentaje = 25.00
    } = data;

    if (!nombre_usuario || !password) {
      throw new Error('El nombre de usuario y contraseña son obligatorios');
    }

    // Verificar que no exista
    const existente = await ejecutarConReintento(
      'SELECT id FROM usuarios WHERE nombre_usuario = $1',
      [nombre_usuario]
    );

    if (existente.rows.length > 0) {
      throw new Error('El nombre de usuario ya existe');
    }

    // Hashear contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO usuarios
      (nombre_usuario, password, tipo_usuario, nombre_completo, numero_whatsapp, email, comision_porcentaje)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, nombre_usuario, tipo_usuario, nombre_completo, numero_whatsapp, email, comision_porcentaje, activo, fecha_creacion
    `;

    const result = await ejecutarConReintento(query, [
      nombre_usuario,
      hashedPassword,
      tipo_usuario,
      nombre_completo || null,
      numero_whatsapp || null,
      email || null,
      comision_porcentaje
    ]);

    return result.rows[0];
  }

  /**
   * Actualizar un usuario
   */
  async actualizarUsuario(id, data) {
    const usuario = await this.getUsuario(id);

    // Proteger usuarios del sistema (como asistente_bot)
    if (usuario.usuario_sistema) {
      throw new Error('No se puede modificar un usuario del sistema');
    }

    const {
      nombre_usuario = usuario.nombre_usuario,
      nombre_completo = usuario.nombre_completo,
      numero_whatsapp = usuario.numero_whatsapp,
      email = usuario.email,
      comision_porcentaje = usuario.comision_porcentaje,
      tipo_usuario = usuario.tipo_usuario,
      activo = usuario.activo
    } = data;

    const query = `
      UPDATE usuarios
      SET
        nombre_usuario = $1,
        nombre_completo = $2,
        numero_whatsapp = $3,
        email = $4,
        comision_porcentaje = $5,
        tipo_usuario = $6,
        activo = $7
      WHERE id = $8
      RETURNING id, nombre_usuario, tipo_usuario, nombre_completo, numero_whatsapp, email, comision_porcentaje, activo, usuario_sistema, fecha_creacion
    `;

    const result = await ejecutarConReintento(query, [
      nombre_usuario,
      nombre_completo,
      numero_whatsapp,
      email,
      comision_porcentaje,
      tipo_usuario,
      activo,
      id
    ]);

    return result.rows[0];
  }

  /**
   * Cambiar contraseña de un usuario
   */
  async cambiarPassword(id, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('La contraseña debe tener al menos 6 caracteres');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const query = 'UPDATE usuarios SET password = $1 WHERE id = $2';
    await ejecutarConReintento(query, [hashedPassword, id]);

    return { success: true };
  }

  /**
   * Eliminar (desactivar) un usuario
   */
  async eliminarUsuario(id) {
    const usuario = await this.getUsuario(id);

    // Proteger usuarios del sistema (como asistente_bot)
    if (usuario.usuario_sistema) {
      throw new Error('No se puede eliminar un usuario del sistema');
    }

    // Verificar que no sea el último admin
    const admins = await ejecutarConReintento(
      `SELECT COUNT(*) as total FROM usuarios WHERE tipo_usuario = 'admin' AND activo = TRUE`
    );

    if (usuario.tipo_usuario === 'admin' && Number(admins.rows[0].total) <= 1) {
      throw new Error('No se puede desactivar el último administrador del sistema');
    }

    const query = 'DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre_usuario';
    const result = await ejecutarConReintento(query, [id]);

    if (!result.rows.length) {
      throw new Error('Usuario no encontrado');
    }

    return result.rows[0];
  }

  /**
   * Obtener comisiones pendientes y liberadas de un vendedor
   */
  async getComisionesVendedor(vendedorId) {
    const query = `
      SELECT
        cv.id,
        cv.reserva_id,
        r.destino,
        cv.porcentaje,
        cv.base,
        cv.monto_calculado,
        cv.estado,
        cv.liberada_at,
        c.nombre as cliente_nombre
      FROM comisiones_vendedores cv
      JOIN reservas r ON r.id = cv.reserva_id
      JOIN contactos c ON c.id = r.contacto_id
      WHERE cv.vendedor_id = $1
      ORDER BY cv.liberada_at DESC NULLS FIRST, cv.id DESC
    `;

    const result = await ejecutarConReintento(query, [vendedorId]);
    return result.rows;
  }

  /**
   * Obtener resumen de comisiones de un vendedor
   */
  async getResumenComisiones(vendedorId) {
    const query = `
      SELECT
        COALESCE(SUM(CASE WHEN estado = 'PENDIENTE' THEN monto_calculado ELSE 0 END), 0) as pendiente,
        COALESCE(SUM(CASE WHEN estado = 'LIBERADA' THEN monto_calculado ELSE 0 END), 0) as liberada,
        COUNT(CASE WHEN estado = 'PENDIENTE' THEN 1 END) as reservas_pendientes,
        COUNT(CASE WHEN estado = 'LIBERADA' THEN 1 END) as reservas_liberadas
      FROM comisiones_vendedores
      WHERE vendedor_id = $1
    `;

    const result = await ejecutarConReintento(query, [vendedorId]);
    return result.rows[0];
  }
}

module.exports = new UsuariosService();
