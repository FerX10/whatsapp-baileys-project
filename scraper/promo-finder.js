const { scrapNaturLeon } = require('./naturleon-scraper');
const fs = require('fs');
const path = require('path');

/**
 * CONFIGURACIÓN ACTUALIZADA - AHORA PERSONALIZABLE
 */
const CONFIG_PROMOCIONES = {
    // Configuración PREDETERMINADA de pasajeros (se puede override)
    adultosPredeterminados: 2,
    menoresPredeterminados: {
        cantidad: 1,
        edades: [12] // Edades predeterminadas
    },
    
    // Límites de validación
    limites: {
        maxAdultos: 8,
        minAdultos: 1,
        maxMenores: 4,
        minEdadMenor: 0,
        maxEdadMenor: 17
    },
    
    habitaciones: 1,
    origen: 'León (Natursala Hidalgo)',
    conTransporte: true,
    plan: 'todoincluido',
    destinosDisponibles: ['Puerto Vallarta', 'Ixtapa'],
    
    promocionesObjetivo: [
        'garantía naturcharter',
        'garantia naturcharter',
        'desayuno a la llegada',
        'entrega anticipada de la habitación',
        'entrega anticipada de la habitacion',
        'habitación anticipada',
        'habitacion anticipada',
        'check-in temprano',
        'menores gratis',
        'menor gratis',
        'menores 2x1',
        'menor 2x1',
        'transporte gratis',
        'upgrade gratuito',
        'late checkout',
        'check-out tardío',
        'noches gratis',
        'noche gratis'
    ],

    maxSemanas: 4,
    maxReintentos: 3,
    pausaEntreReintentos: 3000,
    pausaEntreBusquedas: 2000,
    timeoutBusqueda: 60000,

    limitesPorDefecto: {
        maxPromociones: 5,
        maxOpcionesBaratas: 5,
        maxResultadosPorSemana: 10
    },

    // TOLERANCIAS ACTUALIZADAS - SIN UMBRAL DE "MENOR GRATIS"
    tolerancias: {
        // Correlación de hoteles
        puntuacionMinimaCorrelacion: 0.85, // 85% de confianza mínima (más estricto)
        pesoTitulo: 0.40,
        pesoHabitacion: 0.35, // AUMENTADO - más importante
        pesoPromocion: 0.15,
        pesoPrecio: 0.10, // REDUCIDO - menos importante que habitación
        
        // Validación de precios
        precioMaximoPorcentualDiferencia: 0.30, // 30% máximo de diferencia (más estricto)
        precioMinimoValido: 1000,
        longitudMinimaTexto: 3,
        
        // ELIMINADO: diferenciaMinimaMenorGratis
        // Ahora NUNCA asumimos "menor gratis" automáticamente
    },

    logging: {
        nivelDetalle: 'completo',
        mostrarCorrelaciones: true,
        mostrarRechazados: true
    }
};

/**
 * NUEVA FUNCIÓN: Validar configuración personalizada de pasajeros
 */
function validarConfiguracionPasajeros(config) {
    const adultos = config.adultos || CONFIG_PROMOCIONES.adultosPredeterminados;
    const menores = config.menores || CONFIG_PROMOCIONES.menoresPredeterminados;
    
    // Validar adultos
    if (!Number.isInteger(adultos) || adultos < CONFIG_PROMOCIONES.limites.minAdultos || adultos > CONFIG_PROMOCIONES.limites.maxAdultos) {
        throw new Error(`Número de adultos inválido: ${adultos}. Debe estar entre ${CONFIG_PROMOCIONES.limites.minAdultos} y ${CONFIG_PROMOCIONES.limites.maxAdultos}.`);
    }
    
    // Validar estructura de menores
    if (!menores || typeof menores !== 'object') {
        throw new Error('Configuración de menores inválida');
    }
    
    const cantidadMenores = menores.cantidad || 0;
    const edadesMenores = menores.edades || [];
    
    // Validar cantidad
    if (!Number.isInteger(cantidadMenores) || cantidadMenores < 0 || cantidadMenores > CONFIG_PROMOCIONES.limites.maxMenores) {
        throw new Error(`Cantidad de menores inválida: ${cantidadMenores}. Debe estar entre 0 y ${CONFIG_PROMOCIONES.limites.maxMenores}.`);
    }
    
    // Validar que las edades coincidan con la cantidad
    if (cantidadMenores > 0 && edadesMenores.length !== cantidadMenores) {
        throw new Error(`Número de edades (${edadesMenores.length}) no coincide con cantidad de menores (${cantidadMenores})`);
    }
    
    // Validar cada edad
    edadesMenores.forEach((edad, index) => {
        if (!Number.isInteger(edad) || edad < CONFIG_PROMOCIONES.limites.minEdadMenor || edad > CONFIG_PROMOCIONES.limites.maxEdadMenor) {
            throw new Error(`Edad del menor ${index + 1} inválida: ${edad}. Debe estar entre ${CONFIG_PROMOCIONES.limites.minEdadMenor} y ${CONFIG_PROMOCIONES.limites.maxEdadMenor} años.`);
        }
    });
    
    // AVISO ESPECIAL: Si hay 4 menores
    if (cantidadMenores === 4) {
        log('advertencia', '⚠️ RECOMENDACIÓN: Con 4 menores, es preferible hacer 2 cotizaciones separadas (2 adultos + 2 menores cada una) para obtener precios más precisos.');
    }
    
    return {
        adultos,
        menores: {
            cantidad: cantidadMenores,
            edades: edadesMenores
        },
        valido: true
    };
}

/**
 * Utility function para logging robusto
 */
function log(nivel, mensaje, datos = null) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const prefijos = {
        info: '📋',
        exito: '✅',
        error: '❌',
        advertencia: '⚠️',
        debug: '🔍',
        correlacion: '🔗',
        promocion: '🎁',
        precio: '💰'
    };

    const prefijo = prefijos[nivel] || '📋';
    console.log(`[${timestamp}] ${prefijo} ${mensaje}`);
    
    if (datos && CONFIG_PROMOCIONES.logging.nivelDetalle === 'debug') {
        console.log('   📊 Datos:', JSON.stringify(datos, null, 2));
    }
}

// [Mantener las funciones anteriores: generarFechasJuevesADomingo, getNombreMes, formatearFecha, extraerPrecioNumerico]
// ... (código anterior sin cambios)

