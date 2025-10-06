// src/services/reservas.service.js
const { ejecutarConReintento } = require('../database/db');

class ReservasService {
  /**
   * Obtiene el porcentaje de comisión según el método de pago
   */
  async getProveedorComision(proveedorId, metodoPago) {
    const q = `SELECT comision_efectivo, comision_tarjeta FROM proveedores WHERE id=$1`;
    const r = await ejecutarConReintento(q, [proveedorId]);
    if (!r.rows.length) throw new Error('Proveedor no encontrado');

    const { comision_efectivo, comision_tarjeta } = r.rows[0];

    if (metodoPago === 'TARJETA') return Number(comision_tarjeta);
    return Number(comision_efectivo); // EFECTIVO o TRANSFERENCIA
  }

  /**
   * Calcula el precio del proveedor
   * VUELO: sin comisión (precio_proveedor = precio_neto)
   * Otros: precio_proveedor = precio_neto * (1 - comision%)
   */
  calcularPrecioProveedor(tipo, precioNeto, pctComision) {
    if (tipo === 'VUELO') return precioNeto;
    return Number(precioNeto) * (1 - Number(pctComision) / 100);
  }

  /**
   * Crea una reserva con sus items
   */
  async crearReserva(data) {
    const {
      contacto_id, vendedor_id, destino,
      check_in, check_out, ocupacion,
      metodo_pago, moneda = 'MXN',
      items = []
    } = data;

    if (!contacto_id || !destino || !metodo_pago || !items.length) {
      throw new Error('Faltan campos obligatorios: contacto_id, destino, metodo_pago, items[]');
    }

    const insReserva = `
      INSERT INTO reservas (contacto_id, vendedor_id, destino, check_in, check_out, ocupacion, metodo_pago, moneda)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `;

    const resReserva = await ejecutarConReintento(insReserva, [
      contacto_id,
      vendedor_id || null,
      destino,
      check_in || null,
      check_out || null,
      ocupacion ? JSON.stringify(ocupacion) : null,
      metodo_pago,
      moneda
    ]);

    const reservaId = resReserva.rows[0].id;

    // Insertar items
    const insItem = `
      INSERT INTO reservas_items (reserva_id, proveedor_id, tipo, descripcion, precio_neto, precio_proveedor, precio_cliente)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id
    `;

    const insertedItems = [];
    for (const item of items) {
      const { proveedor_id, tipo, descripcion, precio_neto, precio_cliente, precio_proveedor } = item;

      if (!proveedor_id || !tipo || !precio_neto || !precio_cliente) {
        throw new Error('Cada item requiere: proveedor_id, tipo, precio_neto, precio_cliente');
      }

      let precioProv = precio_proveedor;
      if (precioProv == null) {
        const pct = await this.getProveedorComision(proveedor_id, metodo_pago);
        precioProv = this.calcularPrecioProveedor(tipo, precio_neto, pct);
      }

      const resItem = await ejecutarConReintento(insItem, [
        reservaId,
        proveedor_id,
        tipo,
        descripcion || null,
        precio_neto,
        precioProv,
        precio_cliente
      ]);

      insertedItems.push(resItem.rows[0].id);
    }

    return { reserva_id: reservaId, items: insertedItems };
  }

  /**
   * Obtiene una reserva completa con sus items, plan de pagos, etc.
   */
  async getReserva(reservaId) {
    const qReserva = `
      SELECT r.*,
             c.nombre AS contacto_nombre,
             c.numero_telefono AS contacto_telefono,
             c.email AS contacto_email,
             u.nombre_usuario AS vendedor_nombre
      FROM reservas r
      LEFT JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN usuarios u ON u.id = r.vendedor_id
      WHERE r.id = $1
    `;
    const resReserva = await ejecutarConReintento(qReserva, [reservaId]);
    if (!resReserva.rows.length) return null;

    const reserva = resReserva.rows[0];

    // Items
    const qItems = `
      SELECT ri.*,
             p.nombre AS proveedor_nombre,
             p.comision_efectivo,
             p.comision_tarjeta
      FROM reservas_items ri
      LEFT JOIN proveedores p ON p.id = ri.proveedor_id
      WHERE ri.reserva_id = $1
      ORDER BY ri.id
    `;
    const resItems = await ejecutarConReintento(qItems, [reservaId]);
    reserva.items = resItems.rows;

    // Plan del cliente y cuotas
    const qPlan = `
      SELECT p.id AS plan_id, p.moneda,
             json_agg(
               json_build_object(
                 'id', c.id,
                 'numero', c.numero,
                 'fecha_limite', c.fecha_limite,
                 'monto', c.monto,
                 'estado', c.estado
               ) ORDER BY c.numero
             ) AS cuotas
      FROM planes_pago_cliente p
      LEFT JOIN cuotas_cliente c ON c.plan_id = p.id
      WHERE p.reserva_id = $1
      GROUP BY p.id, p.moneda
    `;
    const resPlan = await ejecutarConReintento(qPlan, [reservaId]);
    reserva.plan_cliente = resPlan.rows[0] || null;

    // Pagos del cliente
    const qPagos = `
      SELECT pc.*,
             u.nombre_usuario AS confirmado_por_nombre,
             cc.numero AS cuota_numero
      FROM pagos_clientes pc
      LEFT JOIN usuarios u ON u.id = pc.confirmado_por
      LEFT JOIN cuotas_cliente cc ON cc.id = pc.cuota_cliente_id
      WHERE pc.reserva_id = $1
      ORDER BY pc.created_at DESC
    `;
    const resPagos = await ejecutarConReintento(qPagos, [reservaId]);
    reserva.pagos_cliente = resPagos.rows;

    // Calcular totales y saldo
    const totales = this.calcularTotales(reserva);
    reserva.totales = totales;

    return reserva;
  }

