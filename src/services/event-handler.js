const { ejecutarConReintento } = require('../database/db');

class EventHandler {
    constructor(io) {
        this.io = io;
        this.connectedClients = new Map();
    }

    initialize() {
        this.io.on('connection', (socket) => {
            console.log('Cliente conectado:', socket.id);

            // Manejar typing
            socket.on('typing', (data) => {
                this.handleTyping(socket, data);
            });

            socket.on('stopTyping', (data) => {
                this.handleStopTyping(socket, data);
            });

            // Manejar asignación de chat
            socket.on('chatAssignment', (data) => {
                this.handleChatAssignment(socket, data);
            });

            // Manejar desconexión
            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }

    async handleTyping(socket, data) {
        try {
            const { phoneNumber } = data;
            
            // Emitir a todos excepto al remitente
            socket.broadcast.emit('userTyping', {
                phoneNumber,
                socketId: socket.id
            });

            // Registrar actividad
            await this.logActivity(phoneNumber, 'typing');
        } catch (error) {
            console.error('Error en handleTyping:', error);
        }
    }

    async handleStopTyping(socket, data) {
        try {
            const { phoneNumber } = data;
            
            socket.broadcast.emit('userStoppedTyping', {
                phoneNumber,
                socketId: socket.id
            });

            await this.logActivity(phoneNumber, 'stop_typing');
        } catch (error) {
            console.error('Error en handleStopTyping:', error);
        }
    }

    async handleChatAssignment(socket, data) {
        try {
            const { phoneNumber, userId } = data;
            
            // Actualizar asignación en la base de datos
            const query = `
                INSERT INTO chat_assignments (numero_telefono, usuario_id)
                VALUES ($1, $2)
                ON CONFLICT (numero_telefono) 
                DO UPDATE SET usuario_id = EXCLUDED.usuario_id
                RETURNING *;
            `;
            
            const result = await ejecutarConReintento(query, [phoneNumber, userId]);
            
            // Notificar a todos los clientes
            this.io.emit('chatAssignmentUpdated', {
                phoneNumber,
                userId,
                assignment: result.rows[0]
            });
        } catch (error) {
            console.error('Error en handleChatAssignment:', error);
        }
    }

    handleDisconnect(socket) {
        console.log('Cliente desconectado:', socket.id);
        // Limpiar recursos si es necesario
        this.connectedClients.delete(socket.id);
    }

    async logActivity(phoneNumber, activity) {
        try {
            const query = `
                INSERT INTO chat_activity_log (
                    numero_telefono,
                    tipo_actividad,
                    fecha_hora
                ) VALUES ($1, $2, CURRENT_TIMESTAMP);
            `;
            
            await ejecutarConReintento(query, [phoneNumber, activity]);
        } catch (error) {
            console.error('Error al registrar actividad:', error);
        }
    }

    // Métodos para emitir eventos específicos
    emitNewMessage(message) {
        this.io.emit('newMessage', message);
    }

    emitMessageStatus(status) {
        this.io.emit('messageStatus', status);
    }

    emitChatUpdated(chatData) {
        this.io.emit('chatUpdated', chatData);
    }

    emitWhatsAppStatus(status) {
        this.io.emit('whatsappStatus', status);
    }
}

module.exports = EventHandler;