// src/services/pagos.service.js
const { ejecutarConReintento } = require('../database/db');
const reservasService = require('./reservas.service');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PagosService {
  /**
   * Crea un pago del cliente (estado PENDIENTE)
   */
  async crearPagoCliente(data) {
    const { reserva_id, cuota_cliente_id, monto, evidencia_url, metodo_reportado, usuario_id } = data;

    if (!reserva_id || !monto) {
      throw new Error('reserva_id y monto son requeridos');
    }

    // Si no especifican cuota, buscar la próxima pendiente
    let cuotaId = cuota_cliente_id;
    if (!cuotaId) {
      const qCuota = `
        SELECT cc.id
        FROM planes_pago_cliente p
        JOIN cuotas_cliente cc ON cc.plan_id = p.id
        WHERE p.reserva_id = $1 AND cc.estado='PENDIENTE'
        ORDER BY cc.numero ASC
        LIMIT 1
      `;
      const resCuota = await ejecutarConReintento(qCuota, [reserva_id]);
      cuotaId = resCuota.rows[0]?.id || null;
    }

    const qIns = `
      INSERT INTO pagos_clientes (reserva_id, cuota_cliente_id, monto, evidencia_url, metodo_reportado)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id
    `;
    const res = await ejecutarConReintento(qIns, [
      reserva_id,
      cuotaId,
      monto,
      evidencia_url || null,
      metodo_reportado || null
    ]);

    const pagoId = res.rows[0].id;

    // Auditoría
    await ejecutarConReintento(
      `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, detalle)
       VALUES ('pago_cliente',$1,'CREATE',$2,$3)`,
      [pagoId, usuario_id || null, JSON.stringify({ evidencia_url })]
    );

    return { pago_id: pagoId, cuota_cliente_id: cuotaId };
  }

  /**
   * Confirma un pago del cliente
   */
  async confirmarPagoCliente(pagoId, usuarioId) {
    // Obtener pago y reserva
    const qPago = `SELECT id, reserva_id, cuota_cliente_id, monto FROM pagos_clientes WHERE id=$1`;
    const resPago = await ejecutarConReintento(qPago, [pagoId]);
    if (!resPago.rows.length) throw new Error('Pago no encontrado');

    const { reserva_id, cuota_cliente_id } = resPago.rows[0];

    // Confirmar pago
    await ejecutarConReintento(
      `UPDATE pagos_clientes
       SET estado='CONFIRMADO', confirmado_por=$1, confirmado_at=NOW()
       WHERE id=$2`,
      [usuarioId, pagoId]
    );

    // Marcar cuota como CONFIRMADA
    if (cuota_cliente_id) {
      await ejecutarConReintento(
        `UPDATE cuotas_cliente SET estado='CONFIRMADA' WHERE id=$1`,
        [cuota_cliente_id]
      );
    }

    // Actualizar estado de reserva
    await reservasService.actualizarEstadoReserva(reserva_id);

    // Auditoría
    await ejecutarConReintento(
      `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id)
       VALUES ('pago_cliente',$1,'CONFIRM',$2)`,
      [pagoId, usuarioId]
    );

    return { success: true };
  }

  /**
   * Genera un recibo PDF para un pago confirmado
   */
  async generarReciboPDF(pagoId) {
    // Obtener datos del pago y reserva
    const qPago = `
      SELECT pc.*,
             r.destino,
             r.check_in,
             r.check_out,
             r.metodo_pago,
             c.nombre AS cliente_nombre,
             c.numero_telefono AS cliente_telefono,
             c.email AS cliente_email,
             u.nombre_usuario AS vendedor_nombre,
             cc.numero AS cuota_numero
      FROM pagos_clientes pc
      LEFT JOIN reservas r ON r.id = pc.reserva_id
      LEFT JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN usuarios u ON u.id = r.vendedor_id
      LEFT JOIN cuotas_cliente cc ON cc.id = pc.cuota_cliente_id
      WHERE pc.id = $1
    `;
    const resPago = await ejecutarConReintento(qPago, [pagoId]);
    if (!resPago.rows.length) throw new Error('Pago no encontrado');

    const pago = resPago.rows[0];

    // Calcular saldo restante
    const reserva = await reservasService.getReserva(pago.reserva_id);
    const saldoRestante = reserva.totales.saldo_cliente;

    // Generar PDF
    const pdfPath = path.join(__dirname, '../../uploads', `recibo_${pagoId}.pdf`);
    const doc = new PDFDocument({ size: 'letter', margin: 50 });

    doc.pipe(fs.createWriteStream(pdfPath));

    // Header
    doc.fontSize(20).text('IZLAND TOURS', { align: 'center' });
    doc.fontSize(14).text(`RECIBO DE PAGO #${pagoId}`, { align: 'center' });
    doc.moveDown();

    // Detalles
    doc.fontSize(10);
    doc.text(`Cliente: ${pago.cliente_nombre}`, { continued: false });
    doc.text(`Tel\u00e9fono: ${pago.cliente_telefono || 'N/A'}`);
    if (pago.cliente_email) doc.text(`Email: ${pago.cliente_email}`);
    doc.text(`Reserva: #${pago.reserva_id}`);
    doc.text(`Vendedor: ${pago.vendedor_nombre || 'N/A'}`);
    doc.moveDown();

    doc.text(`Destino: ${pago.destino}`);
    if (pago.check_in) doc.text(`Check-in: ${pago.check_in}`);
    if (pago.check_out) doc.text(`Check-out: ${pago.check_out}`);
    doc.moveDown();

    doc.text(`Fecha de pago: ${new Date(pago.confirmado_at).toLocaleString('es-MX')}`);
    doc.text(`M\u00e9todo de pago: ${pago.metodo_pago}`);
    doc.text(`Concepto: Abono a plan de pagos${pago.cuota_numero ? ` (Cuota ${pago.cuota_numero})` : ''}`);
    doc.moveDown();

    // Montos
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`Monto pagado: $${Number(pago.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`);
    doc.text(`Saldo restante: $${saldoRestante.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`);
    doc.moveDown();

    // Footer
    doc.fontSize(10).font('Helvetica');
    doc.text('Gracias por tu preferencia', { align: 'center' });
    doc.text('Contacto: contacto@izlandtours.com | Tel: (123) 456-7890', { align: 'center' });

    doc.end();

    return pdfPath;
  }

  /**
   * Rechaza un pago del cliente
   */
  async rechazarPagoCliente(pagoId, usuarioId, motivo) {
    await ejecutarConReintento(
      `UPDATE pagos_clientes SET estado='RECHAZADO' WHERE id=$1`,
      [pagoId]
    );

    await ejecutarConReintento(
      `INSERT INTO auditoria (entidad, entidad_id, accion, usuario_id, detalle)
       VALUES ('pago_cliente',$1,'REJECT',$2,$3)`,
      [pagoId, usuarioId, JSON.stringify({ motivo })]
    );

    return { success: true };
  }

  /**
   * Listar pagos pendientes de confirmación
   */
  async listarPagosPendientes(filtros = {}) {
    const { reserva_id, vendedor_id, limit = 50 } = filtros;

    const where = ["pc.estado='PENDIENTE'"];
    const params = [];

    if (reserva_id) {
      params.push(reserva_id);
      where.push(`pc.reserva_id = $${params.length}`);
    }
    if (vendedor_id) {
      params.push(vendedor_id);
      where.push(`r.vendedor_id = $${params.length}`);
    }

    params.push(limit);

    const q = `
      SELECT pc.*,
             r.destino,
             c.nombre AS cliente_nombre,
             c.numero_telefono AS cliente_telefono,
             u.nombre_usuario AS vendedor_nombre,
             cc.numero AS cuota_numero
      FROM pagos_clientes pc
      LEFT JOIN reservas r ON r.id = pc.reserva_id
      LEFT JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN usuarios u ON u.id = r.vendedor_id
      LEFT JOIN cuotas_cliente cc ON cc.id = pc.cuota_cliente_id
      WHERE ${where.join(' AND ')}
      ORDER BY pc.created_at DESC
      LIMIT $${params.length}
    `;

    const res = await ejecutarConReintento(q, params);
    return res.rows;
  }

  /**
   * Marcar cuotas vencidas (job diario)
   */
  async marcarCuotasVencidas() {
    const q = `
      UPDATE cuotas_cliente
      SET estado='VENCIDA'
      WHERE estado='PENDIENTE'
        AND fecha_limite < CURRENT_DATE
    `;
    const res = await ejecutarConReintento(q);
    return res.rowCount;
  }

  /**
   * Obtener cuotas próximas a vencer para recordatorios
   */
  async getCuotasProximasVencer(dias = 2) {
    const q = `
      SELECT cc.*,
             r.id AS reserva_id,
             r.destino,
             c.nombre AS cliente_nombre,
             c.numero_telefono AS cliente_telefono,
             u.nombre_usuario AS vendedor_nombre
      FROM cuotas_cliente cc
      JOIN planes_pago_cliente p ON p.id = cc.plan_id
      JOIN reservas r ON r.id = p.reserva_id
      LEFT JOIN contactos c ON c.id = r.contacto_id
      LEFT JOIN usuarios u ON u.id = r.vendedor_id
      WHERE cc.estado='PENDIENTE'
        AND cc.fecha_limite = CURRENT_DATE + $1::integer
      ORDER BY cc.fecha_limite
    `;
    const res = await ejecutarConReintento(q, [dias]);
    return res.rows;
  }
}

module.exports = new PagosService();
