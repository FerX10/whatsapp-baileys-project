const { ejecutarConReintento } = require('../database/db');

class ScheduledMessagesHandler {
    constructor(whatsappService) {
        this.whatsappService = whatsappService;
        this.checkInterval = 60000; // 1 minuto
        this.intervalId = null;
    }

    startScheduler() {
        this.intervalId = setInterval(() => {
            this.checkAndSendScheduledMessages();
        }, this.checkInterval);

        console.log('Scheduler de mensajes programados iniciado');
    }

    stopScheduler() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async checkAndSendScheduledMessages() {
        try {
            // Verificar si WhatsApp está listo
            if (!this.whatsappService.isReady()) {
                console.log('WhatsApp no está listo, saltando verificación de mensajes programados');
                return;
            }

            const query = `
                SELECT 
                    mp.*,
                    u.nombre_usuario
                FROM mensajes_programados mp
                LEFT JOIN usuarios u ON mp.usuario_id = u.id
                WHERE 
                    mp.enviado = FALSE 
                    AND mp.fecha_envio <= CURRENT_TIMESTAMP;
            `;

            const result = await ejecutarConReintento(query);

            for (const mensaje of result.rows) {
                try {
                    // Enviar mensaje
                    await this.whatsappService.sendMessage(
                        mensaje.numero_telefono,
                        mensaje.mensaje,
                        {
                            userId: mensaje.usuario_id,
                            username: mensaje.nombre_usuario
                        }
                    );

                    // Marcar como enviado
                    await ejecutarConReintento(
                        'UPDATE mensajes_programados SET enviado = TRUE WHERE id = $1',
                        [mensaje.id]
                    );

                } catch (error) {
                    console.error(`Error al enviar mensaje programado ${mensaje.id}:`, error);
                    
                    // Registrar error
                    await ejecutarConReintento(`
                        UPDATE mensajes_programados 
                        SET error = $1, 
                            intentos = intentos + 1
                        WHERE id = $2
                    `, [error.message, mensaje.id]);
                }
            }
        } catch (error) {
            console.error('Error al procesar mensajes programados:', error);
        }
    }

    async scheduleMessage(phoneNumber, message, scheduleDate, userId, username) {
        try {
            const query = `
                INSERT INTO mensajes_programados (
                    numero_telefono,
                    mensaje,
                    fecha_envio,
                    usuario_id,
                    nombre_usuario
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;

            const result = await ejecutarConReintento(
                query,
                [phoneNumber, message, scheduleDate, userId, username]
            );

            return result.rows[0];
        } catch (error) {
            console.error('Error al programar mensaje:', error);
            throw error;
        }
    }

    async cancelScheduledMessage(messageId, userId) {
        try {
            const query = `
                DELETE FROM mensajes_programados 
                WHERE id = $1 
                AND usuario_id = $2
                RETURNING *;
            `;

            const result = await ejecutarConReintento(query, [messageId, userId]);

            if (result.rows.length === 0) {
                throw new Error('Mensaje programado no encontrado o no autorizado');
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error al cancelar mensaje programado:', error);
            throw error;
        }
    }

    async getScheduledMessages(phoneNumber) {
        try {
            const query = `
                SELECT * FROM mensajes_programados 
                WHERE numero_telefono = $1 
                AND enviado = FALSE
                ORDER BY fecha_envio ASC;
            `;

            const result = await ejecutarConReintento(query, [phoneNumber]);
            return result.rows;
        } catch (error) {
            console.error('Error al obtener mensajes programados:', error);
            throw error;
        }
    }

    async cleanupOldMessages(daysToKeep = 30) {
        try {
            await ejecutarConReintento(`
                DELETE FROM mensajes_programados 
                WHERE 
                    enviado = TRUE 
                    AND fecha_envio < NOW() - INTERVAL '${daysToKeep} days';
            `);
        } catch (error) {
            console.error('Error al limpiar mensajes programados antiguos:', error);
        }
    }
}

module.exports = ScheduledMessagesHandler;