  /**
   * Calcula totales de la reserva
   */
  calcularTotales(reserva) {
    const total_neto = reserva.items.reduce((sum, i) => sum + Number(i.precio_neto), 0);
    const total_proveedor = reserva.items.reduce((sum, i) => sum + Number(i.precio_proveedor), 0);
    const total_cliente = reserva.items.reduce((sum, i) => sum + Number(i.precio_cliente), 0);

    const cobrado_confirmado = reserva.pagos_cliente
      .filter(p => p.estado === 'CONFIRMADO')
      .reduce((sum, p) => sum + Number(p.monto), 0);

    const saldo_cliente = total_cliente - cobrado_confirmado;

    const ingreso_teorico = total_cliente - total_proveedor;

    return {
      total_neto,
      total_proveedor,
      total_cliente,
      cobrado_confirmado,
      saldo_cliente,
      ingreso_teorico
    };
  }

  /**
   * Actualiza el estado de una reserva automáticamente según reglas
   */
  async actualizarEstadoReserva(reservaId) {
    const reserva = await this.getReserva(reservaId);
    if (!reserva) throw new Error('Reserva no encontrada');

    const { totales, estado } = reserva;
    const { total_cliente, cobrado_confirmado, saldo_cliente } = totales;

    // Obtener anticipo mínimo requerido
    const qParam = `SELECT valor_numero FROM parametros_globales WHERE clave='ANTICIPO_MIN_PORC'`;
    const resParam = await ejecutarConReintento(qParam);
    const anticipoPorc = Number(resParam.rows[0]?.valor_numero || 30);

    let nuevoEstado = estado;

    // COTIZADA → APARTADA si cobrado >= 30%
    if (estado === 'COTIZADA' && cobrado_confirmado >= (total_cliente * anticipoPorc / 100)) {
      nuevoEstado = 'APARTADA';
    }

    // APARTADA/CONFIRMADA → LIQUIDADA si saldo = 0
    if (['APARTADA', 'CONFIRMADA'].includes(estado) && saldo_cliente === 0) {
      nuevoEstado = 'LIQUIDADA';

      // Liberar comisión del vendedor
      await this.liberarComisionVendedor(reservaId);
    }

    if (nuevoEstado !== estado) {
      const qUpdate = `UPDATE reservas SET estado=$1, updated_at=NOW() WHERE id=$2`;
      await ejecutarConReintento(qUpdate, [nuevoEstado, reservaId]);

      // Auditoría
      await ejecutarConReintento(
        `INSERT INTO auditoria (entidad, entidad_id, accion, detalle)
         VALUES ('reserva',$1,'UPDATE_ESTADO',$2)`,
        [reservaId, JSON.stringify({ estado_anterior: estado, estado_nuevo: nuevoEstado })]
      );
    }

    return nuevoEstado;
  }

  /**
   * Libera la comisión del vendedor cuando la reserva está liquidada
   */
  async liberarComisionVendedor(reservaId) {
    const qComision = `
      SELECT id FROM comisiones_vendedores
      WHERE reserva_id=$1 AND estado='PENDIENTE'
    `;
    const resComision = await ejecutarConReintento(qComision, [reservaId]);

    for (const row of resComision.rows) {
      await ejecutarConReintento(
        `UPDATE comisiones_vendedores
         SET estado='LIBERADA', liberada_at=NOW()
         WHERE id=$1`,
        [row.id]
      );
    }
  }

  /**
   * Lista reservas con filtros
   */
  async listarReservas(filtros = {}) {
    const { estado, vendedor_id, contacto_id, desde, hasta, limit = 50, offset = 0 } = filtros;

    const where = [];
    const params = [];

    if (estado) {
      params.push(estado);
      where.push(`r.estado = $${params.length}`);
    }
    if (vendedor_id) {
      params.push(vendedor_id);
      where.push(`r.vendedor_id = $${params.length}`);
    }
    if (contacto_id) {
      params.push(contacto_id);
      where.push(`r.contacto_id = $${params.length}`);
    }
    if (desde) {
      params.push(desde);
      where.push(`r.created_at >= $${params.length}`);
    }
    if (hasta) {
      params.push(hasta);
      where.push(`r.created_at <= $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    params.push(limit);
    params.push(offset);

    const q = `
      SELECT r.*,
             c.nombre AS contacto_nombre,
             c.numero_telefono AS contacto_telefono,
             u.nombre_usuario AS vendedor_nombre
      FROM reservas r
      LEFT JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN usuarios u ON u.id = r.vendedor_id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const res = await ejecutarConReintento(q, params);
    return res.rows;
  }
}

module.exports = new ReservasService();
