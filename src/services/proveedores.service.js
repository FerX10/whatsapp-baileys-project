// src/services/proveedores.service.js
const { ejecutarConReintento } = require('../database/db');

class ProveedoresService {
  /**
   * Listar todos los proveedores (opcionalmente solo activos)
   */
  async listarProveedores(soloActivos = false) {
    let query = 'SELECT * FROM proveedores';
    if (soloActivos) query += ' WHERE activo = TRUE';
    query += ' ORDER BY nombre ASC';

    const result = await ejecutarConReintento(query);
    return result.rows;
  }

  /**
   * Obtener un proveedor por ID
   */
  async getProveedor(id) {
    const query = 'SELECT * FROM proveedores WHERE id = $1';
    const result = await ejecutarConReintento(query, [id]);

    if (!result.rows.length) {
      throw new Error('Proveedor no encontrado');
    }

    return result.rows[0];
  }

  /**
   * Crear un nuevo proveedor
   */
  async crearProveedor(data) {
    const {
      nombre,
      comision_efectivo = 15.00,
      comision_tarjeta = 10.00,
      email_pagos,
      email_facturacion,
      portal_url,
      rfc,
      razon_social,
      constancia_fiscal_url
    } = data;

    if (!nombre) {
      throw new Error('El nombre del proveedor es obligatorio');
    }

    const query = `
      INSERT INTO proveedores
      (nombre, comision_efectivo, comision_tarjeta, email_pagos, email_facturacion,
       portal_url, rfc, razon_social, constancia_fiscal_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await ejecutarConReintento(query, [
      nombre,
      comision_efectivo,
      comision_tarjeta,
      email_pagos || null,
      email_facturacion || null,
      portal_url || null,
      rfc || null,
      razon_social || null,
      constancia_fiscal_url || null
    ]);

    return result.rows[0];
  }

  /**
   * Actualizar un proveedor
   */
  async actualizarProveedor(id, data) {
    const proveedor = await this.getProveedor(id);

    const {
      nombre = proveedor.nombre,
      comision_efectivo = proveedor.comision_efectivo,
      comision_tarjeta = proveedor.comision_tarjeta,
      email_pagos = proveedor.email_pagos,
      email_facturacion = proveedor.email_facturacion,
      portal_url = proveedor.portal_url,
      rfc = proveedor.rfc,
      razon_social = proveedor.razon_social,
      constancia_fiscal_url = proveedor.constancia_fiscal_url,
      activo = proveedor.activo
    } = data;

    const query = `
      UPDATE proveedores
      SET nombre = $1,
          comision_efectivo = $2,
          comision_tarjeta = $3,
          email_pagos = $4,
          email_facturacion = $5,
          portal_url = $6,
          rfc = $7,
          razon_social = $8,
          constancia_fiscal_url = $9,
          activo = $10,
          updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `;

    const result = await ejecutarConReintento(query, [
      nombre,
      comision_efectivo,
      comision_tarjeta,
      email_pagos,
      email_facturacion,
      portal_url,
      rfc,
      razon_social,
      constancia_fiscal_url,
      activo,
      id
    ]);

    return result.rows[0];
  }

  /**
   * Eliminar (desactivar) un proveedor
   */
  async eliminarProveedor(id) {
    const query = 'UPDATE proveedores SET activo = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *';
    const result = await ejecutarConReintento(query, [id]);

    if (!result.rows.length) {
      throw new Error('Proveedor no encontrado');
    }

    return result.rows[0];
  }

  /**
   * Obtener resumen de deuda con un proveedor
   */
  async getResumenDeuda(proveedorId) {
    const query = `
      SELECT
        p.id,
        p.nombre,
        COALESCE(SUM(ri.precio_proveedor), 0) as total_por_pagar,
        COALESCE(SUM(pp.monto), 0) as total_pagado,
        COALESCE(SUM(ri.precio_proveedor), 0) - COALESCE(SUM(pp.monto), 0) as saldo_pendiente,
        COUNT(DISTINCT r.id) as reservas_activas
      FROM proveedores p
      LEFT JOIN reservas_items ri ON ri.proveedor_id = p.id
      LEFT JOIN reservas r ON r.id = ri.reserva_id AND r.estado IN ('APARTADA', 'CONFIRMADA', 'LIQUIDADA')
      LEFT JOIN pagos_proveedores pp ON pp.reserva_item_id = ri.id
      WHERE p.id = $1
      GROUP BY p.id, p.nombre
    `;

    const result = await ejecutarConReintento(query, [proveedorId]);

    if (!result.rows.length) {
      return {
        id: proveedorId,
        total_por_pagar: 0,
        total_pagado: 0,
        saldo_pendiente: 0,
        reservas_activas: 0
      };
    }

    return result.rows[0];
  }

  /**
   * Obtener items pendientes de pago de un proveedor
   */
  async getItemsPendientesPago(proveedorId) {
    const query = `
      SELECT
        ri.id as item_id,
        r.id as reserva_id,
        r.destino,
        r.check_in,
        r.check_out,
        c.nombre as cliente_nombre,
        c.numero_telefono,
        ri.tipo,
        ri.descripcion,
        ri.precio_proveedor,
        COALESCE(SUM(pp.monto), 0) as monto_pagado,
        ri.precio_proveedor - COALESCE(SUM(pp.monto), 0) as saldo_pendiente,
        r.estado as estado_reserva
      FROM reservas_items ri
      JOIN reservas r ON r.id = ri.reserva_id
      JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN pagos_proveedores pp ON pp.reserva_item_id = ri.id
      WHERE ri.proveedor_id = $1
        AND r.estado IN ('APARTADA', 'CONFIRMADA', 'LIQUIDADA')
      GROUP BY ri.id, r.id, c.nombre, c.numero_telefono
      HAVING ri.precio_proveedor - COALESCE(SUM(pp.monto), 0) > 0
      ORDER BY r.check_in ASC
    `;

    const result = await ejecutarConReintento(query, [proveedorId]);
    return result.rows;
  }
}

module.exports = new ProveedoresService();
