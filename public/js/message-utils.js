// message-utils.js
const { ejecutarConReintento } = require('./database');
const { processMessageWithOpenAI } = require('./openai-handler');

class MessageUtils {
    constructor(whatsappService) {
        this.whatsappService = whatsappService;
    }

    async handleIncomingMessage(message) {
        try {
            const {
                from,
                body: messageText,
                hasMedia,
                mediaUrl,
                mediaType,
                timestamp
            } = message;

            // Guardar mensaje en la base de datos
            const savedMessage = await this.saveIncomingMessage(
                from,
                messageText,
                hasMedia ? mediaType : null,
                mediaUrl
            );

            // Verificar y procesar con el asistente si está activo
            await this.checkAndProcessAssistant(from, messageText);

            return savedMessage;
        } catch (error) {
            console.error('Error procesando mensaje entrante:', error);
            throw error;
        }
    }

    async saveIncomingMessage(from, message, mediaType = null, mediaUrl = null) {
        const query = `
            INSERT INTO mensajes (
                numero_telefono,
                mensaje,
                tipo_remitente,
                fecha_hora,
                tipo_contenido,
                url_archivo,
                estado
            ) VALUES ($1, $2, 'received', CURRENT_TIMESTAMP, $3, $4, 'received')
            RETURNING *;
        `;

        const result = await ejecutarConReintento(
            query,
            [from, message, mediaType, mediaUrl]
        );

        return result.rows[0];
    }

    async checkAndProcessAssistant(phoneNumber, message) {
        try {
            // Verificar si el asistente está activo para este número
            const assignmentQuery = `
                SELECT asistente_activo 
                FROM chat_assignments 
                WHERE numero_telefono = $1;
            `;
            
            const result = await ejecutarConReintento(assignmentQuery, [phoneNumber]);
            
            if (result.rows.length > 0 && result.rows[0].asistente_activo) {
                // Procesar con OpenAI
                const aiResponse = await processMessageWithOpenAI(phoneNumber, message);
                
                if (aiResponse && aiResponse.trim()) {
                    // Enviar respuesta
                    await this.whatsappService.sendMessage(phoneNumber, aiResponse, {
                        username: 'Assistant',
                        userId: 1, // ID especial para el asistente
                        isAssistant: true
                    });

                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('Error al procesar con asistente:', error);
            return false;
        }
    }

    async updateMessageStatus(messageId, status, error = null) {
        const query = `
            UPDATE mensajes 
            SET estado = $1,
                fecha_actualizacion = CURRENT_TIMESTAMP,
                ultimo_error = $2
            WHERE id = $3
            RETURNING *;
        `;

        const result = await ejecutarConReintento(
            query,
            [status, error, messageId]
        );

        return result.rows[0];
    }

    async getMessageStatus(messageId) {
        const query = `
            SELECT estado, intentos, ultimo_error, fecha_actualizacion
            FROM mensajes
            WHERE id = $1;
        `;

        const result = await ejecutarConReintento(query, [messageId]);
        return result.rows[0];
    }

    async getUndeliveredMessages(limit = 100) {
        const query = `
            SELECT *
            FROM mensajes
            WHERE estado IN ('pending', 'retry')
            AND intentos < 3
            ORDER BY fecha_hora ASC
            LIMIT $1;
        `;

        const result = await ejecutarConReintento(query, [limit]);
        return result.rows;
    }

    // Función para limpiar mensajes antiguos
    async cleanupOldMessages(daysToKeep = 30) {
        const query = `
            DELETE FROM mensajes
            WHERE fecha_hora < NOW() - INTERVAL '${daysToKeep} days'
            AND estado IN ('sent', 'failed');
        `;

        await ejecutarConReintento(query);
    }
}

module.exports = MessageUtils;