// src/services/pagos-proveedores.service.js
// Servicio para gestionar pagos a proveedores

const { ejecutarConReintento } = require('../database/db');

class PagosProveedoresService {
    /**
     * Listar ítems pendientes de pago a proveedores
     * @param {Object} filtros - Filtros opcionales
     * @returns {Promise<Array>}
     */
    async listarItemsPendientes(filtros = {}) {
        const { proveedor_id, limit = 50, offset = 0 } = filtros;

        const where = [];
        const params = [];
        let paramCount = 0;

        if (proveedor_id) {
            paramCount++;
            where.push(`ri.proveedor_id = $${paramCount}`);
            params.push(proveedor_id);
        }

        const whereClause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';

        const sql = `
            WITH items_con_pagado AS (
                SELECT
                    ri.id AS item_id,
                    ri.reserva_id,
                    ri.proveedor_id,
                    ri.tipo AS item_tipo,
                    ri.descripcion,
                    ri.precio_proveedor,
                    COALESCE(SUM(pp.monto), 0) AS total_pagado,
                    (ri.precio_proveedor - COALESCE(SUM(pp.monto), 0)) AS saldo_pendiente
                FROM reservas_items ri
                LEFT JOIN pagos_proveedores pp ON pp.reserva_item_id = ri.id
                WHERE ri.precio_proveedor > 0
                ${whereClause}
                GROUP BY ri.id, ri.reserva_id, ri.proveedor_id, ri.tipo, ri.descripcion, ri.precio_proveedor
                HAVING (ri.precio_proveedor - COALESCE(SUM(pp.monto), 0)) > 0
            )
            SELECT
                i.*,
                p.nombre AS proveedor_nombre,
                r.folio_interno,
                r.destino,
                r.estado AS reserva_estado,
                c.nombre AS cliente_nombre,
                c.numero_telefono AS cliente_telefono
            FROM items_con_pagado i
            JOIN proveedores p ON p.id = i.proveedor_id
            JOIN reservas r ON r.id = i.reserva_id
            JOIN contactos c ON c.id = r.contacto_id
            ORDER BY r.created_at DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;

        params.push(limit, offset);

        const result = await ejecutarConReintento(sql, params);
        return result.rows;
    }

    /**
     * Registrar un pago a proveedor
     * @param {Object} data - Datos del pago
     * @returns {Promise<Object>}
     */
    async registrarPago(data) {
        const {
            reserva_item_id,
            monto,
            fecha_pago,
            evidencia_url,
            solicito_factura = false
        } = data;

        // Validar que el ítem existe y tiene saldo pendiente
        const itemCheck = await ejecutarConReintento(`
            SELECT
                ri.id,
                ri.precio_proveedor,
                COALESCE(SUM(pp.monto), 0) AS total_pagado,
                (ri.precio_proveedor - COALESCE(SUM(pp.monto), 0)) AS saldo_pendiente
            FROM reservas_items ri
            LEFT JOIN pagos_proveedores pp ON pp.reserva_item_id = ri.id
            WHERE ri.id = $1
            GROUP BY ri.id, ri.precio_proveedor
        `, [reserva_item_id]);

        if (itemCheck.rows.length === 0) {
            throw new Error('Ítem de reserva no encontrado');
        }

        const item = itemCheck.rows[0];
        const saldoPendiente = parseFloat(item.saldo_pendiente);
        const montoPago = parseFloat(monto);

        if (montoPago > saldoPendiente) {
            throw new Error(`El monto ($${montoPago}) excede el saldo pendiente ($${saldoPendiente})`);
        }

        // Insertar el pago
        const insertSql = `
            INSERT INTO pagos_proveedores (
                reserva_item_id,
                monto,
                fecha_pago,
                evidencia_url,
                solicito_factura
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;

        const result = await ejecutarConReintento(insertSql, [
            reserva_item_id,
            montoPago,
            fecha_pago || new Date().toISOString().split('T')[0],
            evidencia_url || null,
            solicito_factura
        ]);

        return result.rows[0];
    }

    /**
     * Obtener resumen de deuda por proveedor
     * @param {number} proveedorId
     * @returns {Promise<Object>}
     */
    async getResumenDeuda(proveedorId) {
        const sql = `
            SELECT
                COUNT(DISTINCT ri.id) AS items_pendientes,
                SUM(ri.precio_proveedor) AS total_adeudado,
                SUM(COALESCE(pp.monto, 0)) AS total_pagado,
                SUM(ri.precio_proveedor - COALESCE(pp.monto, 0)) AS saldo_pendiente
            FROM reservas_items ri
            LEFT JOIN (
                SELECT reserva_item_id, SUM(monto) AS monto
                FROM pagos_proveedores
                GROUP BY reserva_item_id
            ) pp ON pp.reserva_item_id = ri.id
            WHERE ri.proveedor_id = $1
            AND ri.precio_proveedor > 0
        `;

        const result = await ejecutarConReintento(sql, [proveedorId]);
        return result.rows[0] || {
            items_pendientes: 0,
            total_adeudado: 0,
            total_pagado: 0,
            saldo_pendiente: 0
        };
    }

    /**
     * Obtener historial de pagos de un ítem
     * @param {number} itemId
     * @returns {Promise<Array>}
     */
    async getHistorialPagos(itemId) {
        const sql = `
            SELECT
                pp.*,
                ri.descripcion AS item_descripcion,
                p.nombre AS proveedor_nombre
            FROM pagos_proveedores pp
            JOIN reservas_items ri ON ri.id = pp.reserva_item_id
            JOIN proveedores p ON p.id = ri.proveedor_id
            WHERE pp.reserva_item_id = $1
            ORDER BY pp.fecha_pago DESC
        `;

        const result = await ejecutarConReintento(sql, [itemId]);
        return result.rows;
    }

    /**
     * Marcar pago como enviado a email de pagos
     * @param {number} pagoId
     * @returns {Promise<Object>}
     */
    async marcarEnviadoEmailPagos(pagoId) {
        const sql = `
            UPDATE pagos_proveedores
            SET enviado_a_email_pagos = TRUE
            WHERE id = $1
            RETURNING *
        `;

        const result = await ejecutarConReintento(sql, [pagoId]);
        return result.rows[0];
    }

    /**
     * Marcar pago como enviado a email de facturación
     * @param {number} pagoId
     * @returns {Promise<Object>}
     */
    async marcarEnviadoEmailFacturacion(pagoId) {
        const sql = `
            UPDATE pagos_proveedores
            SET enviado_a_email_facturacion = TRUE
            WHERE id = $1
            RETURNING *
        `;

        const result = await ejecutarConReintento(sql, [pagoId]);
        return result.rows[0];
    }
}

module.exports = new PagosProveedoresService();