function generarFechasJuevesADomingo(opciones = {}) {
    try {
        const numSemanas = opciones.semanas || CONFIG_PROMOCIONES.maxSemanas;
        const mesInicio = opciones.mes;
        const anioInicio = opciones.anio;
        const fechas = [];

        if (numSemanas < 1 || numSemanas > 52) {
            throw new Error(`Número de semanas inválido: ${numSemanas}. Debe estar entre 1 y 52.`);
        }

        if (mesInicio && (mesInicio < 1 || mesInicio > 12)) {
            throw new Error(`Mes inválido: ${mesInicio}. Debe estar entre 1 y 12.`);
        }

        if (anioInicio && anioInicio < 2025) {
            throw new Error(`Año inválido: ${anioInicio}. Debe ser 2025 o posterior.`);
        }

        let fechaBase;

        if (mesInicio && anioInicio) {
            log('info', `Generando fechas para ${getNombreMes(mesInicio)} ${anioInicio}...`);
            fechaBase = new Date(anioInicio, mesInicio - 1, 1);
            
            const hoy = new Date();
            if (fechaBase < hoy) {
                log('advertencia', `La fecha especificada está en el pasado. Se ajustará automáticamente.`);
            }
        } else {
            log('info', 'Generando fechas desde hoy...');
            fechaBase = new Date();
        }

        let proximoJueves;
        if (mesInicio && anioInicio) {
            proximoJueves = new Date(fechaBase);
            while (proximoJueves.getDay() !== 4) {
                proximoJueves.setDate(proximoJueves.getDate() + 1);
            }
        } else {
            const diasHastaJueves = (4 - fechaBase.getDay() + 7) % 7;
            proximoJueves = new Date(fechaBase);
            proximoJueves.setDate(fechaBase.getDate() + (diasHastaJueves || 7));
        }

        for (let i = 0; i < numSemanas; i++) {
            const jueves = new Date(proximoJueves);
            jueves.setDate(proximoJueves.getDate() + (i * 7));

            const domingo = new Date(jueves);
            domingo.setDate(jueves.getDate() + 3);

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            
            if (domingo < hoy) {
                log('advertencia', `Saltando semana en el pasado: ${formatearFecha(jueves)} - ${formatearFecha(domingo)}`);
                continue;
            }

            const fechaSemana = {
                inicio: formatearFecha(jueves),
                fin: formatearFecha(domingo),
                semana: i + 1,
                descripcionCorta: `${jueves.getDate()} ${getNombreMes(jueves.getMonth() + 1).substring(0, 3).toLowerCase()} - ${domingo.getDate()} ${getNombreMes(domingo.getMonth() + 1).substring(0, 3).toLowerCase()}`,
                descripcion: `Semana ${i + 1}: ${formatearFecha(jueves)} a ${formatearFecha(domingo)}`,
                mes: jueves.getMonth() + 1,
                anio: jueves.getFullYear(),
                diasHasta: Math.ceil((jueves - hoy) / (1000 * 60 * 60 * 24))
            };

            fechas.push(fechaSemana);
        }

        if (fechas.length === 0) {
            throw new Error('No se pudieron generar fechas válidas en el futuro.');
        }

        log('exito', `Generadas ${fechas.length} semanas de fechas válidas`);
        return fechas;

    } catch (error) {
        log('error', `Error al generar fechas: ${error.message}`);
        throw error;
    }
}

function getNombreMes(numeroMes) {
    const meses = [
        'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    if (numeroMes < 1 || numeroMes > 12) {
        throw new Error(`Número de mes inválido: ${numeroMes}`);
    }
    
    return meses[numeroMes - 1];
}

