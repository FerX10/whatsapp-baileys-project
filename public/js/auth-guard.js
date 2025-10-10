/**
 * Auth Guard - Protege las páginas verificando el token de autenticación
 * Redirige automáticamente a /login.html cuando el token expira o no existe
 */

(function() {
    'use strict';

    // Verificar si estamos en la página de login (no necesita protección)
    if (window.location.pathname === '/login.html') {
        return;
    }

    /**
     * Verifica si el token existe y es válido
     */
    function checkAuth() {
        const token = sessionStorage.getItem('token');

        if (!token) {
            redirectToLogin('Token no encontrado');
            return false;
        }

        // Verificar si el token está expirado (decodificar JWT)
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expirationTime = payload.exp * 1000; // Convertir a milisegundos
            const currentTime = Date.now();

            if (currentTime >= expirationTime) {
                redirectToLogin('Token expirado');
                return false;
            }
        } catch (error) {
            console.error('Error al verificar el token:', error);
            redirectToLogin('Token inválido');
            return false;
        }

        return true;
    }

    /**
     * Redirige a la página de login limpiando la sesión
     */
    function redirectToLogin(reason) {
        console.log('Redirigiendo a login:', reason);

        // Limpiar el sessionStorage
        sessionStorage.clear();

        // Redirigir a login
        window.location.href = '/login.html';
    }

    /**
     * Intercepta las respuestas fetch para detectar errores 401 (No autorizado)
     */
    function setupFetchInterceptor() {
        const originalFetch = window.fetch;

        window.fetch = function(...args) {
            return originalFetch.apply(this, args)
                .then(response => {
                    // Si recibimos un 401, redirigir a login
                    if (response.status === 401) {
                        redirectToLogin('Sesión expirada (401)');
                        return Promise.reject(new Error('Unauthorized'));
                    }
                    return response;
                })
                .catch(error => {
                    // Si el error es de autenticación, redirigir
                    if (error.message === 'Unauthorized') {
                        redirectToLogin('Error de autenticación');
                    }
                    throw error;
                });
        };
    }

    /**
     * Verifica periódicamente si el token sigue siendo válido
     */
    function startTokenValidation() {
        // Verificar cada 30 segundos
        setInterval(() => {
            checkAuth();
        }, 30000);
    }

    // Ejecutar la verificación inicial al cargar la página
    if (!checkAuth()) {
        return; // Si no está autenticado, ya se redirigió
    }

    // Configurar el interceptor de fetch
    setupFetchInterceptor();

    // Iniciar la validación periódica del token
    startTokenValidation();

    console.log('Auth Guard activado - Token válido');
})();
