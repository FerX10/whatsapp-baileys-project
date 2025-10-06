const { ejecutarConReintento } = require('../database/db');

class WhatsAppSessionHandler {
    constructor() {
        this.currentSession = null;
    }

    async saveSession(sessionData) {
        try {
            // Convertir el estado de autenticación de Baileys a formato almacenable
            const processedData = {
                creds: sessionData.creds,
                keys: sessionData.keys
            };

            const query = `
                INSERT INTO whatsapp_sessions (session_data, activa)
                VALUES ($1, true)
                RETURNING id;
            `;
            
            const result = await ejecutarConReintento(query, [processedData]);
            console.log('Sesión guardada con ID:', result.rows[0].id);
            
            // Desactivar sesiones anteriores
            await ejecutarConReintento(`
                UPDATE whatsapp_sessions 
                SET activa = false 
                WHERE id != $1
            `, [result.rows[0].id]);

            return result.rows[0].id;
        } catch (error) {
            console.error('Error al guardar sesión:', error);
            throw error;
        }
    }

    async loadSession() {
        try {
            const query = `
                SELECT session_data 
                FROM whatsapp_sessions 
                WHERE activa = true 
                ORDER BY fecha_actualizacion DESC 
                LIMIT 1;
            `;
            
            const result = await ejecutarConReintento(query);
            
            if (result.rows.length > 0) {
                // Reconstruir el estado de autenticación para Baileys
                const storedData = result.rows[0].session_data;
                this.currentSession = {
                    creds: storedData.creds,
                    keys: storedData.keys
                };
                console.log('Sesión cargada correctamente');
                return this.currentSession;
            }
            
            console.log('No se encontró sesión activa');
            return null;
        } catch (error) {
            console.error('Error al cargar sesión:', error);
            throw error;
        }
    }

    async updateSession(sessionId, sessionData) {
        try {
            const query = `
                UPDATE whatsapp_sessions 
                SET 
                    session_data = $2,
                    fecha_actualizacion = CURRENT_TIMESTAMP
                WHERE id = $1;
            `;
            
            await ejecutarConReintento(query, [sessionId, sessionData]);
            console.log('Sesión actualizada correctamente');
        } catch (error) {
            console.error('Error al actualizar sesión:', error);
            throw error;
        }
    }

    async deleteSession(sessionId) {
        try {
            const query = `
                UPDATE whatsapp_sessions 
                SET activa = false 
                WHERE id = $1;
            `;
            
            await ejecutarConReintento(query, [sessionId]);
            console.log('Sesión desactivada correctamente');
        } catch (error) {
            console.error('Error al desactivar sesión:', error);
            throw error;
        }
    }

    async cleanOldSessions(daysToKeep = 7) {
        try {
            const query = `
                DELETE FROM whatsapp_sessions 
                WHERE 
                    activa = false 
                    AND fecha_actualizacion < NOW() - INTERVAL '${daysToKeep} days';
            `;
            
            await ejecutarConReintento(query);
            console.log('Sesiones antiguas limpiadas correctamente');
        } catch (error) {
            console.error('Error al limpiar sesiones antiguas:', error);
            throw error;
        }
    }s
}

module.exports = WhatsAppSessionHandler;