function formatearFecha(fecha) {
    if (!(fecha instanceof Date) || isNaN(fecha)) {
        throw new Error('Fecha inválida proporcionada para formatear');
    }
    
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extraerPrecioNumerico(precioTexto) {
    try {
        if (!precioTexto) return null;

        const precioStr = String(precioTexto);
        const numeroLimpio = precioStr.replace(/[^\d,\.]/g, '');

        if (!numeroLimpio) return null;

        let numero;
        if (numeroLimpio.includes(',') && numeroLimpio.includes('.')) {
            numero = parseFloat(numeroLimpio.replace(/,/g, ''));
        } else if (numeroLimpio.includes(',')) {
            const partes = numeroLimpio.split(',');
            if (partes.length === 2 && partes[1].length <= 2) {
                numero = parseFloat(numeroLimpio.replace(',', '.'));
            } else {
                numero = parseFloat(numeroLimpio.replace(/,/g, ''));
            }
        } else {
            numero = parseFloat(numeroLimpio);
        }

        if (!Number.isFinite(numero) || numero <= 0) {
            return null;
        }

        if (numero < 100 || numero > 1000000) {
            log('advertencia', `Precio fuera de rango esperado: ${numero}`);
            return null;
        }

        return Math.round(numero);

    } catch (error) {
        log('error', `Error al extraer precio de "${precioTexto}": ${error.message}`);
        return null;
    }
}

/**
 * FUNCIÓN ACTUALIZADA: Búsqueda con configuración personalizada de pasajeros
 */
async function realizarBusquedaConReintentos(destino, fechas, configPasajeros, conMenor = false) {
    const adultos = configPasajeros.adultos;
    const menores = conMenor ? configPasajeros.menores : { cantidad: 0, edades: [] };
    
    const tipoPersonas = conMenor ? 
        `${adultos} adultos + ${menores.cantidad} menor(es) (${menores.edades.join(', ')} años)` : 
        `${adultos} adultos`;

    const parametrosBusqueda = {
        destino: destino,
        fechaInicio: fechas.inicio,
        fechaFin: fechas.fin,
        adultos: adultos,
        ninos: menores.cantidad,
        edadesMenores: menores.edades,
        habitaciones: CONFIG_PROMOCIONES.habitaciones,
        plan: CONFIG_PROMOCIONES.plan,
        conTransporte: CONFIG_PROMOCIONES.conTransporte,
        origen: CONFIG_PROMOCIONES.origen,
        ajustarFechasTransporte: true,
        headless: false,
        timeout: CONFIG_PROMOCIONES.timeoutBusqueda,
        guardarResultados: false,
        tomarCaptura: false
    };

    log('info', `Buscando: ${tipoPersonas} en ${destino}`);

    let ultimoError = null;
    let mejorResultado = null;

    for (let intento = 1; intento <= CONFIG_PROMOCIONES.maxReintentos; intento++) {
        try {
            log('info', `Intento ${intento}/${CONFIG_PROMOCIONES.maxReintentos}...`);

            const resultado = await scrapNaturLeon(parametrosBusqueda);

            if (resultado && resultado.exito && resultado.resultados && Array.isArray(resultado.resultados)) {
                const hotelesValidos = resultado.resultados.filter(hotel => esHotelValido(hotel));

                if (hotelesValidos.length > 0) {
                    log('exito', `${hotelesValidos.length} hoteles válidos encontrados`);
                    return hotelesValidos;
                } else {
                    log('advertencia', `${resultado.resultados.length} hoteles encontrados pero ninguno válido`);
                    if (CONFIG_PROMOCIONES.logging.mostrarRechazados) {
                        resultado.resultados.forEach((hotel, index) => {
                            const razon = obtenerRazonRechazo(hotel);
                            log('debug', `Hotel ${index + 1} rechazado: "${hotel.titulo}" - ${razon}`);
                        });
                    }
                    ultimoError = new Error('Hoteles encontrados pero ninguno válido');
                }
            } else {
                const mensajeError = resultado?.error || 'Resultado inválido o sin hoteles';
                log('advertencia', `Sin resultados en intento ${intento}: ${mensajeError}`);
                ultimoError = new Error(`Sin resultados: ${mensajeError}`);
                
                if (resultado && resultado.resultados && resultado.resultados.length > mejorResultado?.resultados?.length) {
                    mejorResultado = resultado;
                }
            }

        } catch (error) {
            log('error', `ERROR en intento ${intento}: ${error.message}`);
            ultimoError = error;
        }

        if (intento < CONFIG_PROMOCIONES.maxReintentos) {
            const tiempoEspera = CONFIG_PROMOCIONES.pausaEntreReintentos;
            log('info', `Esperando ${tiempoEspera / 1000}s antes del siguiente intento...`);
            await new Promise(resolve => setTimeout(resolve, tiempoEspera));
        }
    }

    if (mejorResultado && mejorResultado.resultados && mejorResultado.resultados.length > 0) {
        const hotelesValidos = mejorResultado.resultados.filter(hotel => esHotelValido(hotel));
        if (hotelesValidos.length > 0) {
            log('advertencia', `Usando resultado parcial: ${hotelesValidos.length} hoteles válidos de resultado con errores`);
            return hotelesValidos;
        }
    }

    log('error', `FALLO TOTAL: No se pudieron obtener resultados después de ${CONFIG_PROMOCIONES.maxReintentos} intentos`);
    throw ultimoError || new Error('Falló después de múltiples intentos sin error específico');
}

function obtenerRazonRechazo(hotel) {
    if (!hotel) return 'Hotel nulo o indefinido';
    
    const titulosInvalidos = [
        'alojamiento', 'no hay reservaciones', 'no hay resultados', 
        'error', 'cargando', 'loading', 'no se encontraron'
    ];

    const tituloLower = (hotel.titulo || '').toLowerCase().trim();
    
    const tituloInvalido = titulosInvalidos.find(invalido => tituloLower.includes(invalido));
    if (tituloInvalido) {
        return `Título contiene palabra inválida: "${tituloInvalido}"`;
    }
    
    const precio = extraerPrecioNumerico(hotel.precio);
    if (!precio) {
        return `Precio inválido: "${hotel.precio}"`;
    }
    
    if (precio < CONFIG_PROMOCIONES.tolerancias.precioMinimoValido) {
        return `Precio muy bajo: $${precio} (mínimo: $${CONFIG_PROMOCIONES.tolerancias.precioMinimoValido})`;
    }
    
    if (tituloLower === '' || tituloLower.length < CONFIG_PROMOCIONES.tolerancias.longitudMinimaTexto) {
        return `Título muy corto: "${tituloLower}"`;
    }
    
    return 'Razón desconocida';
}

function esHotelValido(hotel) {
    try {
        if (!hotel) return false;

        const titulosInvalidos = [
            'alojamiento', 'no hay reservaciones', 'no hay resultados', 
            'error', 'cargando', 'loading', 'no se encontraron',
            'sin resultados', 'temporalmente no disponible'
        ];

        const tituloLower = (hotel.titulo || '').toLowerCase().trim();

        if (titulosInvalidos.some(invalido => tituloLower.includes(invalido))) {
            return false;
        }

        const precio = extraerPrecioNumerico(hotel.precio);
        if (!precio || precio < CONFIG_PROMOCIONES.tolerancias.precioMinimoValido) {
            return false;
        }

        if (tituloLower === '' || tituloLower.length < CONFIG_PROMOCIONES.tolerancias.longitudMinimaTexto) {
            return false;
        }

        if (!/[a-zA-Z]/.test(hotel.titulo)) {
            return false;
        }

        if (hotel.id && (hotel.id === '' || hotel.id === 'undefined' || hotel.id === 'null')) {
            return false;
        }

        return true;

    } catch (error) {
        log('error', `Error al validar hotel: ${error.message}`, hotel);
        return false;
    }
}

/**
 * FUNCIÓN MEJORADA: Correlación ROBUSTA con énfasis en HOTEL + HABITACIÓN
 */
function correlacionarHotelesExactos(hotelesAdultos, hotelesConMenor, configPasajeros) {
    const hotelesProcesados = [];
    log('correlacion', `Correlacionando ${hotelesAdultos.length} hoteles (adultos) con ${hotelesConMenor.length} hoteles (con menor)`);
    log('correlacion', `Configuración: ${configPasajeros.adultos} adultos + ${configPasajeros.menores.cantidad} menor(es)`);

    const indiceHotelesConMenor = new Map();
    hotelesConMenor.forEach((hotel, index) => {
        const clave = generarClaveCorrelacionRobusta(hotel);
        if (!indiceHotelesConMenor.has(clave)) {
            indiceHotelesConMenor.set(clave, []);
        }
        indiceHotelesConMenor.get(clave).push({ hotel, index });
    });

    for (const hotelAdulto of hotelesAdultos) {
        const claveAdulto = generarClaveCorrelacionRobusta(hotelAdulto);
        
        const candidatos = indiceHotelesConMenor.get(claveAdulto) || [];
        
        let mejorCorrelacion = null;
        let mejorPuntuacion = 0;

        for (const candidato of candidatos) {
            const puntuacion = calcularPuntuacionCorrelacionRobusta(hotelAdulto, candidato.hotel);
            if (puntuacion > mejorPuntuacion) {
                mejorPuntuacion = puntuacion;
                mejorCorrelacion = candidato.hotel;
            }
        }

        if (!mejorCorrelacion && candidatos.length === 0) {
            const resultado = buscarCorrelacionPorSimilaridadRobusta(hotelAdulto, hotelesConMenor);
            mejorCorrelacion = resultado.hotel;
            mejorPuntuacion = resultado.puntuacion;
        }

        // UMBRAL AUMENTADO: 85% mínimo de confianza
        if (mejorCorrelacion && mejorPuntuacion >= CONFIG_PROMOCIONES.tolerancias.puntuacionMinimaCorrelacion) {
            const hotelProcesado = procesarCorrelacion(hotelAdulto, mejorCorrelacion, mejorPuntuacion, configPasajeros);
            if (hotelProcesado) {
                hotelesProcesados.push(hotelProcesado);
                
                if (CONFIG_PROMOCIONES.logging.mostrarCorrelaciones) {
                    const promedioPorMenor = hotelProcesado.precios.precioPorMenorPromedio;
                    log('correlacion', `EXACTA: "${hotelAdulto.titulo}" | Hab: "${hotelAdulto.habitacion}" - Adulto: $${hotelProcesado.precios.precioPorAdulto}, Promedio/Menor: $${promedioPorMenor} - ${hotelProcesado.tipoTarifa} (Confianza: ${Math.round(mejorPuntuacion * 100)}%)`);
                }
            }
        } else {
            if (CONFIG_PROMOCIONES.logging.mostrarRechazados) {
                log('advertencia', `Sin correlación para: "${hotelAdulto.titulo}" - Habitación: "${hotelAdulto.habitacion}" (Mejor puntuación: ${Math.round((mejorPuntuacion || 0) * 100)}% < ${Math.round(CONFIG_PROMOCIONES.tolerancias.puntuacionMinimaCorrelacion * 100)}% requerido)`);
            }
        }
    }

    log('exito', `Total hoteles correlacionados EXACTAMENTE: ${hotelesProcesados.length}`);
    return hotelesProcesados;
}

/**
 * NUEVA FUNCIÓN: Genera clave robusta HOTEL + HABITACIÓN
 */
function generarClaveCorrelacionRobusta(hotel) {
    const normalizarTexto = (texto) => {
        return (texto || '')
            .toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
            .replace(/\s+/g, ' ') // Normalizar espacios
            .replace(/[^\w\s]/g, ''); // Quitar puntuación
    };
    
    const titulo = normalizarTexto(hotel.titulo);
    const habitacion = normalizarTexto(hotel.habitacion);
    
    // Clave compuesta: título + habitación
    return `${titulo}|||${habitacion}`;
}

/**
 * NUEVA FUNCIÓN: Puntuación robusta con ÉNFASIS en HABITACIÓN
 */
function calcularPuntuacionCorrelacionRobusta(hotel1, hotel2) {
    let puntuacion = 0;
    
    const normalizarTexto = (texto) => {
        return (texto || '')
            .toLowerCase()
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s]/g, '');
    };
    
    // 1. TÍTULO (peso: 40%)
    const titulo1 = normalizarTexto(hotel1.titulo);
    const titulo2 = normalizarTexto(hotel2.titulo);
    
    if (titulo1 === titulo2) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoTitulo;
    } else if (titulo1.includes(titulo2) || titulo2.includes(titulo1)) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoTitulo * 0.7;
    } else {
        // Calcular similitud por palabras
        const palabras1 = new Set(titulo1.split(' ').filter(p => p.length > 3));
        const palabras2 = new Set(titulo2.split(' ').filter(p => p.length > 3));
        const interseccion = [...palabras1].filter(p => palabras2.has(p)).length;
        const union = new Set([...palabras1, ...palabras2]).size;
        
        if (union > 0) {
            const similitud = interseccion / union;
            puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoTitulo * similitud;
        }
    }
    
    // 2. HABITACIÓN (peso: 35%) - MÁS IMPORTANTE
    const habitacion1 = normalizarTexto(hotel1.habitacion);
    const habitacion2 = normalizarTexto(hotel2.habitacion);
    
    if (habitacion1 === habitacion2) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoHabitacion;
    } else if (habitacion1.includes(habitacion2) || habitacion2.includes(habitacion1)) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoHabitacion * 0.8;
    } else {
        // Verificar palabras clave importantes de habitación
        const palabrasClave = ['vista', 'mar', 'ocean', 'deluxe', 'junior', 'suite', 'estandar', 'standard', 'doble', 'king', 'queen'];
        let coincidenciasPalabrasClave = 0;
        
        palabrasClave.forEach(palabra => {
            if (habitacion1.includes(palabra) && habitacion2.includes(palabra)) {
                coincidenciasPalabrasClave++;
            }
        });
        
        if (coincidenciasPalabrasClave > 0) {
            const similitudPalabrasClave = coincidenciasPalabrasClave / palabrasClave.length;
            puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoHabitacion * similitudPalabrasClave * 0.6;
        }
    }
    
    // 3. PROMOCIÓN (peso: 15%)
    const promo1 = normalizarTexto(hotel1.promo);
    const promo2 = normalizarTexto(hotel2.promo);
    
    if (promo1 === promo2) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoPromocion;
    } else if (promo1 && promo2 && (promo1.includes(promo2) || promo2.includes(promo1))) {
        puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoPromocion * 0.7;
    }
    
    // 4. PRECIO (peso: 10%) - MENOS IMPORTANTE
    const precio1 = extraerPrecioNumerico(hotel1.precio);
    const precio2 = extraerPrecioNumerico(hotel2.precio);
    
    if (precio1 && precio2) {
        const diferenciaPorcentual = Math.abs(precio2 - precio1) / precio1;
        if (diferenciaPorcentual <= CONFIG_PROMOCIONES.tolerancias.precioMaximoPorcentualDiferencia) {
            puntuacion += CONFIG_PROMOCIONES.tolerancias.pesoPrecio * (1 - diferenciaPorcentual);
        }
    }
    
    return puntuacion;
}

/**
 * NUEVA FUNCIÓN: Búsqueda robusta por similitud
 */
function buscarCorrelacionPorSimilaridadRobusta(hotelAdulto, hotelesConMenor) {
    let mejorHotel = null;
    let mejorPuntuacion = 0;
    
    for (const hotel of hotelesConMenor) {
        const puntuacion = calcularPuntuacionCorrelacionRobusta(hotelAdulto, hotel);
        if (puntuacion > mejorPuntuacion) {
            mejorPuntuacion = puntuacion;
            mejorHotel = hotel;
        }
    }
    
    return { hotel: mejorHotel, puntuacion: mejorPuntuacion };
}

/**
 * FUNCIÓN ACTUALIZADA: Procesar correlación con precio promedio por menor
 */
function procesarCorrelacion(hotelAdulto, hotelConMenor, puntuacionConfianza, configPasajeros) {
    try {
        const precioSoloAdultos = extraerPrecioNumerico(hotelAdulto.precio);
        const precioConMenor = extraerPrecioNumerico(hotelConMenor.precio);

        if (!precioSoloAdultos || !precioConMenor) {
            log('error', `Precios inválidos para correlación: adultos=${precioSoloAdultos}, con menor=${precioConMenor}`);
            return null;
        }

        const diferenciaTotal = precioConMenor - precioSoloAdultos;
        const precioPorAdulto = Math.round(precioSoloAdultos / configPasajeros.adultos);
        
        // NUEVA LÓGICA: Calcular precio PROMEDIO por menor
        const cantidadMenores = configPasajeros.menores.cantidad;
        const precioPorMenorPromedio = cantidadMenores > 0 ? Math.round(diferenciaTotal / cantidadMenores) : 0;

        // Detectar tipo de tarifa
        const tipoTarifa = detectarTipoTarifa(hotelConMenor);

        return {
            ...hotelConMenor,
            precios: {
                precioSoloAdultos: precioSoloAdultos,
                precioConMenores: precioConMenor,
                precioPorAdulto: precioPorAdulto,
                precioPorMenorPromedio: precioPorMenorPromedio, // NUEVO
                diferenciaTotal: diferenciaTotal,
                cantidadMenores: cantidadMenores,
                edadesMenores: configPasajeros.menores.edades
            },
            tipoTarifa: tipoTarifa,
            correlacionExacta: true,
            confianzaCorrelacion: Math.round(puntuacionConfianza * 100)
        };

    } catch (error) {
        log('error', `Error al procesar correlación: ${error.message}`);
        return null;
    }
}

// [Mantener funciones de detección existentes]
function procesarHotelesSoloAdultos(hotelesAdultos, configPasajeros) {
    const procesados = [];

    hotelesAdultos.forEach((hotel) => {
        const precioSoloAdultos = extraerPrecioNumerico(hotel.precio);
        if (!precioSoloAdultos) {
            return;
        }

        const adultos = Math.max(configPasajeros.adultos || 1, 1);
        const precioPorAdulto = Math.round(precioSoloAdultos / adultos);

        procesados.push({
            ...hotel,
            precios: {
                precioSoloAdultos: precioSoloAdultos,
                precioConMenores: precioSoloAdultos,
                precioPorAdulto: precioPorAdulto,
                precioPorMenorPromedio: 0,
                diferenciaTotal: 0,
                cantidadMenores: 0,
                edadesMenores: configPasajeros?.menores?.edades || []
            },
            tipoTarifa: detectarTipoTarifa(hotel),
            correlacionExacta: true,
            confianzaCorrelacion: 100
        });
    });

    log('info', `Hoteles procesados sin menores: ${procesados.length}/${hotelesAdultos.length}`);
    return procesados;
}
function detectarTipoTarifa(hotel) {
    const textoCompleto = [
        hotel.titulo || '',
        hotel.detalles || '',
        hotel.habitacion || '',
        hotel.promo || '',
        JSON.stringify(hotel.incluye || [])
    ].join(' ').toLowerCase();

    const patronesNoReembolsable = [
        'no rembolsable', 'no reembolsable', 'sin reembolso', 
        'pago inmediato', 'non-refundable', 'non refundable',
        'no reembolso', 'sin devolucion', 'sin devolución'
    ];
    
    if (patronesNoReembolsable.some(patron => textoCompleto.includes(patron)) || hotel.noReembolsable === true) {
        return 'NO REEMBOLSABLE';
    }

    const patronesSolicitud = [
        'a solicitud', 'bajo solicitud', 'on request', 
        'subject to availability', 'disponibilidad limitada',
        'sujeto a disponibilidad', 'previa consulta'
    ];
    
    if (patronesSolicitud.some(patron => textoCompleto.includes(patron))) {
        return 'A SOLICITUD';
    }

    const patronesInmediato = [
        'confirmacion inmediata', 'confirmación inmediata',
        'immediate confirmation', 'garantizado', 'confirmado'
    ];
    
    if (patronesInmediato.some(patron => textoCompleto.includes(patron))) {
        return 'CONFIRMACIÓN INMEDIATA';
    }

    if (textoCompleto.includes('tarifa especial') || textoCompleto.includes('oferta limitada')) {
        return 'TARIFA ESPECIAL';
    }

    return 'ESTÁNDAR';
}

function detectarPromociones(hotel) {
    const textoCompleto = [
        hotel.titulo || '',
        hotel.detalles || '',
        hotel.habitacion || '',
        hotel.promo || '',
        JSON.stringify(hotel.incluye || []),
        JSON.stringify(hotel.beneficios || [])
    ].join(' ').toLowerCase();

    const promocionesEncontradas = new Set();

    for (const promocionBuscada of CONFIG_PROMOCIONES.promocionesObjetivo) {
        if (textoCompleto.includes(promocionBuscada.toLowerCase())) {
            let nombrePromocion = normalizarNombrePromocion(promocionBuscada);
            promocionesEncontradas.add(nombrePromocion);
        }
    }

    const promocionesAdicionales = detectarPromocionesAdicionales(textoCompleto);
    promocionesAdicionales.forEach(promo => promocionesEncontradas.add(promo));

    return Array.from(promocionesEncontradas);
}

function normalizarNombrePromocion(promocionBuscada) {
    const promocionLower = promocionBuscada.toLowerCase();
    
    if (promocionLower.includes('naturcharter')) {
        return 'Garantía NaturCharter';
    } else if (promocionLower.includes('desayuno a la llegada')) {
        return 'Desayuno a la llegada';
    } else if (promocionLower.includes('anticipada') || promocionLower.includes('check-in temprano')) {
        return 'Entrega anticipada de habitación';
    } else if (promocionLower.includes('menores gratis') || promocionLower.includes('menor gratis')) {
        return 'Menores gratis';
    } else if (promocionLower.includes('2x1')) {
        return 'Menores 2x1';
    } else if (promocionLower.includes('transporte gratis')) {
        return 'Transporte gratis';
    } else if (promocionLower.includes('upgrade')) {
        return 'Upgrade gratuito';
    } else if (promocionLower.includes('late checkout') || promocionLower.includes('check-out tardío')) {
        return 'Late checkout';
    } else if (promocionLower.includes('noche') && promocionLower.includes('gratis')) {
        return 'Noches gratis';
    }
    
    return promocionBuscada.charAt(0).toUpperCase() + promocionBuscada.slice(1).toLowerCase();
}

function detectarPromocionesAdicionales(textoCompleto) {
    const promociones = [];
    
    if (textoCompleto.includes('spa gratis') || textoCompleto.includes('spa incluido')) {
        promociones.push('Spa gratis');
    }
    
    if (textoCompleto.includes('wifi gratis') || textoCompleto.includes('wifi incluido')) {
        promociones.push('WiFi gratis');
    }
    
    if (textoCompleto.includes('shuttle gratis') || textoCompleto.includes('traslado gratis')) {
        promociones.push('Traslado gratis');
    }
    
    if (textoCompleto.includes('cena de cortesia') || textoCompleto.includes('cena gratis')) {
        promociones.push('Cena de cortesía');
    }
    
    if (textoCompleto.includes('descuento') && textoCompleto.includes('%')) {
        promociones.push('Descuento especial');
    }
    
    return promociones;
}

function detectarPromocionesConLimites(hotelesProcesados, limitesConfig = {}) {
    const limites = {
        maxPromociones: limitesConfig.maxPromociones || CONFIG_PROMOCIONES.limitesPorDefecto.maxPromociones,
        maxOpcionesBaratas: limitesConfig.maxOpcionesBaratas || CONFIG_PROMOCIONES.limitesPorDefecto.maxOpcionesBaratas,
        ...limitesConfig
    };

    log('info', `Aplicando límites: ${limites.maxPromociones} promociones + ${limites.maxOpcionesBaratas} opciones baratas`);

    const hotelesConPromociones = [];
    const hotelesNormales = [];

    for (const hotel of hotelesProcesados) {
        const promociones = detectarPromociones(hotel);

        if (promociones.length > 0) {
            hotelesConPromociones.push({
                ...hotel,
                promociones: promociones,
                puntuacionPromocion: calcularPuntuacionPromocion(hotel, promociones)
            });
        } else {
            hotelesNormales.push({
                ...hotel,
                promociones: [],
                puntuacionPromocion: 0
            });
        }
    }

    hotelesConPromociones.sort((a, b) => {
        if (a.puntuacionPromocion !== b.puntuacionPromocion) {
            return b.puntuacionPromocion - a.puntuacionPromocion;
        }
        
        if (a.promociones.length !== b.promociones.length) {
            return b.promociones.length - a.promociones.length;
        }
        
        return a.precios.precioConMenores - b.precios.precioConMenores;
    });

    hotelesNormales.sort((a, b) => {
        if (a.precios.precioConMenores !== b.precios.precioConMenores) {
            return a.precios.precioConMenores - b.precios.precioConMenores;
        }
        
        return (b.confianzaCorrelacion || 0) - (a.confianzaCorrelacion || 0);
    });

    const promocionesLimitadas = hotelesConPromociones.slice(0, limites.maxPromociones);
    const opcionesBaratasLimitadas = hotelesNormales.slice(0, limites.maxOpcionesBaratas);

    log('info', `Límites aplicados: ${promocionesLimitadas.length}/${hotelesConPromociones.length} promociones, ${opcionesBaratasLimitadas.length}/${hotelesNormales.length} opciones baratas`);

    return {
        promociones: promocionesLimitadas,
        opcionesBaratas: opcionesBaratasLimitadas,
        totalPromociones: hotelesConPromociones.length,
        totalOpcionesBaratas: hotelesNormales.length
    };
}

function calcularPuntuacionPromocion(hotel, promociones) {
    let puntuacion = 0;
    
    const valoresPromociones = {
        'Menores gratis': 100,
        'Garantía NaturCharter': 80,
        'Noches gratis': 70,
        'Upgrade gratuito': 60,
        'Desayuno a la llegada': 50,
        'Entrega anticipada de habitación': 40,
        'Late checkout': 30,
        'Traslado gratis': 25,
        'Spa gratis': 20,
        'WiFi gratis': 10
    };
    
    for (const promocion of promociones) {
        puntuacion += valoresPromociones[promocion] || 15;
    }
    
    if (promociones.length > 1) {
        puntuacion += promociones.length * 5;
    }
    
    return puntuacion;
}

/**
 * FUNCIÓN ACTUALIZADA: Búsqueda con configuración personalizada
 */
async function buscarEnDestinoYFechasLimitado(destino, fechas, limitesConfig = {}, configPasajeros = null) {
    log('info', `BUSCANDO en ${destino} para ${fechas.descripcion}`);

    // Usar configuración predeterminada si no se proporciona
    if (!configPasajeros) {
        configPasajeros = {
            adultos: CONFIG_PROMOCIONES.adultosPredeterminados,
            menores: CONFIG_PROMOCIONES.menoresPredeterminados
        };
    }

    try {
        log('info', 'PASO 1: Busqueda base (solo adultos)');
        const hotelesAdultos = await realizarBusquedaConReintentos(destino, fechas, configPasajeros, false);

        const cantidadMenores = configPasajeros?.menores?.cantidad || 0;
        let hotelesProcesados = [];

        if (cantidadMenores > 0) {
            log('info', `Configuracion con ${cantidadMenores} menor(es): ejecutando busqueda adicional`);
            log('info', `Pausa entre busquedas (${CONFIG_PROMOCIONES.pausaEntreBusquedas / 1000}s)...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG_PROMOCIONES.pausaEntreBusquedas));

            log('info', 'PASO 2: Busqueda con menores');
            const hotelesConMenor = await realizarBusquedaConReintentos(destino, fechas, configPasajeros, true);

            log('info', 'PASO 3: Correlacionando hoteles EXACTAMENTE');
            hotelesProcesados = correlacionarHotelesExactos(hotelesAdultos, hotelesConMenor, configPasajeros);
        } else {
            log('info', 'Configuracion sin menores detectada: se omite la busqueda adicional con menores');
            hotelesProcesados = procesarHotelesSoloAdultos(hotelesAdultos, configPasajeros);
        }

        if (!hotelesProcesados || hotelesProcesados.length === 0) {
            log('advertencia', `No se pudieron correlacionar hoteles para ${destino}`);
            return {
                promociones: [],
                opcionesBaratas: [],
                totalPromociones: 0,
                totalOpcionesBaratas: 0,
                sinResultados: true
            };
        }

        log('info', 'PASO 4: Detectando promociones con limites');
        const resultadosLimitados = detectarPromocionesConLimites(hotelesProcesados, limitesConfig);

        const agregarContexto = (hotel) => {
            const destinoDetectado = (hotel.destinoEspecifico && String(hotel.destinoEspecifico).trim()) ? String(hotel.destinoEspecifico).trim() : null;

            return {
                ...hotel,
                destinoSolicitado: destino,
                destinoDetallado: destinoDetectado,
                destino: destinoDetectado || destino,
                fechas: fechas
            };
        };

        const resultado = {
            promociones: resultadosLimitados.promociones.map(agregarContexto),
            opcionesBaratas: resultadosLimitados.opcionesBaratas.map(agregarContexto),
            totalPromociones: resultadosLimitados.totalPromociones,
            totalOpcionesBaratas: resultadosLimitados.totalOpcionesBaratas,
            sinResultados: false
        };

        log('exito', `Búsqueda completada: ${resultado.promociones.length} promociones, ${resultado.opcionesBaratas.length} opciones baratas`);
        return resultado;

    } catch (error) {
        log('error', `ERROR en búsqueda: ${error.message}`);
        return {
            promociones: [],
            opcionesBaratas: [],
            totalPromociones: 0,
            totalOpcionesBaratas: 0,
            sinResultados: true,
            error: error.message
        };
    }
}

/**
 * FUNCIÓN ACTUALIZADA: Reporte con información de menores personalizada
 */

function generarReporteFormateadoMejorado(promociones, opcionesBaratas, primeraFecha, configPasajeros, totales = {}) {
    try {
        const mesAnio = `${getNombreMes(primeraFecha.mes).toLowerCase()} ${primeraFecha.anio}`;

        const lineas = [];
        lineas.push('===== REPORTE DE PROMOCIONES =====');
        lineas.push(mesAnio);

        let configuracionLinea = `Configuracion: ${configPasajeros.adultos} adultos + ${configPasajeros.menores.cantidad} menor(es)`;
        if (configPasajeros.menores.cantidad > 0) {
            configuracionLinea += ` (${configPasajeros.menores.edades.join(', ')} anos)`;
        }
        lineas.push(configuracionLinea);
        lineas.push('');

        const destinosAgrupados = new Map();
        const ordenDestinos = [];

        const registrarColeccion = (items = [], tipo = 'promocion') => {
            items.forEach((item) => {
                if (!item) {
                    return;
                }

                const destinoNombre = (item.destinoDetallado || item.destino || item.destinoEspecifico || item.destinoSolicitado || 'Destino sin identificar').toString().trim() || 'Destino sin identificar';
                const claveDestino = destinoNombre.toLowerCase();

                if (!destinosAgrupados.has(claveDestino)) {
                    destinosAgrupados.set(claveDestino, {
                        destino: destinoNombre,
                        solicitado: item.destinoSolicitado || null,
                        semanas: new Map()
                    });
                    ordenDestinos.push(claveDestino);
                }

                const destinoData = destinosAgrupados.get(claveDestino);
                if (item.destinoSolicitado && !destinoData.solicitado) {
                    destinoData.solicitado = item.destinoSolicitado;
                }

                const semanaId = item.fechas && item.fechas.semana !== undefined ? item.fechas.semana : 'sin_semana';
                if (!destinoData.semanas.has(semanaId)) {
                    destinoData.semanas.set(semanaId, {
                        identificador: semanaId,
                        fechas: item.fechas || {},
                        promociones: [],
                        baratas: []
                    });
                }

                const semanaData = destinoData.semanas.get(semanaId);
                if (tipo === 'promocion') {
                    semanaData.promociones.push(item);
                } else {
                    semanaData.baratas.push(item);
                }
            });
        };

        registrarColeccion(promociones, 'promocion');
        registrarColeccion(opcionesBaratas, 'barata');

        if (ordenDestinos.length === 0) {
            lineas.push('Sin resultados para las semanas seleccionadas.');
            return lineas.join('\n');
        }

        ordenDestinos.forEach((claveDestino, indiceDestino) => {
            const destinoData = destinosAgrupados.get(claveDestino);

            lineas.push(`===== DESTINO ${indiceDestino + 1}: ${destinoData.destino} =====`);
            if (destinoData.solicitado && destinoData.solicitado !== destinoData.destino) {
                lineas.push(`Solicitado originalmente: ${destinoData.solicitado}`);
            }
            lineas.push('');

            const semanasOrdenadas = Array.from(destinoData.semanas.values()).sort((a, b) => {
                const semanaA = a.fechas && a.fechas.semana !== undefined ? a.fechas.semana : Number.MAX_SAFE_INTEGER;
                const semanaB = b.fechas && b.fechas.semana !== undefined ? b.fechas.semana : Number.MAX_SAFE_INTEGER;
                return semanaA - semanaB;
            });

            semanasOrdenadas.forEach((semanaData) => {
                const descripcionSemana = semanaData.fechas && semanaData.fechas.descripcionCorta ? semanaData.fechas.descripcionCorta : `Semana ${semanaData.identificador}`;
                lineas.push(descripcionSemana);

                if (semanaData.promociones.length === 0 && semanaData.baratas.length === 0) {
                    lineas.push('  Sin opciones disponibles');
                    lineas.push('');
                    return;
                }

                let contadorPromo = 1;
                semanaData.promociones.forEach((promo) => {
                    lineas.push(`  PROMO ${contadorPromo}`);
                    lineas.push(`    Hotel: ${promo.titulo}`);
                    const listaPromos = (promo.promociones || []).length > 0 ? promo.promociones.join(', ') : 'Sin detalles';
                    lineas.push(`    Promociones: ${listaPromos}`);
                    if (promo.precios && promo.precios.precioPorAdulto !== undefined) {
                        lineas.push(`    Precio por adulto: $${promo.precios.precioPorAdulto.toLocaleString()}`);
                    }
                    if (promo.precios && promo.precios.cantidadMenores > 0) {
                        lineas.push(`    Precio promedio por menor: $${promo.precios.precioPorMenorPromedio.toLocaleString()}`);
                    }
                    if (promo.precios && promo.precios.precioConMenores !== undefined) {
                        lineas.push(`    Precio total: $${promo.precios.precioConMenores.toLocaleString()}`);
                    }
                    if (promo.tipoTarifa && promo.tipoTarifa !== 'ESTANDAR') {
                        lineas.push(`    Tipo de tarifa: ${promo.tipoTarifa}`);
                    }
                    if (CONFIG_PROMOCIONES.logging.nivelDetalle === 'debug' && promo.confianzaCorrelacion) {
                        lineas.push(`    Confianza correlacion: ${promo.confianzaCorrelacion}%`);
                    }
                    lineas.push('');
                    contadorPromo++;
                });

                semanaData.baratas.forEach((barata, indiceBarata) => {
                    const numeroOpcion = contadorPromo + indiceBarata;
                    lineas.push(`  OPCION ${numeroOpcion} (precio bajo)`);
                    lineas.push(`    Hotel: ${barata.titulo}`);
                    if (barata.precios && barata.precios.precioPorAdulto !== undefined) {
                        lineas.push(`    Precio por adulto: $${barata.precios.precioPorAdulto.toLocaleString()}`);
                    }
                    if (barata.precios && barata.precios.cantidadMenores > 0) {
                        lineas.push(`    Precio promedio por menor: $${barata.precios.precioPorMenorPromedio.toLocaleString()}`);
                    }
                    if (barata.precios && barata.precios.precioConMenores !== undefined) {
                        lineas.push(`    Precio total: $${barata.precios.precioConMenores.toLocaleString()}`);
                    } else if (barata.precio) {
                        lineas.push(`    Precio total: ${barata.precio}`);
                    }
                    if (barata.tipoTarifa && barata.tipoTarifa !== 'ESTANDAR') {
                        lineas.push(`    Tipo de tarifa: ${barata.tipoTarifa}`);
                    }
                    lineas.push('');
                });
            });

            lineas.push('');
        });

        if (totales.totalPromociones || totales.totalOpcionesBaratas) {
            lineas.push('===== RESUMEN TOTAL =====');
            if (totales.totalPromociones !== undefined) {
                lineas.push(`Promociones encontradas: ${totales.totalPromociones} (mostrando las mejores ${promociones.length})`);
            }
            if (totales.totalOpcionesBaratas !== undefined) {
                lineas.push(`Opciones baratas encontradas: ${totales.totalOpcionesBaratas} (mostrando las mejores ${opcionesBaratas.length})`);
            }
            lineas.push(`Generado: ${new Date().toLocaleString()}`);
            lineas.push('');
        }

        return lineas.join('\n');

    } catch (error) {
        log('error', `Error al generar reporte: ${error.message}`);
        throw error;
    }
}

function guardarReporte(contenidoReporte, opciones = {}) {
    try {
        const dirResultados = './resultados';
        if (!fs.existsSync(dirResultados)) {
            fs.mkdirSync(dirResultados, { recursive: true });
            log('info', `Directorio creado: ${dirResultados}`);
        }

        const fechaHora = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const sufijo = opciones.mes && opciones.anio ? 
            `${getNombreMes(opciones.mes).toLowerCase()}_${opciones.anio}` : 
            `${fechaHora}`;
        
        const nombreArchivo = `promociones_${sufijo}_${Date.now()}.txt`;
        const rutaArchivo = path.join(dirResultados, nombreArchivo);

        fs.writeFileSync(rutaArchivo, contenidoReporte, 'utf8');
        
        log('exito', `Reporte guardado en: ${rutaArchivo}`);
        return rutaArchivo;

    } catch (error) {
        log('error', `Error al guardar reporte: ${error.message}`);
        throw error;
    }
}

/**
 * FUNCIÓN PRINCIPAL ACTUALIZADA
 */
async function buscarPromocionesSemanalLimitado(opciones = {}) {
    const tiempoInicio = Date.now();
    log('info', '===== INICIANDO BÚSQUEDA DE PROMOCIONES PERSONALIZADA =====');

    try {
        validarOpcionesEntrada(opciones);

        // NUEVA: Validar y configurar pasajeros personalizados
        const configPasajeros = opciones.adultos || opciones.menores ? 
            validarConfiguracionPasajeros({
                adultos: opciones.adultos,
                menores: opciones.menores
            }) : 
            {
                adultos: CONFIG_PROMOCIONES.adultosPredeterminados,
                menores: CONFIG_PROMOCIONES.menoresPredeterminados
            };

        log('info', `👥 Configuración de pasajeros: ${configPasajeros.adultos} adultos + ${configPasajeros.menores.cantidad} menor(es)${configPasajeros.menores.cantidad > 0 ? ` (${configPasajeros.menores.edades.join(', ')} años)` : ''}`);

        const limitesConfig = {
            maxPromociones: opciones.maxPromociones || CONFIG_PROMOCIONES.limitesPorDefecto.maxPromociones,
            maxOpcionesBaratas: opciones.maxOpcionesBaratas || CONFIG_PROMOCIONES.limitesPorDefecto.maxOpcionesBaratas
        };

        const semanasSeleccionadas = Number.isInteger(opciones.semanas) && opciones.semanas > 0
            ? opciones.semanas
            : CONFIG_PROMOCIONES.maxSemanas;
        const destinosSeleccionados = Array.isArray(opciones.destinos) && opciones.destinos.length > 0
            ? opciones.destinos
            : CONFIG_PROMOCIONES.destinosDisponibles;

        log('info', `Período: ${semanasSeleccionadas} semanas (Jueves a Domingo)`);
        log('info', `Límites: ${limitesConfig.maxPromociones} promociones + ${limitesConfig.maxOpcionesBaratas} opciones baratas por destino/semana`);
        log('info', `Origen: ${CONFIG_PROMOCIONES.origen} (CON TRANSPORTE)`);
        log('info', `Destinos: ${destinosSeleccionados.join(', ')}`);

        const opcionesFecha = {
            semanas: semanasSeleccionadas,
            mes: opciones.mes,
            anio: opciones.anio
        };

        const fechasJuevesADomingo = generarFechasJuevesADomingo(opcionesFecha);
        
        const todasLasPromociones = [];
        const todasLasOpcionesBaratas = [];
        let totalPromocionesEncontradas = 0;
        let totalOpcionesBaratasEncontradas = 0;
        let erroresEncontrados = 0;

        for (const destino of destinosSeleccionados) {
            log('info', `===== PROCESANDO DESTINO: ${destino.toUpperCase()} =====`);

            for (const fechas of fechasJuevesADomingo) {
                try {
                    const resultado = await buscarEnDestinoYFechasLimitado(destino, fechas, limitesConfig, configPasajeros);
                    
                    if (!resultado.sinResultados) {
                        todasLasPromociones.push(...resultado.promociones);
                        todasLasOpcionesBaratas.push(...resultado.opcionesBaratas);
                        totalPromocionesEncontradas += resultado.totalPromociones || 0;
                        totalOpcionesBaratasEncontradas += resultado.totalOpcionesBaratas || 0;
                    } else {
                        erroresEncontrados++;
                        log('advertencia', `Sin resultados para ${destino} en ${fechas.descripcionCorta}`);
                    }
                } catch (error) {
                    erroresEncontrados++;
                    log('error', `Error en ${destino} - ${fechas.descripcionCorta}: ${error.message}`);
                }
            }
        }

        const reporte = generarReporteFormateadoMejorado(
            todasLasPromociones, 
            todasLasOpcionesBaratas, 
            fechasJuevesADomingo[0],
            configPasajeros,
            {
                totalPromociones: totalPromocionesEncontradas,
                totalOpcionesBaratas: totalOpcionesBaratasEncontradas
            }
        );

        const rutaArchivo = guardarReporte(reporte, opciones);

        const tiempoTotal = Math.round((Date.now() - tiempoInicio) / 1000);
        log('exito', 'BÚSQUEDA COMPLETADA:');
        log('info', `🎁 Promociones mostradas: ${todasLasPromociones.length} de ${totalPromocionesEncontradas} encontradas`);
        log('info', `💰 Opciones baratas mostradas: ${todasLasOpcionesBaratas.length} de ${totalOpcionesBaratasEncontradas} encontradas`);
        log('info', `⏱️ Tiempo total: ${tiempoTotal} segundos`);
        if (erroresEncontrados > 0) {
            log('advertencia', `❌ Errores encontrados: ${erroresEncontrados}`);
        }

        console.log(reporte);

        return {
            exito: true,
            promociones: todasLasPromociones.length,
            opcionesBaratas: todasLasOpcionesBaratas.length,
            totalPromociones: totalPromocionesEncontradas,
            totalOpcionesBaratas: totalOpcionesBaratasEncontradas,
            errores: erroresEncontrados,
            archivo: rutaArchivo,
            reporte: reporte,
            tiempoEjecucion: tiempoTotal,
            configuracionPasajeros: configPasajeros
        };

    } catch (error) {
        log('error', `ERROR CRÍTICO EN BÚSQUEDA: ${error.message}`);
        throw error;
    }
}

function validarOpcionesEntrada(opciones) {
    if (opciones.mes && (opciones.mes < 1 || opciones.mes > 12)) {
        throw new Error(`Mes inválido: ${opciones.mes}. Debe estar entre 1 y 12.`);
    }
    
    if (opciones.anio && opciones.anio < 2025) {
        throw new Error(`Año inválido: ${opciones.anio}. Debe ser 2025 o posterior.`);
    }
    
    if ((opciones.mes && !opciones.anio) || (!opciones.mes && opciones.anio)) {
        throw new Error('Si usas mes/año, debes proporcionar ambos.');
    }
    
    if (opciones.semanas && (opciones.semanas < 1 || opciones.semanas > 12)) {
        throw new Error(`Número de semanas inválido: ${opciones.semanas}. Debe estar entre 1 y 12.`);
    }
    
    if (opciones.maxPromociones && (opciones.maxPromociones < 1 || opciones.maxPromociones > 20)) {
        throw new Error(`Máximo de promociones inválido: ${opciones.maxPromociones}. Debe estar entre 1 y 20.`);
    }
    
    if (opciones.maxOpcionesBaratas && (opciones.maxOpcionesBaratas < 1 || opciones.maxOpcionesBaratas > 20)) {
        throw new Error(`Máximo de opciones baratas inválido: ${opciones.maxOpcionesBaratas}. Debe estar entre 1 y 20.`);
    }
    
    if (opciones.destinos && (!Array.isArray(opciones.destinos) || opciones.destinos.length === 0)) {
        throw new Error('Destinos debe ser un array no vacío.');
    }
}

module.exports = {
    buscarPromocionesSemanalLimitado,
    CONFIG_PROMOCIONES,
    validarConfiguracionPasajeros,
    generarFechasJuevesADomingo,
    getNombreMes,
    formatearFecha,
    extraerPrecioNumerico,
    realizarBusquedaConReintentos,
    esHotelValido,
    correlacionarHotelesExactos,
    detectarTipoTarifa,
    detectarPromociones,
    detectarPromocionesConLimites,
    buscarEnDestinoYFechasLimitado,
    generarReporteFormateadoMejorado,
    guardarReporte,
    validarOpcionesEntrada,
    log
};

if (require.main === module) {
    const args = process.argv.slice(2);
    const opciones = {};

    if (args.includes('-h') || args.includes('--help')) {
        console.log(`
🎯 PROMO FINDER - Buscador de Promociones NaturLeon PERSONALIZABLE

CONFIGURACIÓN PERSONALIZADA DE PASAJEROS:
  --adultos=N           Número de adultos (1-8, default: 2)
  --menores=N           Número de menores (0-4, default: 1)
  --edades="E1,E2,..."  Edades separadas por comas (ej: "5,8,12")
  
NOTA: Si especificas 4 menores, recibirás un aviso recomendando
      dividir en 2 cotizaciones (2 adultos + 2 menores c/u)

OPCIONES BÁSICAS:
  --mes=MM              Mes específico (1-12)
  --anio=AAAA           Año específico (2025+)
  --semanas=N           Número de semanas (1-12)

LÍMITES:
  --maxPromociones=N    Máximo promociones (1-20)
  --maxOpcionesBaratas=N Máximo opciones baratas (1-20)

EJEMPLOS:
  # Con configuración predeterminada (2 adultos + 1 menor de 12 años)
  node promo-finder.js --semanas=4
  
  # Personalizado: 2 adultos + 2 menores (5 y 10 años)
  node promo-finder.js --adultos=2 --menores=2 --edades="5,10"
  
  # Personalizado: 4 adultos + 3 menores
  node promo-finder.js --adultos=4 --menores=3 --edades="6,9,12"
        `);
        process.exit(0);
    }

    args.forEach(arg => {
        if (arg.startsWith('--adultos=')) {
            opciones.adultos = parseInt(arg.replace('--adultos=', ''));
        } else if (arg.startsWith('--menores=')) {
            const cantidad = parseInt(arg.replace('--menores=', ''));
            if (!opciones.menores) opciones.menores = {};
            opciones.menores.cantidad = cantidad;
        } else if (arg.startsWith('--edades=')) {
            const edadesStr = arg.replace('--edades=', '').replace(/"/g, '');
            const edades = edadesStr.split(',').map(e => parseInt(e.trim()));
            if (!opciones.menores) opciones.menores = {};
            opciones.menores.edades = edades;
        } else if (arg.startsWith('--mes=')) {
            opciones.mes = parseInt(arg.replace('--mes=', ''));
        } else if (arg.startsWith('--anio=')) {
            opciones.anio = parseInt(arg.replace('--anio=', ''));
        } else if (arg.startsWith('--semanas=')) {
            opciones.semanas = parseInt(arg.replace('--semanas=', ''));
        } else if (arg.startsWith('--maxPromociones=')) {
            opciones.maxPromociones = parseInt(arg.replace('--maxPromociones=', ''));
        } else if (arg.startsWith('--maxOpcionesBaratas=')) {
            opciones.maxOpcionesBaratas = parseInt(arg.replace('--maxOpcionesBaratas=', ''));
        } else if (arg.startsWith('--destinos=')) {
            const raw = arg.replace('--destinos=', '');
            opciones.destinos = raw.split(',').map(s => s.trim()).filter(Boolean);
        } else if (arg === '--debug') {
            CONFIG_PROMOCIONES.logging.nivelDetalle = 'debug';
        }
    });

    if (opciones.menores) {
        if (opciones.menores.cantidad && !opciones.menores.edades) {
            console.error('❌ ERROR: Debes especificar las edades con --edades cuando uses --menores');
            process.exit(1);
        }
        if (opciones.menores.edades && !opciones.menores.cantidad) {
            opciones.menores.cantidad = opciones.menores.edades.length;
        }
    }

    buscarPromocionesSemanalLimitado(opciones)
        .then(resultado => {
            if (resultado.exito) {
                log('exito', 'BÚSQUEDA COMPLETADA EXITOSAMENTE!');
                log('info', `📊 ${resultado.promociones} promociones y ${resultado.opcionesBaratas} opciones baratas mostradas`);
                log('info', `📁 Reporte: ${resultado.archivo}`);
                if (resultado.errores > 0) {
                    log('advertencia', `⚠️ Se encontraron ${resultado.errores} errores durante la búsqueda`);
                }
            } else {
                log('error', `❌ ${resultado.mensaje || 'Error desconocido'}`);
            }
        })
        .catch(error => {
            log('error', `💥 ERROR CRÍTICO: ${error.message}`);
            if (CONFIG_PROMOCIONES.logging.nivelDetalle === 'debug') {
                console.error(error.stack);
            }
            process.exit(1);
        });
}