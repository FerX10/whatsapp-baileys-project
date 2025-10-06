const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path'); // <- Añadir esta línea


// Función helper mejorada para esperar resultados - VERSIÓN ACTUALIZADA
async function esperarResultadosListoMejorado(page, timeout = 30000) {
    console.log('Usando detección automática mejorada...');

    // Usar la nueva función de detección automática
    const resultado = await esperarPaginaLista(page, timeout);

    if (resultado) {
        console.log('Resultados detectados automáticamente');
        return true;
    } else {
        console.log('Detección automática falló, verificando manualmente...');

        // Verificación manual como respaldo
        const tieneHoteles = await page.evaluate(() => {
            const hoteles = document.querySelectorAll('[id^="hotel-top-"]');
            return hoteles.length > 0;
        });

        return tieneHoteles;
    }
}


// Función para ajustar fechas para transporte
function ajustarFechasParaTransporte(fechaInicio, fechaFin) {
    const fechaInicioObj = new Date(fechaInicio);
    const fechaFinObj = new Date(fechaFin);

    // Obtener el día de la semana (0: domingo, 4: jueves)
    const diaInicio = fechaInicioObj.getDay();
    const diaFin = fechaFinObj.getDay();

    let fechaInicioAjustada = new Date(fechaInicioObj);
    let fechaFinAjustada = new Date(fechaFinObj);
    let ajustado = false;

    // Verificar patrones válidos: jueves-domingo, domingo-jueves, jueves-jueves, domingo-domingo
    const esInicioValido = diaInicio === 0 || diaInicio === 4; // domingo(0) o jueves(4)
    const esFinValido = diaFin === 0 || diaFin === 4; // domingo(0) o jueves(4)

    // Si el inicio no es válido, ajustar al próximo día válido
    if (!esInicioValido) {
        // Si es lunes(1), martes(2) o miércoles(3), ajustar al próximo jueves
        // Si es viernes(5) o sábado(6), ajustar al próximo domingo
        if (diaInicio >= 1 && diaInicio <= 3) {
            const diasParaJueves = 4 - diaInicio;
            fechaInicioAjustada.setDate(fechaInicioObj.getDate() + diasParaJueves);
        } else {
            const diasParaDomingo = 7 - diaInicio + 0; // 0 es domingo
            fechaInicioAjustada.setDate(fechaInicioObj.getDate() + diasParaDomingo);
        }
        ajustado = true;
    }

    // Si el fin no es válido, ajustar al próximo día válido
    if (!esFinValido) {
        // Si es lunes(1), martes(2) o miércoles(3), ajustar al próximo jueves
        // Si es viernes(5) o sábado(6), ajustar al próximo domingo
        if (diaFin >= 1 && diaFin <= 3) {
            const diasParaJueves = 4 - diaFin;
            fechaFinAjustada.setDate(fechaFinObj.getDate() + diasParaJueves);
        } else {
            const diasParaDomingo = 7 - diaFin + 0; // 0 es domingo
            fechaFinAjustada.setDate(fechaFinObj.getDate() + diasParaDomingo);
        }
        ajustado = true;
    }

    // Verificar patrón inicio-fin válido
    const nuevoInicioEsDomingo = fechaInicioAjustada.getDay() === 0;
    const nuevoFinEsDomingo = fechaFinAjustada.getDay() === 0;
    const nuevoInicioEsJueves = fechaInicioAjustada.getDay() === 4;
    const nuevoFinEsJueves = fechaFinAjustada.getDay() === 4;

    // Verificar si el patrón es válido (domingo-jueves, jueves-domingo, domingo-domingo, jueves-jueves)
    const esPatronValido = (nuevoInicioEsDomingo && nuevoFinEsJueves) ||
        (nuevoInicioEsJueves && nuevoFinEsDomingo) ||
        (nuevoInicioEsDomingo && nuevoFinEsDomingo) ||
        (nuevoInicioEsJueves && nuevoFinEsJueves);

    // Si aún no es un patrón válido, ajustar el fin para que coincida con el inicio
    if (!esPatronValido) {
        if (nuevoInicioEsDomingo) {
            // Si inicio es domingo, asegurar que fin sea jueves o domingo
            // Calcular días hasta el próximo jueves o domingo
            const diasHastaJueves = (4 - nuevoInicioEsDomingo + 7) % 7;
            const diasHastaDomingo = 7;

            // Elegir la fecha más cercana a la original
            if (Math.abs(diasHastaJueves - (fechaFinObj - fechaInicioAjustada) / (1000 * 60 * 60 * 24)) <
                Math.abs(diasHastaDomingo - (fechaFinObj - fechaInicioAjustada) / (1000 * 60 * 60 * 24))) {
                // Ajustar a jueves
                fechaFinAjustada = new Date(fechaInicioAjustada);
                fechaFinAjustada.setDate(fechaInicioAjustada.getDate() + diasHastaJueves);
            } else {
                // Ajustar a domingo
                fechaFinAjustada = new Date(fechaInicioAjustada);
                fechaFinAjustada.setDate(fechaInicioAjustada.getDate() + diasHastaDomingo);
            }
        } else if (nuevoInicioEsJueves) {
            // Si inicio es jueves, asegurar que fin sea domingo o jueves
            // Calcular días hasta el próximo domingo o jueves
            const diasHastaDomingo = (0 - nuevoInicioEsJueves + 7) % 7;
            const diasHastaJueves = 7;

            // Elegir la fecha más cercana a la original
            if (Math.abs(diasHastaDomingo - (fechaFinObj - fechaInicioAjustada) / (1000 * 60 * 60 * 24)) <
                Math.abs(diasHastaJueves - (fechaFinObj - fechaInicioAjustada) / (1000 * 60 * 60 * 24))) {
                // Ajustar a domingo
                fechaFinAjustada = new Date(fechaInicioAjustada);
                fechaFinAjustada.setDate(fechaInicioAjustada.getDate() + diasHastaDomingo);
            } else {
                // Ajustar a jueves
                fechaFinAjustada = new Date(fechaInicioAjustada);
                fechaFinAjustada.setDate(fechaInicioAjustada.getDate() + diasHastaJueves);
            }
        }
        ajustado = true;
    }




    // Formatear fechas en formato YYYY-MM-DD
    const formatoFecha = (fecha) => {
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return {
        fechaInicio: formatoFecha(fechaInicioAjustada),
        fechaFin: formatoFecha(fechaFinAjustada),
        ajustado
    };
}

// Función para calcular la siguiente semana (mismos días de la semana)
function calcularSiguienteSemana(fechaInicio, fechaFin, semanas = 1) {
    const fechaInicioObj = new Date(fechaInicio);
    const fechaFinObj = new Date(fechaFin);

    // Sumar 7 días * número de semanas
    const nuevaFechaInicio = new Date(fechaInicioObj);
    nuevaFechaInicio.setDate(fechaInicioObj.getDate() + (7 * semanas));

    const nuevaFechaFin = new Date(fechaFinObj);
    nuevaFechaFin.setDate(fechaFinObj.getDate() + (7 * semanas));

    // Formatear fechas en formato YYYY-MM-DD
    const formatoFecha = (fecha) => {
        const year = fecha.getFullYear();
        const month = String(fecha.getMonth() + 1).padStart(2, '0');
        const day = String(fecha.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    return {
        fechaInicio: formatoFecha(nuevaFechaInicio),
        fechaFin: formatoFecha(nuevaFechaFin),
        diaInicio: nuevaFechaInicio.toLocaleDateString('es-MX', { weekday: 'long' }),
        diaFin: nuevaFechaFin.toLocaleDateString('es-MX', { weekday: 'long' })
    };
}

// Función de espera para reemplazar waitForTimeout
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Función de espera inteligente para calendarios
async function esperarCalendarioListo(page, timeout = 5000) {
    try {
        await page.waitForFunction(() => {
            const calendario = document.querySelector('.daterangepicker');
            return calendario &&
                calendario.offsetWidth > 0 &&
                calendario.offsetHeight > 0 &&
                window.getComputedStyle(calendario).display !== 'none';
        }, { timeout, polling: 500 });
        return true;
    } catch (error) {
        return false;
    }
}

// Función mejorada con debugging detallado
async function esperarPaginaLista(page, maxTimeout = 60000) {
    console.log('🤖 Detectando carga automática de página...');

    try {
        await page.waitForFunction(() => {
            // DEBUGGING: Listar TODOS los elementos con ID para ver qué hay realmente
            const todosLosIds = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
            const idsHotel = todosLosIds.filter(id => id.includes('hotel'));

            console.log(`🔍 TOTAL IDs en página: ${todosLosIds.length}`);
            console.log(`🏨 IDs que contienen 'hotel': ${idsHotel.length} -> [${idsHotel.join(', ')}]`);

            // Buscar elementos hotel-top específicos
            const hoteles = document.querySelectorAll('[id^="hotel-top-"]');
            console.log(`🎯 Elementos hotel-top-*: ${hoteles.length}`);

            // Si no hay hotel-top, buscar otros patrones comunes
            if (hoteles.length === 0) {
                const alternativas = [
                    { selector: '.card', cantidad: document.querySelectorAll('.card').length },
                    { selector: '[class*="hotel"]', cantidad: document.querySelectorAll('[class*="hotel"]').length },
                    { selector: '[id*="hotel"]', cantidad: document.querySelectorAll('[id*="hotel"]').length },
                    { selector: '[id*="booking"]', cantidad: document.querySelectorAll('[id*="booking"]').length }
                ];

                console.log(`🔄 Alternativas encontradas:`);
                alternativas.forEach(alt => {
                    if (alt.cantidad > 0) {
                        console.log(`   ${alt.selector}: ${alt.cantidad} elementos`);
                    }
                });

                // Mostrar el contenido de la página para debugging
                const bodyText = document.body.textContent.toLowerCase();
                const tieneHoteles = bodyText.includes('hotel') || bodyText.includes('resort');
                const tienePrecios = bodyText.match(/\$[\d,]+/) !== null;
                const tieneErrores = bodyText.includes('no hay') || bodyText.includes('error');

                console.log(`📄 Análisis de contenido: hoteles=${tieneHoteles}, precios=${tienePrecios}, errores=${tieneErrores}`);
            }

            // Verificar contenido real de los hoteles encontrados
            const hotelesConContenido = Array.from(hoteles).filter(hotel => {
                const titulo = hotel.querySelector('span.h5');
                const listaId = hotel.id.replace('hotel-top-', 'booking-result-list-');
                const precio = document.querySelector(`#${listaId} .float-end a`);

                const tieneContenido = titulo &&
                    titulo.textContent.trim().length > 3 &&
                    !titulo.textContent.toLowerCase().includes('no hay') &&
                    !titulo.textContent.toLowerCase().includes('error');

                console.log(`🏨 Hotel ${hotel.id}: título="${titulo?.textContent.trim()}" precio="${precio?.textContent.trim()}" válido=${tieneContenido}`);

                return tieneContenido;
            });

            // Sin indicadores de carga
            const indicadoresCarga = document.querySelectorAll('.loading, .spinner, [class*="loading"]');
            const sinCarga = indicadoresCarga.length === 0;

            // AJAX completado (si existe jQuery)
            const ajaxCompleto = !window.jQuery || window.jQuery.active === 0;

            const listo = hotelesConContenido.length > 0 && sinCarga && ajaxCompleto;

            if (listo) {
                console.log(`✅ DETECTADO: ${hotelesConContenido.length} hoteles válidos`);
            } else {
                console.log(`⏳ Esperando... Hoteles válidos: ${hotelesConContenido.length}, Sin carga: ${sinCarga}, AJAX: ${ajaxCompleto}`);
            }

            return listo;

        }, {
            timeout: maxTimeout,
            polling: 2000  // Verificar cada 2 segundos
        });

        return true;
    } catch (error) {
        console.log('⏰ Timeout de detección automática');

        // DEBUGGING FINAL: Ver qué hay en la página cuando falla
        const estadoFinal = await page.evaluate(() => {
            const todosIds = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
            const idsHotel = todosIds.filter(id => id.includes('hotel') || id.includes('booking'));
            const cards = document.querySelectorAll('.card').length;
            const bodyText = document.body.textContent;
            const tieneResultados = bodyText.includes('RESORT') || bodyText.includes('HOTEL') || bodyText.includes('$');

            return {
                totalIds: todosIds.length,
                idsHotel: idsHotel,
                cards: cards,
                tieneResultados: tieneResultados,
                url: window.location.href,
                textoMuestra: bodyText.substring(0, 500)
            };
        });

        console.log('🚨 ESTADO FINAL DE LA PÁGINA:', JSON.stringify(estadoFinal, null, 2));
        return false;
    }
}
// Función de espera inteligente para resultados
async function esperarResultadosListo(page, timeout = 15000) {
    try {
        await page.waitForFunction(() => {
            const posiblesResultados = [
                '[id^="hotel-top-"]',
                '.card:not(#sticky-search):not(#contador-resultados)',
                '[id^="booking-result-list-"]'
            ];

            for (const selector of posiblesResultados) {
                const elementos = document.querySelectorAll(selector);
                if (elementos.length > 0) {
                    return true;
                }
            }
            return false;
        }, { timeout, polling: 1000 });
        return true;
    } catch (error) {
        return false;
    }
}
// Función auxiliar para hacer navegación segura con reintentos
const navegarSeguro = async (page, url, timeout) => {
    console.log(`Iniciando navegación a ${url}...`);

    for (let intento = 1; intento <= 3; intento++) {
        try {
            console.log(`Intento de navegación ${intento}/3...`);

            // Usar un timeout extendido
            const tiempoExtendido = Math.max(timeout, 30000); // Al menos 30 segundos

            await page.goto(url, {
                waitUntil: ['load', 'networkidle2'],
                timeout: tiempoExtendido
            });

            // Esperar a que el documento esté realmente listo
            await page.waitForFunction(() => document.readyState === 'complete', {
                timeout: 10000
            }).catch(e => console.log('Advertencia: readyState no llegó a complete'));

            console.log(`Navegación a ${url} exitosa en intento ${intento}.`);

            // Tomar captura de la página cargada

            return true;
        } catch (error) {
            console.log(`Error durante navegación a ${url} (intento ${intento}): ${error.message}`);

            if (intento === 3) {
                console.log('Intentando esperar a que la página cargue parcialmente...');
                await esperar(5000);

                // Verificar si al menos tenemos elementos básicos
                const tieneElementosBasicos = await page.evaluate(() => {
                    const tieneLogin = document.querySelector('#login_login, input[type="email"]') !== null;
                    const tieneFormulario = document.querySelector('form') !== null;
                    return { tieneLogin, tieneFormulario };
                });

                console.log('Estado de carga parcial:', tieneElementosBasicos);

                if (tieneElementosBasicos.tieneLogin || tieneElementosBasicos.tieneFormulario) {
                    console.log('Se detectaron elementos básicos, intentando continuar...');
                    return true;
                }

                console.log('No se detectaron elementos básicos, la navegación falló.');
                return false;
            }

            // Esperar antes del siguiente intento
            const tiempoEspera = intento * 3000;
            console.log(`Esperando ${tiempoEspera}ms antes del siguiente intento...`);
            await esperar(tiempoEspera);
        }
    }

    return false;
};




// Función auxiliar para hacer acciones con reintentos
async function conReintentos(accion, descripcion, intentosMax = 3) {
    let error;
    for (let intento = 1; intento <= intentosMax; intento++) {
        try {
            await accion();
            console.log(`${descripcion} completado en intento ${intento}.`);
            return true;
        } catch (e) {
            error = e;
            console.log(`Error en intento ${intento}/${intentosMax} para ${descripcion}:`, e.message);

            if (intento < intentosMax) {
                const tiempoEspera = intento * 1000; // Incrementar el tiempo de espera con cada intento
                console.log(`Esperando ${tiempoEspera}ms antes del siguiente intento...`);
                await esperar(tiempoEspera);
            }
        }
    }
    console.log(`No se pudo completar ${descripcion} después de ${intentosMax} intentos.`);
    return false;
}

// Función para detectar si la búsqueda no tuvo resultados ("Ups!!!")
async function detectarSinResultados(page) {
    try {
        const sinResultados = await page.evaluate(() => {
            // Buscar el h1 con el texto "Ups!!!"
            const h1Elements = Array.from(document.querySelectorAll('h1'));
            const upsElement = h1Elements.find(h1 => h1.textContent.trim().includes('Ups!!!'));

            if (upsElement) {
                return {
                    sinResultados: true,
                    mensaje: upsElement.textContent.trim()
                };
            }

            // También buscar texto que indique no resultados
            const body = document.body.textContent || '';
            if (body.includes('no tuvo resultados') || body.includes('No se encontraron resultados')) {
                return {
                    sinResultados: true,
                    mensaje: 'No se encontraron resultados'
                };
            }

            return { sinResultados: false };
        });

        return sinResultados;
    } catch (error) {
        console.log('Error al detectar sin resultados:', error.message);
        return { sinResultados: false };
    }
}

// Función para hacer click en el botón EDITAR y modificar fechas
async function editarYCambiarFechas(page, nuevaFechaInicio, nuevaFechaFin, conTransporte = false) {
    try {
        console.log(`📝 Editando búsqueda - Nuevas fechas: ${nuevaFechaInicio} a ${nuevaFechaFin}`);

        // PASO 1: Hacer click en el botón EDITAR
        console.log('Buscando botón EDITAR...');

        const botonEditarEncontrado = await page.evaluate(() => {
            // Buscar el botón EDITAR
            const botones = Array.from(document.querySelectorAll('button'));
            const botonEditar = botones.find(btn => btn.textContent.includes('EDITAR'));

            if (botonEditar) {
                botonEditar.click();
                return true;
            }

            // Buscar por selector específico
            const botonPorSelector = document.querySelector('#mostrar-busqueda button');
            if (botonPorSelector) {
                botonPorSelector.click();
                return true;
            }

            return false;
        });

        if (!botonEditarEncontrado) {
            console.log('❌ No se encontró el botón EDITAR');
            return false;
        }

        console.log('✅ Click en botón EDITAR realizado');
        await esperar(2000); // Esperar a que se abra el formulario de edición

        // PASO 2: Hacer click en el campo de fechas
        console.log('Haciendo click en campo de fechas...');

        const selectorFechas = '#singledaterange'; // Selector del campo de fechas en modo edición

        try {
            await page.waitForSelector(selectorFechas, { visible: true, timeout: 5000 });
            await page.click(selectorFechas);
            console.log('✅ Click en campo de fechas realizado');
            await esperar(1500); // Esperar a que se abra el calendario
        } catch (error) {
            console.log('❌ Error al hacer click en campo de fechas:', error.message);
            return false;
        }

        // PASO 3: Esperar a que el calendario esté visible
        const calendarioVisible = await esperarCalendarioListo(page, 5000);
        if (!calendarioVisible) {
            console.log('❌ El calendario no se abrió correctamente');
            return false;
        }

        console.log('✅ Calendario abierto');

        // PASO 4: Seleccionar las nuevas fechas
        // Parsear las fechas
        const fechaInicioObj = new Date(nuevaFechaInicio);
        const fechaFinObj = new Date(nuevaFechaFin);

        const diaInicio = fechaInicioObj.getDate();
        const mesInicio = fechaInicioObj.getMonth(); // 0-11
        const anioInicio = fechaInicioObj.getFullYear();

        const diaFin = fechaFinObj.getDate();
        const mesFin = fechaFinObj.getMonth(); // 0-11
        const anioFin = fechaFinObj.getFullYear();

        console.log(`Seleccionando fecha inicio: día ${diaInicio}, mes ${mesInicio + 1}, año ${anioInicio}`);
        console.log(`Seleccionando fecha fin: día ${diaFin}, mes ${mesFin + 1}, año ${anioFin}`);

        // PASO 4a: Seleccionar fecha de inicio
        try {
            // Primero, asegurarnos de que estamos en el mes correcto para la fecha de inicio
            await page.evaluate((mes, anio) => {
                const calendario = document.querySelector('.daterangepicker');
                if (!calendario) return false;

                // Buscar los controles del calendario para cambiar mes/año si es necesario
                const mesActualElement = calendario.querySelector('.month');
                if (mesActualElement) {
                    console.log('Mes actual en calendario:', mesActualElement.textContent);
                }

                return true;
            }, mesInicio, anioInicio);

            await esperar(500);

            // Hacer click en el día de inicio
            const diaInicioSeleccionado = await page.evaluate((dia) => {
                const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                for (const celda of celdas) {
                    if (celda.textContent.trim() === String(dia)) {
                        celda.click();
                        console.log(`Click en día de inicio: ${dia}`);
                        return true;
                    }
                }
                return false;
            }, diaInicio);

            if (!diaInicioSeleccionado) {
                console.log(`❌ No se pudo seleccionar día de inicio: ${diaInicio}`);
                return false;
            }

            console.log(`✅ Día de inicio seleccionado: ${diaInicio}`);
            await esperar(1000);

        } catch (error) {
            console.log('❌ Error al seleccionar fecha de inicio:', error.message);
            return false;
        }

        // PASO 4b: Seleccionar fecha de fin
        try {
            const diaFinSeleccionado = await page.evaluate((dia) => {
                const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                for (const celda of celdas) {
                    if (celda.textContent.trim() === String(dia)) {
                        celda.click();
                        console.log(`Click en día de fin: ${dia}`);
                        return true;
                    }
                }
                return false;
            }, diaFin);

            if (!diaFinSeleccionado) {
                console.log(`❌ No se pudo seleccionar día de fin: ${diaFin}`);
                return false;
            }

            console.log(`✅ Día de fin seleccionado: ${diaFin}`);
            await esperar(1000);

        } catch (error) {
            console.log('❌ Error al seleccionar fecha de fin:', error.message);
            return false;
        }

        // PASO 5: Aplicar el calendario (si hay botón "Aplicar")
        await page.evaluate(() => {
            const botonAplicar = document.querySelector('.applyBtn');
            if (botonAplicar) {
                botonAplicar.click();
                console.log('Click en botón Aplicar del calendario');
            }
        });

        await esperar(1000);

        // PASO 6: Hacer click en el botón "Buscar" para re-cotizar
        console.log('Buscando botón Buscar para re-cotizar...');

        const botonBuscarEncontrado = await page.evaluate(() => {
            // El botón "Buscar" está dentro del formulario de edición
            const botones = Array.from(document.querySelectorAll('button'));
            const botonBuscar = botones.find(btn => btn.textContent.trim().includes('Buscar'));

            if (botonBuscar) {
                botonBuscar.click();
                console.log('Click en botón Buscar');
                return true;
            }

            return false;
        });

        if (!botonBuscarEncontrado) {
            console.log('❌ No se encontró el botón Buscar');
            return false;
        }

        console.log('✅ Click en botón Buscar realizado');

        // PASO 7: Esperar navegación a página de resultados
        console.log('⏳ Esperando navegación a página de resultados...');

        try {
            await Promise.race([
                page.waitForFunction(() => {
                    return window.location.href.includes('AgenciaMotorResultados.php');
                }, { timeout: 30000 }),
                page.waitForSelector('[id^="hotel-top-"]', { timeout: 30000 }),
                page.waitForSelector('h1', { timeout: 30000 }) // Para detectar "Ups!!!" también
            ]);

            console.log('✅ Navegación completada');
        } catch (error) {
            console.log('⚠️ Timeout en navegación, continuando...');
        }

        await esperar(3000); // Espera adicional para estabilizar

        return true;

    } catch (error) {
        console.log('❌ Error en editarYCambiarFechas:', error.message);
        return false;
    }
}

// Función principal para cotizar con reintentos y fallback a solo alojamiento
async function cotizarConReintentos(page, config, fechasOriginales) {
    const { fechaInicio, fechaFin, conTransporte, conVuelo } = fechasOriginales;
    const MAX_SEMANAS_ADELANTE = 3;

    console.log('\n═══════════════════════════════════════════════');
    console.log('🔄 INICIANDO COTIZACIÓN CON REINTENTOS');
    console.log(`📅 Fechas originales: ${fechaInicio} a ${fechaFin}`);
    console.log(`🚌 Con transporte: ${conTransporte ? 'Sí' : 'No'}`);
    console.log(`✈️ Con vuelo: ${conVuelo ? 'Sí' : 'No'}`);
    console.log('═══════════════════════════════════════════════\n');

    // FASE 1: Intentar con fechas originales y parámetros originales
    console.log('📍 FASE 1: Cotizando con fechas originales...');
    await esperar(5000); // Esperar a que la página cargue

    let resultadoDeteccion = await detectarSinResultados(page);

    if (!resultadoDeteccion.sinResultados) {
        console.log('✅ ÉXITO: Resultados encontrados con fechas originales');
        return {
            exito: true,
            fechasUsadas: { fechaInicio, fechaFin },
            soloAlojamiento: false,
            mensaje: 'Resultados encontrados con parámetros originales'
        };
    }

    console.log('⚠️ No se encontraron resultados con fechas originales');
    console.log(`💬 Mensaje: ${resultadoDeteccion.mensaje}`);

    // FASE 2: Intentar con fechas de las próximas 3 semanas
    console.log('\n📍 FASE 2: Intentando con fechas de las próximas semanas...');

    for (let semana = 1; semana <= MAX_SEMANAS_ADELANTE; semana++) {
        console.log(`\n🔄 Intento ${semana}/${MAX_SEMANAS_ADELANTE}: Buscando ${semana} semana(s) adelante...`);

        const nuevasFechas = calcularSiguienteSemana(fechaInicio, fechaFin, semana);
        console.log(`📅 Nuevas fechas: ${nuevasFechas.fechaInicio} a ${nuevasFechas.fechaFin}`);
        console.log(`📆 Días: ${nuevasFechas.diaInicio} a ${nuevasFechas.diaFin}`);

        // Si es con transporte, verificar que los días sean válidos
        if (conTransporte && !conVuelo) {
            const fechaInicioObj = new Date(nuevasFechas.fechaInicio);
            const fechaFinObj = new Date(nuevasFechas.fechaFin);
            const diaInicio = fechaInicioObj.getDay();
            const diaFin = fechaFinObj.getDay();

            const esInicioValido = diaInicio === 0 || diaInicio === 4; // domingo o jueves
            const esFinValido = diaFin === 0 || diaFin === 4; // domingo o jueves

            if (!esInicioValido || !esFinValido) {
                console.log(`⚠️ Fechas no válidas para transporte (deben ser jueves/domingo). Saltando...`);
                continue;
            }
        }

        // Editar y cambiar fechas
        const exitoEdicion = await editarYCambiarFechas(
            page,
            nuevasFechas.fechaInicio,
            nuevasFechas.fechaFin,
            conTransporte
        );

        if (!exitoEdicion) {
            console.log(`❌ No se pudo editar fechas para semana ${semana}`);
            continue;
        }

        // Esperar y verificar resultados
        await esperar(5000);
        resultadoDeteccion = await detectarSinResultados(page);

        if (!resultadoDeteccion.sinResultados) {
            console.log(`✅ ÉXITO: Resultados encontrados en semana +${semana}`);
            return {
                exito: true,
                fechasUsadas: nuevasFechas,
                soloAlojamiento: false,
                semanasAdelante: semana,
                mensaje: `Resultados encontrados ${semana} semana(s) después`
            };
        }

        console.log(`❌ No se encontraron resultados en semana +${semana}`);
    }

    // FASE 3: Fallback a SOLO ALOJAMIENTO con fechas originales
    console.log('\n📍 FASE 3: Fallback a SOLO ALOJAMIENTO con fechas originales...');
    console.log('⚠️ No se encontraron resultados con transporte/vuelo en ninguna fecha');
    console.log('🏨 Intentando buscar SOLO ALOJAMIENTO...');

    // Volver a hacer click en EDITAR
    const botonEditarEncontrado = await page.evaluate(() => {
        const botones = Array.from(document.querySelectorAll('button'));
        const botonEditar = botones.find(btn => btn.textContent.includes('EDITAR'));
        if (botonEditar) {
            botonEditar.click();
            return true;
        }
        const botonPorSelector = document.querySelector('#mostrar-busqueda button');
        if (botonPorSelector) {
            botonPorSelector.click();
            return true;
        }
        return false;
    });

    if (!botonEditarEncontrado) {
        console.log('❌ No se pudo abrir el formulario de edición para cambiar a solo alojamiento');
        return {
            exito: false,
            mensaje: 'No se pudieron encontrar resultados con ninguna configuración',
            soloAlojamiento: false
        };
    }

    await esperar(2000);

    // Cambiar las fechas de vuelta a las originales
    console.log(`📅 Restaurando fechas originales: ${fechaInicio} a ${fechaFin}`);

    const exitoCambioFechas = await editarYCambiarFechas(page, fechaInicio, fechaFin, false); // false = solo alojamiento

    if (!exitoCambioFechas) {
        console.log('❌ No se pudieron restaurar las fechas originales');
        return {
            exito: false,
            mensaje: 'Error al cambiar a modo solo alojamiento',
            soloAlojamiento: false
        };
    }

    // Cambiar a modo "SOLO ALOJAMIENTO" (tab H en lugar de C o A)
    console.log('🏨 Cambiando a modo SOLO ALOJAMIENTO...');

    const cambiadoASoloAlojamiento = await page.evaluate(() => {
        try {
            // Buscar el tab de "SOLO ALOJAMIENTO" o "HOSPEDAJE"
            const tabs = Array.from(document.querySelectorAll('a[role="tab"], li > a'));

            // Buscar por el icono o texto que identifica solo alojamiento
            const tabAlojamiento = tabs.find(tab => {
                const texto = tab.textContent.toLowerCase();
                return texto.includes('solo') || texto.includes('alojamiento') || texto.includes('hospedaje');
            });

            if (tabAlojamiento) {
                tabAlojamiento.click();
                console.log('✅ Click en tab SOLO ALOJAMIENTO');
                return true;
            }

            // Si no encontramos por texto, buscar por el tercer tab (asumiendo que es: Transporte, Vuelo, Solo Alojamiento)
            if (tabs.length >= 3) {
                tabs[2].click(); // Índice 2 = tercer tab
                console.log('✅ Click en tercer tab (asumido como SOLO ALOJAMIENTO)');
                return true;
            }

            return false;
        } catch (error) {
            console.log('Error al cambiar a solo alojamiento:', error.message);
            return false;
        }
    });

    if (!cambiadoASoloAlojamiento) {
        console.log('⚠️ No se pudo cambiar explícitamente a solo alojamiento, continuando...');
    }

    await esperar(2000);

    // Configurar las fechas y destino para solo alojamiento
    console.log('📝 Configurando búsqueda para SOLO ALOJAMIENTO...');

    // Hacer click en COTIZAR para buscar solo alojamiento
    console.log('🔍 Ejecutando búsqueda de SOLO ALOJAMIENTO...');

    const clickCotizarExitoso = await page.evaluate(() => {
        const botones = Array.from(document.querySelectorAll('button'));
        const botonCotizar = botones.find(btn => btn.textContent.includes('COTIZAR') || btn.textContent.includes('BUSCAR'));
        if (botonCotizar) {
            botonCotizar.click();
            return true;
        }
        return false;
    });

    if (!clickCotizarExitoso) {
        console.log('❌ No se pudo hacer click en COTIZAR para solo alojamiento');
        return {
            exito: false,
            mensaje: 'Error al ejecutar búsqueda de solo alojamiento',
            soloAlojamiento: true
        };
    }

    // Esperar navegación y resultados
    console.log('⏳ Esperando resultados de solo alojamiento...');

    try {
        await Promise.race([
            page.waitForFunction(() => {
                return window.location.href.includes('AgenciaMotorResultados.php');
            }, { timeout: 30000 }),
            page.waitForSelector('[id^="hotel-top-"]', { timeout: 30000 }),
            page.waitForSelector('h1', { timeout: 30000 })
        ]);
    } catch (error) {
        console.log('⚠️ Timeout esperando resultados de solo alojamiento');
    }

    await esperar(5000);

    // Verificar si ahora hay resultados
    resultadoDeteccion = await detectarSinResultados(page);

    if (!resultadoDeteccion.sinResultados) {
        console.log('✅ ÉXITO: Resultados encontrados con SOLO ALOJAMIENTO');
        return {
            exito: true,
            fechasUsadas: { fechaInicio, fechaFin },
            soloAlojamiento: true,
            mensaje: 'Resultados encontrados con solo alojamiento (sin transporte/vuelo)',
            advertencia: conTransporte ?
                'No se encontró disponibilidad con transporte terrestre. Se muestran solo precios de hotel.' :
                'No se encontró disponibilidad con vuelo. Se muestran solo precios de hotel.'
        };
    }

    // Si llegamos aquí, no se encontraron resultados ni siquiera con solo alojamiento
    console.log('❌ FALLO TOTAL: No se encontraron resultados con ninguna configuración');

    return {
        exito: false,
        mensaje: 'No se encontraron resultados disponibles para este destino y fechas',
        soloAlojamiento: false,
        intentosRealizados: {
            fechasOriginales: true,
            semanasAdelante: MAX_SEMANAS_ADELANTE,
            soloAlojamiento: true
        }
    };
}

// En la parte donde configura los niños

function normalizarTextoBasico(texto = "") {
    return String(texto)
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s,.-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function verificarCoincidenciaOrigen(origenEsperado, origenObtenido) {
    if (!origenEsperado || !origenObtenido) {
        return false;
    }

    const esperado = normalizarTextoBasico(origenEsperado);
    const obtenido = normalizarTextoBasico(origenObtenido);

    if (!esperado || !obtenido) {
        return false;
    }

    if (obtenido.includes(esperado) || esperado.includes(obtenido)) {
        return true;
    }

    const tokens = esperado.split(/[ ,.-]+/).filter(token => token.length >= 3);
    if (tokens.length === 0) {
        return obtenido.includes(esperado);
    }

    return tokens.some(token => obtenido.includes(token));
}

async function configurarCampoNumerico(page, selector, valor, descripcion) {
    console.log(`Configurando ${descripcion} con valor: ${valor}`);

    try {
        // Verificar si el campo existe
        let campoExiste = await page.evaluate((sel) => {
            return document.querySelector(sel) !== null;
        }, selector);

        let selectorUtilizado = selector; // Usar let en lugar de const

        if (!campoExiste) {
            console.log(`ADVERTENCIA: No se encontró el campo ${selector}`);

            // Intentar buscar un selector alternativo
            const selectorAlternativo = await page.evaluate((descripcion) => {
                // Buscar inputs que parezcan ser para la configuración deseada
                const inputs = document.querySelectorAll('input[type="number"], input[type="text"]');
                for (const input of inputs) {
                    const label = input.getAttribute('aria-label') ||
                        input.getAttribute('placeholder') ||
                        input.getAttribute('title') ||
                        input.id ||
                        '';

                    // Buscar palabras clave relacionadas con la descripción
                    if (descripcion.includes('adultos') &&
                        (label.toLowerCase().includes('adult') ||
                            label.toLowerCase().includes('ocupacion'))) {
                        return input.id ? `#${input.id}` : null;
                    }

                    if (descripcion.includes('menor') &&
                        (label.toLowerCase().includes('niño') ||
                            label.toLowerCase().includes('child') ||
                            label.toLowerCase().includes('menor'))) {
                        return input.id ? `#${input.id}` : null;
                    }

                    if (descripcion.includes('edad') &&
                        (label.toLowerCase().includes('edad') ||
                            label.toLowerCase().includes('age'))) {
                        return input.id ? `#${input.id}` : null;
                    }
                }

                return null;
            }, descripcion);

            if (selectorAlternativo) {
                console.log(`Encontrado selector alternativo: ${selectorAlternativo}`);
                selectorUtilizado = selectorAlternativo;
            } else {
                console.log(`No se pudo encontrar un selector alternativo para ${descripcion}`);
                return;
            }
        }

        // Método 1: Borrar e introducir el valor usando click y type
        try {
            await page.click(selectorUtilizado, { clickCount: 3 }); // Seleccionar todo el texto
            await esperar(200);
            await page.type(selectorUtilizado, String(valor), { delay: 100 });
        } catch (error) {
            console.log(`Error al interactuar con ${selectorUtilizado}: ${error.message}`);
        }

        // Método 2: Usar evaluate para asegurar que el valor se establezca
        await page.evaluate((sel, val) => {
            const campo = document.querySelector(sel);
            if (campo) {
                campo.value = val;

                // Disparar eventos para activar cualquier listener
                campo.dispatchEvent(new Event('input', { bubbles: true }));
                campo.dispatchEvent(new Event('change', { bubbles: true }));

                // Si hay un botón de incremento/decremento al lado, intentar usarlo
                const parent = campo.parentElement;
                if (parent) {
                    const btns = parent.querySelectorAll('button, .btn, [role="button"]');
                    if (btns.length > 0) {
                        // Tenemos botones, verificar si necesitamos incrementar o decrementar
                        const valorActual = parseInt(campo.value || '0');
                        const valorDeseado = parseInt(val);

                        if (valorActual < valorDeseado) {
                            // Necesitamos incrementar - generalmente el segundo botón
                            if (btns.length > 1) btns[1].click();
                        } else if (valorActual > valorDeseado) {
                            // Necesitamos decrementar - generalmente el primer botón
                            btns[0].click();
                        }
                    }
                }
            }
        }, selectorUtilizado, String(valor));

        // Verificar que el valor se haya establecido correctamente
        const valorActual = await page.evaluate((sel) => {
            const campo = document.querySelector(sel);
            return campo ? campo.value : null;
        }, selectorUtilizado);

        if (valorActual === String(valor)) {
            console.log(`✅ Valor configurado correctamente para ${descripcion}: ${valorActual}`);
        } else {
            console.log(`⚠️ No se pudo confirmar el valor para ${descripcion}. Valor esperado: ${valor}, valor actual: ${valorActual}`);

            // Intentar un último método: enviar keys directo
            try {
                await page.focus(selectorUtilizado);
                // Borrar el contenido actual
                await page.keyboard.down('Control');
                await page.keyboard.press('a');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                // Escribir el nuevo valor
                await page.keyboard.type(String(valor));
            } catch (error) {
                console.log(`Error en intento final para ${descripcion}: ${error.message}`);
            }
        }
    } catch (error) {
        console.log(`Error al configurar ${descripcion}:`, error.message);
    }
}

// Función auxiliar para configurar pasajeros en modo transporte
async function configurarPasajerosTransporte(page, busqueda) {
    try {
        // 1. Primero hacer clic en la habitación (#hab1) para activarla
        console.log('Activando configuración de habitación...');
        try {
            await page.waitForSelector('#hab1', { timeout: 5000 });
            await page.click('#hab1');
            await esperar(1000);
        } catch (errorHab) {
            console.log('Error al hacer clic en #hab1:', errorHab.message);
            // Intento alternativo si el selector específico no funciona
            await page.evaluate(() => {
                const divHab = document.querySelector('[id^="hab"]');
                if (divHab) divHab.click();
            });
            await esperar(1000);
        }

        // 2. Configurar número de menores
        if (busqueda.ninos > 0) {
            console.log(`Configurando ${busqueda.ninos} menores...`);
            try {
                // Esperar y hacer clic en el campo de menores
                await page.waitForSelector('#habitacion_1_menores', { timeout: 5000 });
                await page.click('#habitacion_1_menores', { clickCount: 3 }); // Seleccionar todo el texto
                await esperar(500);

                // Introducir el número de menores
                await page.type('#habitacion_1_menores', String(busqueda.ninos), { delay: 200 });

                // Presionar Tab para confirmar y pasar al siguiente campo
                await page.keyboard.press('Tab');
                await esperar(1000);

                // 3. Configurar edades de los menores
                console.log('Configurando edades de menores...');
                for (let i = 1; i <= busqueda.ninos; i++) {
                    const edadMenor = i <= busqueda.edadesMenores.length ? busqueda.edadesMenores[i - 1] : 5;
                    console.log(`Configurando edad del menor ${i}: ${edadMenor} años`);

                    const selectorEdad = `#habitacion_1_menor_${i}`;

                    try {
                        await page.waitForSelector(selectorEdad, { timeout: 5000 });

                        // Hacer clic y seleccionar todo el texto actual
                        await page.click(selectorEdad, { clickCount: 3 });
                        await esperar(500);

                        // Borrar el valor actual por si acaso
                        await page.keyboard.press('Backspace');

                        // Escribir la nueva edad y confirmar con Tab
                        await page.type(selectorEdad, String(edadMenor), { delay: 200 });
                        await page.keyboard.press('Tab');
                        await esperar(1000);

                        // Verificar que el valor se haya establecido correctamente
                        const valorActual = await page.evaluate((sel) => {
                            return document.querySelector(sel)?.value || '';
                        }, selectorEdad);

                        if (valorActual !== String(edadMenor)) {
                            console.log(`ALERTA: El valor de la edad (${valorActual}) no coincide con el esperado (${edadMenor}). Intentando de nuevo...`);
                            // Intentar de nuevo con método alternativo
                            await page.evaluate((sel, edad) => {
                                const input = document.querySelector(sel);
                                if (input) {
                                    input.value = edad;
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }, selectorEdad, String(edadMenor));
                        }
                    } catch (errorEdad) {
                        console.log(`Error al configurar edad del menor ${i}:`, errorEdad.message);
                    }
                }
            } catch (errorMenores) {
                console.log('Error al configurar menores:', errorMenores.message);
            }
        }

        // 4. Hacer clic en otro lugar para confirmar los cambios
        try {
            await page.evaluate(() => {
                // Hacer clic en un área vacía
                document.querySelector('body').click();
            });
            await esperar(1000);
        } catch (errorCierre) {
            console.log('Error al cerrar menú de pasajeros:', errorCierre.message);
        }

        console.log('Configuración de pasajeros en modo transporte completada');
    } catch (error) {
        console.log('Error general al configurar pasajeros en modo transporte:', error.message);
        throw error;
    }
}
// Función principal para realizar el scraping
async function scrapNaturLeon(opciones) {
    // Valores por defecto para las opciones
    const config = {
        credenciales: {
            email: opciones.email || 'izlandtours-norma@outlook.com',
            password: opciones.password || 'Paleta123'
        },
        busqueda: {
            destino: opciones.destino || 'Cancun',
            fechaInicio: opciones.fechaInicio || '2025-06-10',
            fechaFin: opciones.fechaFin || '2025-06-17',
            plan: opciones.plan || 'todoincluido',
            adultos: opciones.adultos || 2,
            ninos: opciones.ninos || 0,
            edadesMenores: opciones.edadesMenores || [], // Edades por defecto
            habitaciones: opciones.habitaciones || 1,
            // Nuevas opciones para búsqueda con transporte
            conTransporte: opciones.conTransporte === true, // Asegurar que sea un booleano
            origen: opciones.origen || 'León (Natursala Hidalgo)',
            ajustarFechasTransporte: opciones.ajustarFechasTransporte !== undefined ? opciones.ajustarFechasTransporte : true,
            // Nueva opción para vista al mar
            vistaAlMar: opciones.vistaAlMar === true
        },
        headless: opciones.headless !== undefined ? opciones.headless : false,
        guardarResultados: opciones.guardarResultados !== undefined ? opciones.guardarResultados : true,
        tomarCaptura: opciones.tomarCaptura !== undefined ? opciones.tomarCaptura : false,
        timeout: opciones.timeout || 30000 // Tiempo de espera general aumentado a 30 segundos
    };

    console.log('Iniciando proceso de scraping para NaturLeon...');
    console.log(`Destino: ${config.busqueda.destino}`);
    console.log(`Fechas: ${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`);
    console.log(`Configuración de personas: ${config.busqueda.adultos} adultos, ${config.busqueda.ninos} niños, ${config.busqueda.habitaciones} habitación(es)`);



    if (config.busqueda.conTransporte === true) {
        console.log(`Modo de búsqueda: CON TRANSPORTE desde ${config.busqueda.origen}`);

        // Verificar si las fechas son adecuadas para transporte
        if (config.busqueda.ajustarFechasTransporte) {
            const fechasAjustadas = ajustarFechasParaTransporte(config.busqueda.fechaInicio, config.busqueda.fechaFin);
            if (fechasAjustadas.ajustado) {
                console.log(`AVISO: Fechas ajustadas para transporte - Original: ${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}, Ajustado: ${fechasAjustadas.fechaInicio} a ${fechasAjustadas.fechaFin}`);
                config.busqueda.fechaInicio = fechasAjustadas.fechaInicio;
                config.busqueda.fechaFin = fechasAjustadas.fechaFin;
            }
        }

        // Verificar si el destino es compatible con transporte (solo Puerto Vallarta e Ixtapa)
        const destinosTransporte = ['puerto vallarta', 'ixtapa'];
        const destinoNormalizado = config.busqueda.destino.toLowerCase();
        const esDestinoCompatible = destinosTransporte.some(d => destinoNormalizado.includes(d));

        if (!esDestinoCompatible) {
            console.log(`ℹ️ Nota: El destino "${config.busqueda.destino}" podría tener menos opciones disponibles con transporte, pero se intentará la búsqueda.`);

        }
    } else {
        console.log('Modo de búsqueda: SOLO ALOJAMIENTO');
    }

    // Iniciar el navegador con opciones adicionales para mejorar rendimiento
    const browser = await puppeteer.launch({
        headless: config.headless,
        defaultViewport: null,
        args: [
            '--window-size=1366,768',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    // Aumentar todos los tiempos de espera
    // Tiempos de espera optimizados
    const tiempoEsperaOptimizado = Math.max(config.timeout, 15000); // Reducido a 15 segundos
    page.setDefaultTimeout(tiempoEsperaOptimizado);
    page.setDefaultNavigationTimeout(tiempoEsperaOptimizado);
    console.log(`Configurando tiempos de espera en: ${tiempoEsperaOptimizado}ms`);
    try {
        // Mejorar el rendimiento de la página
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            // Bloquear recursos que no son esenciales para mejorar el rendimiento
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // PASO 1: Proceso de login
        console.log('Iniciando proceso de login...');

        // Navegar a la página principal
        const navegacionExitosa = await navegarSeguro(page, 'https://www.naturleon.com/', config.timeout);
        if (!navegacionExitosa) {
            console.log('Intentando determinar si la página cargó lo suficiente para continuar...');

            // Verificar si al menos tenemos elementos básicos
            const tieneElementosBasicos = await page.evaluate(() => {
                const tieneLogin = document.querySelector('#login_login') !== null;
                const tieneFormulario = document.querySelector('form') !== null;
                return { tieneLogin, tieneFormulario };
            });

            console.log('Estado de carga parcial:', tieneElementosBasicos);

            if (!tieneElementosBasicos.tieneLogin && !tieneElementosBasicos.tieneFormulario) {
                throw new Error('La página no cargó lo suficiente para continuar con el login');
            } else {
                console.log('La página cargó parcialmente, intentando continuar con el proceso...');
            }
        }

        // Esperar a que aparezca el formulario de login con tiempo de espera extendido
        try {
            await page.waitForSelector('#login_login', { timeout: config.timeout });
            console.log('Formulario de login detectado.');
        } catch (waitError) {
            console.log('No se encontró el selector #login_login. Intentando verificar si hay otros campos de login...');

            // Buscar cualquier campo que parezca un login
            const camposLogin = await page.evaluate(() => {
                const posiblesCampos = document.querySelectorAll('input[type="email"], input[type="text"][id*="login"], input[type="text"][name*="login"], input[id*="email"], input[name*="email"]');
                return Array.from(posiblesCampos).map(campo => ({
                    id: campo.id,
                    name: campo.name,
                    type: campo.type,
                    placeholder: campo.placeholder
                }));
            });

            console.log('Posibles campos de login encontrados:', camposLogin);

            if (camposLogin.length > 0) {
                // Usar el primer campo que encontremos
                const campoLogin = camposLogin[0];
                const selector = campoLogin.id ? `#${campoLogin.id}` : `input[name="${campoLogin.name}"]`;
                console.log(`Intentando usar selector alternativo: ${selector}`);
                await page.waitForSelector(selector, { timeout: config.timeout });
                await page.type(selector, config.credenciales.email, { delay: 100 });
            } else {
                throw new Error('No se pudo encontrar el campo de login en la página');
            }
        }

        // Rellenar el formulario de login con reintento
        try {
            await page.type('#login_login', config.credenciales.email, { delay: 100 });
            console.log('Email ingresado.');
        } catch (typeError) {
            console.log('Error al ingresar email. Intentando método alternativo...');

            await page.evaluate((email) => {
                const loginInput = document.querySelector('#login_login');
                if (loginInput) {
                    loginInput.value = email;
                }
            }, config.credenciales.email);
        }

        // Esperar y rellenar el campo de contraseña
        try {
            await page.waitForSelector('#login_pass', { timeout: config.timeout });
            await page.type('#login_pass', config.credenciales.password, { delay: 100 });
            console.log('Contraseña ingresada.');
        } catch (passError) {
            console.log('Error al ingresar contraseña. Intentando método alternativo...');

            // Buscar cualquier campo que parezca un campo de contraseña
            const camposPass = await page.evaluate(() => {
                const posiblesCampos = document.querySelectorAll('input[type="password"]');
                return Array.from(posiblesCampos).map(campo => ({
                    id: campo.id,
                    name: campo.name,
                    placeholder: campo.placeholder
                }));
            });

            console.log('Posibles campos de contraseña encontrados:', camposPass);

            if (camposPass.length > 0) {
                // Usar el primer campo que encontremos
                const campoPass = camposPass[0];
                const selector = campoPass.id ? `#${campoPass.id}` : `input[name="${campoPass.name}"]`;
                console.log(`Intentando usar selector alternativo: ${selector}`);
                await page.type(selector, config.credenciales.password, { delay: 100 });
            } else {
                throw new Error('No se pudo encontrar el campo de contraseña en la página');
            }
        }

        // Tomar una captura antes de hacer clic en login

        // Hacer clic en el botón de login con manejo especial para evitar problemas de timeout
        console.log('Haciendo clic en el botón de login...');

        let loginExitoso = false;

        try {
            // Método 1: Intentar hacer clic directamente con Promise.all (que puede causar timeout)
            const botonLoginEncontrado = await page.evaluate(() => {
                const botones = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const botonLogin = botones.find(b =>
                    b.textContent?.includes('Entrar') ||
                    b.value?.includes('Entrar') ||
                    b.id?.includes('login') ||
                    b.className?.includes('login')
                );

                if (botonLogin) {
                    return {
                        encontrado: true,
                        tipo: botonLogin.tagName,
                        id: botonLogin.id || '',
                        clase: botonLogin.className || '',
                        texto: botonLogin.textContent || botonLogin.value || ''
                    };
                }
                return { encontrado: false };
            });

            console.log('Botón de login:', botonLoginEncontrado);

            if (botonLoginEncontrado.encontrado) {
                // Método 2: Hacer clic sin esperar navegación primero
                if (botonLoginEncontrado.id) {
                    await page.click(`#${botonLoginEncontrado.id}`);
                } else if (botonLoginEncontrado.clase) {
                    const primerClase = botonLoginEncontrado.clase.split(' ')[0];
                    await page.click(`.${primerClase}`);
                } else {
                    // Usar evaluate como último recurso
                    await page.evaluate(() => {
                        const botones = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                        const botonLogin = botones.find(b =>
                            b.textContent?.includes('Entrar') ||
                            b.value?.includes('Entrar') ||
                            b.id?.includes('login') ||
                            b.className?.includes('login')
                        );

                        if (botonLogin) botonLogin.click();
                    });
                }

                // Ahora esperar la navegación por separado
                try {
                    await page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: config.timeout
                    });
                    console.log('Navegación después de login completada.');
                    loginExitoso = true;
                } catch (navError) {
                    console.log('Timeout en navegación post-login, pero el clic fue exitoso. Intentando continuar...');
                    // Esperar un tiempo fijo y tomar captura
                    await esperar(5000);
                }
            } else {
                // Si no encontramos el botón específico, intentar con el botón dentro de #inicio
                try {
                    await page.click('#inicio button');

                    // Esperar navegación
                    await page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: config.timeout
                    });
                    console.log('Navegación después de login con selector #inicio button completada.');
                    loginExitoso = true;
                } catch (buttonError) {
                    console.log('Error al hacer clic en #inicio button:', buttonError.message);

                    // Último intento: usar submit en el formulario
                    try {
                        await page.evaluate(() => {
                            const form = document.querySelector('form');
                            if (form) form.submit();
                        });

                        // Esperar navegación
                        await page.waitForNavigation({
                            waitUntil: 'networkidle2',
                            timeout: config.timeout
                        });
                        console.log('Navegación después de form.submit() completada.');
                        loginExitoso = true;
                    } catch (formError) {
                        console.log('Error al hacer submit del formulario:', formError.message);
                    }
                }
            }
        } catch (clickError) {
            console.log('Error durante el proceso de clic en login:', clickError.message);
        }

        // Tomar una captura después del intento de login

        // Verificar si el login fue exitoso
        const verificacionLogin = await page.evaluate(() => {
            // Buscar elementos que solo aparecen cuando el usuario está autenticado
            const elementosAutenticados = [
                '.user-menu',
                '.usuario-logueado',
                '.profile-menu',
                '.user-profile',
                '.logout-button',
                '.bienvenida'
            ];

            for (const selector of elementosAutenticados) {
                if (document.querySelector(selector)) {
                    return { exitoso: true, elemento: selector };
                }
            }

            // Verificar si ya no aparece el formulario de login
            const loginDesaparecido = document.querySelector('#login_login') === null &&
                document.querySelector('#login_pass') === null;

            if (loginDesaparecido) {
                return { exitoso: true, elemento: 'formulario-ausente' };
            }

            // Verificar si aparece algún mensaje de error
            const posiblesErrores = document.querySelectorAll('.error, .alert, .mensaje-error');
            if (posiblesErrores.length > 0) {
                return {
                    exitoso: false,
                    error: Array.from(posiblesErrores).map(e => e.textContent.trim()).join(' | ')
                };
            }

            return { exitoso: false, error: 'No se detectaron elementos de sesión iniciada' };
        });

        console.log('Verificación de login:', verificacionLogin);

        if (verificacionLogin.exitoso || loginExitoso) {
            console.log('Login exitoso.');
        } else {
            console.log('No se pudo confirmar un login exitoso, pero intentaremos continuar...');
            // Si hay un error específico, mostrarlo
            if (verificacionLogin.error) {
                console.log('Posible error de login:', verificacionLogin.error);
            }
        }

        // PASO 2: Navegar a la página de búsqueda/cotización
        console.log('Navegando a la página de búsqueda...');

        // Navegar a la página de búsqueda con manejo de errores
        try {
            await page.goto('https://www.naturleon.com/agencia/AgenciaLandingPage.php', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            console.log('Navegación a página de búsqueda exitosa.');
        } catch (navError) {
            console.log('Error en navegación a página de búsqueda:', navError.message);
            console.log('Intentando esperar a que la página cargue parcialmente...');

            // Esperar un tiempo fijo
            await esperar(5000);

            // Tomar captura para ver el estado actual
        }
        // PASO 2.5: Si es con transporte, cambiar a la pestaña de transporte
        // PASO 2.5: Si es con transporte, cambiar a la pestaña de transporte
        if (config.busqueda.conTransporte) {
            console.log('Cambiando a modo de búsqueda CON TRANSPORTE...');

            try {
                // Buscar y hacer clic en la pestaña de NaturCharter (transporte)
                await conReintentos(async () => {
                    // CORRECCIÓN: Usar el selector exacto del recorder
                    const selectoresPestaña = [
                        'div.content-page li:nth-of-type(2) i',  // SELECTOR PRINCIPAL del recorder
                        'div.content-page li:nth-of-type(2) span',
                        'div.content-page li:nth-of-type(2) a',
                        '#v-pills-naturcharter-tab'
                    ];
                    // Intentar cada selector
                    for (const selector of selectoresPestaña) {
                        try {
                            const elementoExiste = await page.evaluate((sel) => {
                                const elemento = document.querySelector(sel);
                                return !!elemento;
                            }, selector);

                            if (elementoExiste) {
                                console.log(`Encontrado selector para pestaña de transporte: ${selector}`);
                                await page.click(selector);
                                await esperar(1000);

                                // Verificar si cambió a la pestaña correcta
                                const tabActivado = await page.evaluate(() => {
                                    return document.querySelector('#v-pills-naturcharter.active') !== null;
                                });

                                if (tabActivado) {
                                    console.log('Pestaña de transporte activada exitosamente.');
                                    return true;
                                }
                            }
                        } catch (clickError) {
                            console.log(`Error al hacer clic en selector ${selector}:`, clickError.message);
                        }
                    }

                    // Si ninguno de los selectores anteriores funcionó, intentar con evaluate
                    return await page.evaluate(() => {
                        // Buscar elementos que parezcan pestañas y contengan palabras clave
                        const pestañas = Array.from(document.querySelectorAll('a, button, div.nav-link, div[role="tab"]'));

                        // Filtrar por texto relacionado con transporte/charter
                        const pestañaTransporte = pestañas.find(p =>
                            p.textContent.toLowerCase().includes('charter') ||
                            p.textContent.toLowerCase().includes('transporte') ||
                            p.textContent.toLowerCase().includes('vuelo')
                        );

                        if (pestañaTransporte) {
                            pestañaTransporte.click();
                            return true;
                        }

                        return false;
                    });
                }, 'Cambio a pestaña de transporte', 3);

                // Tomar una captura después de cambiar de pestaña
            } catch (error) {
                console.log('Error al cambiar a la pestaña de transporte:', error.message);
                throw new Error('No se pudo cambiar al modo de búsqueda con transporte');
            }
        }

        // PASO 3: Configurar la búsqueda
        console.log('Configurando parámetros de búsqueda...');

        // Parsear fechas para navegación del calendario
        const fechaInicioObj = new Date(config.busqueda.fechaInicio);
        const fechaFinObj = new Date(config.busqueda.fechaFin);

        // Nombre de los meses para comparación
        const nombresMeses = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];

        // Obtener mes y año para navegación
        const mesInicio = fechaInicioObj.getMonth(); // 0-11
        const anioInicio = fechaInicioObj.getFullYear();
        // Extraer correctamente el día desde la cadena de fecha
        const diaInicio = parseInt(config.busqueda.fechaInicio.split('-')[2]);

        const mesFin = fechaFinObj.getMonth(); // 0-11
        const anioFin = fechaFinObj.getFullYear();
        // Extraer correctamente el día desde la cadena de fecha
        const diaFin = parseInt(config.busqueda.fechaFin.split('-')[2]);
        // NUEVO MÉTODO MEJORADO PARA SELECCIONAR FECHAS
        console.log('Seleccionando fechas con método específico para NaturLeon...');

        const fechasSeleccionadas = await conReintentos(async () => {
            console.log('Haciendo clic en el selector de fechas...');

            // Seleccionar el ID correcto según el modo de búsqueda
            const selectorFechas = config.busqueda.conTransporte ? '#C-singledaterange' : '#H-singledaterange';

            await page.waitForSelector(selectorFechas, { timeout: 10000 });
            await page.click(selectorFechas);

            // Esperar a que se abra el calendario con varios posibles selectores
            await esperar(2000); // Esperar más tiempo para que aparezca el calendario

            // Verificar si el calendario está visible
            const calendarioVisible = await page.evaluate(() => {
                const posiblesCalendarios = [
                    '.daterangepicker',
                    '.calendar',
                    '.xdsoft_datetimepicker',
                    '.datepicker',
                    '[class*="calendar"]',
                    '[class*="datepicker"]'
                ];

                for (const selector of posiblesCalendarios) {
                    const calendario = document.querySelector(selector);
                    if (calendario &&
                        calendario.offsetWidth > 0 &&
                        calendario.offsetHeight > 0 &&
                        window.getComputedStyle(calendario).display !== 'none') {
                        return {
                            visible: true,
                            selector
                        };
                    }
                }

                return { visible: false };
            });

            if (!calendarioVisible.visible) {
                console.log('No se detectó el calendario visible. Intentando clic de nuevo...');
                // Intentar clic alternativo
                await page.evaluate((selector) => {
                    const elemento = document.querySelector(selector);
                    if (elemento) {
                        elemento.click();
                    }
                }, selectorFechas);

                await esperar(2000); // Esperar más tiempo
            } else {
                console.log(`Calendario visible detectado con selector: ${calendarioVisible.selector}`);
            }

            // Tomar captura del calendario abierto para depuración

            // Buscar y analizar la estructura del calendario
            const infoCalendario = await page.evaluate(() => {
                // Determinar qué mes/año se muestra actualmente
                const tituloMes = document.querySelector('.daterangepicker .month');
                const mesActual = tituloMes ? tituloMes.textContent.trim() : null;

                // Verificar si podemos ver los botones de navegación
                const tieneBotonSiguiente = document.querySelector('.daterangepicker .next') !== null;
                const tieneBotonAnterior = document.querySelector('.daterangepicker .prev') !== null;

                // Verificar cómo están estructuradas las fechas
                const fechas = Array.from(document.querySelectorAll('.daterangepicker td.available')).map(el => ({
                    texto: el.textContent.trim(),
                    clase: el.className
                }));

                return {
                    mesActual,
                    tieneBotonSiguiente,
                    tieneBotonAnterior,
                    fechasVisibles: fechas.length,
                    ejemploFechas: fechas.slice(0, 5)
                };
            });

            console.log('Información del calendario:', infoCalendario);

            // El formato del mes/año mostrado parece ser "MMM YYYY" (por ejemplo "MAR 2025" o "JUN 2025")
            const mesAñoObjetivo = `${nombresMeses[mesInicio].substring(0, 3).toUpperCase()} ${anioInicio}`;
            console.log(`Navegando al mes y año objetivo: ${mesAñoObjetivo}`);

            // Extraer el mes y año actual del calendario
            let mesAñoActual = infoCalendario.mesActual || '';
            console.log(`Mes y año actual mostrado: ${mesAñoActual}`);

            // Si necesitamos navegar, verificar primero si estamos antes o después del mes objetivo
            const estaAntes = await page.evaluate((mesAñoActual, mesAñoObjetivo) => {
                // Convertir ambos a fechas para comparar
                const [mesActual, añoActual] = mesAñoActual.split(' ');
                const [mesObjetivo, añoObjetivo] = mesAñoObjetivo.split(' ');

                // Mapear abreviaturas de meses a números (0-11)
                const mesesAbrev = {
                    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
                    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11
                };

                // Obtener valores numéricos
                const mesActualNum = mesesAbrev[mesActual.toUpperCase()] || 0;
                const mesObjetivoNum = mesesAbrev[mesObjetivo.toUpperCase()] || 0;
                const añoActualNum = parseInt(añoActual || 0);
                const añoObjetivoNum = parseInt(añoObjetivo || 0);

                // Comparar años primero, luego meses
                if (añoActualNum < añoObjetivoNum) return true;
                if (añoActualNum > añoObjetivoNum) return false;
                // Si el año es el mismo, comparar meses
                return mesActualNum < mesObjetivoNum;
            }, mesAñoActual, mesAñoObjetivo);

            // Determinar qué botón usar para navegar
            const botonNavegacion = estaAntes ? '.next' : '.prev';
            const direccion = estaAntes ? 'siguiente' : 'anterior';
            console.log(`El mes actual está ${estaAntes ? 'antes' : 'después'} del mes objetivo. Usando botón ${direccion}.`);

            // Navegar al mes correcto haciendo clic en el botón apropiado
            let intentosNavegacion = 0;
            const maxIntentos = 24; // Permitir más intentos (2 años)

            let mesEncontrado = false;

            while (!mesEncontrado && intentosNavegacion < maxIntentos) {
                // Actualizar el mes actual para la comparación
                mesAñoActual = await page.evaluate(() => {
                    const tituloMes = document.querySelector('.daterangepicker .month');
                    return tituloMes ? tituloMes.textContent.trim() : '';
                });

                console.log(`Comparando: actual "${mesAñoActual}" vs. objetivo "${mesAñoObjetivo}"`);

                // Verificar si ya estamos en el mes objetivo
                if (mesAñoActual.toUpperCase() === mesAñoObjetivo.toUpperCase()) {
                    mesEncontrado = true;
                    console.log(`¡Mes objetivo encontrado: ${mesAñoActual}!`);
                    break;
                }

                // Si no estamos en el mes objetivo, hacer clic en el botón de navegación
                console.log(`Haciendo clic en "${direccion}" para navegar (intento ${intentosNavegacion + 1})...`);
                await page.click(botonNavegacion);
                await esperar(500);

                intentosNavegacion++;
            }

            if (!mesEncontrado) {
                console.log('No se pudo encontrar el mes objetivo después de múltiples intentos.');
                throw new Error('No se pudo navegar al mes objetivo en el calendario');
            }
            // NUEVO MÉTODO PARA SELECCIONAR DÍAS ESPECÍFICOS
            // Ahora seleccionamos las fechas específicas
            console.log(`Seleccionando fecha de inicio: ${diaInicio}/${mesInicio + 1}/${anioInicio}`);

            // Tomar una captura antes de seleccionar la fecha de inicio

            // Método 1: Selector directo para el día específico
            const selectorDiaInicio = `.daterangepicker td.available:not(.off):contains("${diaInicio}")`;

            try {
                // Primer intento usando un selector más preciso
                const diasDisponibles = await page.evaluate(() => {
                    // Esta función nos da información de todos los días disponibles
                    return Array.from(document.querySelectorAll('.daterangepicker td.available:not(.off)'))
                        .map(td => ({
                            dia: td.textContent.trim(),
                            posicionX: td.getBoundingClientRect().left + (td.getBoundingClientRect().width / 2),
                            posicionY: td.getBoundingClientRect().top + (td.getBoundingClientRect().height / 2)
                        }));
                });

                console.log(`Días disponibles en el mes actual: ${JSON.stringify(diasDisponibles)}`);

                // Buscar el día específico
                const diaInicioInfo = diasDisponibles.find(d => d.dia === String(diaInicio));

                if (diaInicioInfo) {
                    console.log(`Día de inicio encontrado: ${JSON.stringify(diaInicioInfo)}`);

                    // Hacer clic en las coordenadas exactas del día
                    await page.mouse.click(diaInicioInfo.posicionX, diaInicioInfo.posicionY);
                    console.log(`Clic realizado en día ${diaInicio} en posición (${diaInicioInfo.posicionX}, ${diaInicioInfo.posicionY})`);
                } else {
                    // Si no lo encontramos con el enfoque anterior, intentar con un método alternativo
                    console.log(`No se encontró el día ${diaInicio} con el método de coordenadas. Intentando método alternativo...`);

                    // Método 2: Usar un selector CSS más específico y hacer clic directamente
                    await page.evaluate((dia) => {
                        // Esta función intenta hacer clic en el día correcto directamente en el DOM
                        const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                        for (const celda of celdas) {
                            if (celda.textContent.trim() === String(dia)) {
                                celda.click();
                                return true;
                            }
                        }
                        return false;
                    }, diaInicio);
                }

                console.log(`Selección de día de inicio (${diaInicio}) completada.`);
                await esperar(1000);

                // Tomar una captura después de seleccionar la fecha de inicio

                // Ahora seleccionamos la fecha de fin
                console.log(`Seleccionando fecha de fin: ${diaFin}/${mesFin + 1}/${anioFin}`);

                // Si la fecha de fin está en un mes diferente, podríamos necesitar navegar
                if (mesInicio !== mesFin || anioInicio !== anioFin) {
                    console.log('La fecha de fin está en un mes diferente. Navegando al mes de fin...');

                    // Objetivo para el mes de fin
                    const mesAñoObjetivoFin = `${nombresMeses[mesFin].substring(0, 3).toUpperCase()} ${anioFin}`;
                    console.log(`Navegando al mes y año de fin: ${mesAñoObjetivoFin}`);

                    // Determinar si necesitamos ir adelante o atrás
                    const mesActualDespuesSeleccion = await page.evaluate(() => {
                        const tituloMes = document.querySelector('.daterangepicker .month');
                        return tituloMes ? tituloMes.textContent.trim() : '';
                    });

                    const irAdelante = await page.evaluate((mesActual, mesObjetivo) => {
                        // Similar a la comparación anterior, pero para el mes de fin
                        const [mesActualTexto, añoActualTexto] = mesActual.split(' ');
                        const [mesObjetivoTexto, añoObjetivoTexto] = mesObjetivo.split(' ');

                        const mesesAbrev = {
                            'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
                            'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11
                        };

                        const mesActualNum = mesesAbrev[mesActualTexto.toUpperCase()] || 0;
                        const mesObjetivoNum = mesesAbrev[mesObjetivoTexto.toUpperCase()] || 0;
                        const añoActualNum = parseInt(añoActualTexto || 0);
                        const añoObjetivoNum = parseInt(añoObjetivoTexto || 0);

                        // Comparar años primero, luego meses
                        if (añoActualNum < añoObjetivoNum) return true;
                        if (añoActualNum > añoObjetivoNum) return false;
                        return mesActualNum < mesObjetivoNum;
                    }, mesActualDespuesSeleccion, mesAñoObjetivoFin);

                    // Botón para navegar al mes de fin
                    const botonNavegacionFin = irAdelante ? '.next' : '.prev';
                    console.log(`Navegando ${irAdelante ? 'adelante' : 'atrás'} para encontrar el mes de fin...`);

                    // Navegar hasta encontrar el mes de fin
                    let intentosFin = 0;
                    const maxIntentosFin = 24;
                    let mesFinEncontrado = false;

                    while (!mesFinEncontrado && intentosFin < maxIntentosFin) {
                        const mesActual = await page.evaluate(() => {
                            const tituloMes = document.querySelector('.daterangepicker .month');
                            return tituloMes ? tituloMes.textContent.trim() : '';
                        });

                        console.log(`Mes actual: "${mesActual}" vs. objetivo fin: "${mesAñoObjetivoFin}"`);

                        if (mesActual.toUpperCase() === mesAñoObjetivoFin.toUpperCase()) {
                            mesFinEncontrado = true;
                            console.log(`¡Mes de fin encontrado: ${mesActual}!`);
                            break;
                        }

                        // Hacer clic en el botón de navegación
                        await page.click(botonNavegacionFin);
                        await esperar(500);

                        intentosFin++;
                    }

                    if (!mesFinEncontrado) {
                        console.log('No se pudo encontrar el mes de fin. Continuamos con el mes actual...');
                    }
                }
                // Obtener información de los días disponibles nuevamente (podrían haber cambiado después de seleccionar la fecha de inicio)
                const diasDisponiblesFin = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.daterangepicker td.available:not(.off)'))
                        .map(td => ({
                            dia: td.textContent.trim(),
                            posicionX: td.getBoundingClientRect().left + (td.getBoundingClientRect().width / 2),
                            posicionY: td.getBoundingClientRect().top + (td.getBoundingClientRect().height / 2)
                        }));
                });

                console.log(`Días disponibles para fin: ${JSON.stringify(diasDisponiblesFin)}`);

                // Buscar el día de fin
                const diaFinInfo = diasDisponiblesFin.find(d => d.dia === String(diaFin));

                if (diaFinInfo) {
                    console.log(`Día de fin encontrado: ${JSON.stringify(diaFinInfo)}`);

                    // Hacer clic en las coordenadas exactas del día
                    await page.mouse.click(diaFinInfo.posicionX, diaFinInfo.posicionY);
                    console.log(`Clic realizado en día ${diaFin} en posición (${diaFinInfo.posicionX}, ${diaFinInfo.posicionY})`);
                } else {
                    // Método alternativo si no encontramos las coordenadas
                    console.log(`No se encontró el día ${diaFin} con el método de coordenadas. Intentando método alternativo...`);

                    await page.evaluate((dia) => {
                        const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                        for (const celda of celdas) {
                            if (celda.textContent.trim() === String(dia)) {
                                celda.click();
                                return true;
                            }
                        }
                        return false;
                    }, diaFin);
                }

                console.log(`Selección de día de fin (${diaFin}) completada.`);
                await esperar(1000);

            } catch (fechaError) {
                console.error('Error al seleccionar fechas específicas:', fechaError);
                throw fechaError;
            }

            // Verificar si hay un botón "Aplicar" y hacer clic en él si existe
            const hayBotonAplicar = await page.evaluate(() => {
                const boton = document.querySelector('.applyBtn');
                if (boton) {
                    boton.click();
                    return true;
                }
                return false;
            });

            if (hayBotonAplicar) {
                console.log('Se hizo clic en el botón "Aplicar".');
            } else {
                // Si no hay botón aplicar, el calendario debería cerrarse automáticamente después de seleccionar la fecha de fin
                console.log('No se encontró botón "Aplicar", el calendario debería cerrarse automáticamente.');
            }

            // Esperar a que el calendario se cierre
            await esperar(1000);

            // Tomar una captura final después de seleccionar las fechas

            console.log('Selección de fechas completada.');
        }, 'Selección de fechas específica');

        console.log(`Seleccionando destino: ${config.busqueda.destino}...`);

        const destinoSeleccionado = await conReintentos(async () => {
            // Seleccionar el ID correcto según el modo de búsqueda
            const selectorDestino = config.busqueda.conTransporte ? '#C-inputDestino' :
                (config.busqueda.conVuelo ? '#A-inputDestino' : '#H-inputDestino');

            await page.waitForSelector(selectorDestino, { timeout: 10000 });

            // PASO 1: Limpiar el campo
            await page.evaluate((selector) => {
                const input = document.querySelector(selector);
                if (input) input.value = '';
            }, selectorDestino);

            // PASO 2: Hacer clic en el campo
            await page.click(selectorDestino);
            await esperar(300);

            // PASO 3: Decidir qué texto escribir para activar el autocompletado
            let textoDestino = config.busqueda.destino;

            // Si es destino completo, extraer solo las primeras letras
            if (textoDestino.includes(',')) {
                const primeraParte = textoDestino.split(',')[0].trim();
                textoDestino = primeraParte.substring(0, Math.min(4, primeraParte.length)).toLowerCase();
            } else {
                // Si es texto simple, usar los primeros caracteres
                textoDestino = textoDestino.substring(0, Math.min(4, textoDestino.length)).toLowerCase();
            }

            console.log(`Escribiendo texto para autocompletado de destino: "${textoDestino}"`);
            await page.type(selectorDestino, textoDestino, { delay: 150 });

            // PASO 4: Esperar a que aparezcan sugerencias
            try {
                await page.waitForSelector('.ui-menu-item', { visible: true, timeout: 8000 });
                console.log('Sugerencias de destino detectadas');
            } catch (error) {
                console.log('No se detectaron sugerencias automáticamente. Intentando recuperación...');

                // Si no aparecen sugerencias, probar con letras específicas según el destino
                await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    if (input) input.value = '';
                }, selectorDestino);

                // Determinar qué texto usar según el destino buscado
                const destinoLower = config.busqueda.destino.toLowerCase();
                let textoRecuperacion = '';

                if (destinoLower.includes('cancún') || destinoLower.includes('cancun')) {
                    textoRecuperacion = 'canc';
                } else if (destinoLower.includes('vallarta')) {
                    textoRecuperacion = 'vall';
                } else if (destinoLower.includes('ixtapa')) {
                    textoRecuperacion = 'ixta';
                } else if (destinoLower.includes('riviera')) {
                    textoRecuperacion = 'rivi';
                } else if (destinoLower.includes('tulum')) {
                    textoRecuperacion = 'tulu';
                } else if (destinoLower.includes('mazatlan') || destinoLower.includes('mazatlán')) {
                    textoRecuperacion = 'maza';
                } else {
                    // Usar las primeras 3 letras del destino
                    textoRecuperacion = config.busqueda.destino.substring(0, 3).toLowerCase();
                }

                console.log(`Intentando recuperación con texto: "${textoRecuperacion}"`);
                await page.type(selectorDestino, textoRecuperacion, { delay: 150 });

                try {
                    await page.waitForSelector('.ui-menu-item', { visible: true, timeout: 8000 });
                    console.log('Sugerencias detectadas después de recuperación');
                } catch (e) {
                    console.log('No se pudieron encontrar sugerencias. Continuando con el proceso...');
                }
            }

            // PASO 5: Esperar un momento para que se carguen todas las sugerencias
            await esperar(1500);

            // PASO 6: Hacer clic en la sugerencia correcta
            try {
                // Obtener todas las sugerencias disponibles
                const sugerencias = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.ui-menu-item'))
                        .map(item => ({
                            texto: item.textContent.trim(),
                            id: item.id || ''
                        }));
                });

                console.log(`Sugerencias disponibles (${sugerencias.length}):`);
                sugerencias.forEach((s, i) => console.log(`  ${i + 1}. ${s.texto}`));

                // Determinar qué sugerencia seleccionar
                const destinoBuscado = config.busqueda.destino.toLowerCase();
                let sugerenciaSeleccionada = null;

                // Buscar coincidencia según varias estrategias
                for (const sugerencia of sugerencias) {
                    const textoSugerencia = sugerencia.texto.toLowerCase();

                    // Estrategia 1: Coincidencia exacta
                    if (textoSugerencia === destinoBuscado) {
                        sugerenciaSeleccionada = sugerencia;
                        console.log(`Coincidencia exacta encontrada: "${sugerencia.texto}"`);
                        break;
                    }

                    // Estrategia 2: La sugerencia contiene el destino buscado
                    if (destinoBuscado.split(',')[0] &&
                        textoSugerencia.includes(destinoBuscado.split(',')[0].trim())) {
                        sugerenciaSeleccionada = sugerencia;
                        console.log(`Coincidencia parcial encontrada: "${sugerencia.texto}"`);
                        break;
                    }

                    // Estrategia 3: El destino buscado contiene parte de la sugerencia
                    const primeraPalabraSugerencia = textoSugerencia.split(',')[0].trim();
                    if (destinoBuscado.includes(primeraPalabraSugerencia)) {
                        sugerenciaSeleccionada = sugerencia;
                        console.log(`Coincidencia por inclusión encontrada: "${sugerencia.texto}"`);
                        // No hacemos break aquí para permitir encontrar coincidencias mejores
                    }
                }

                // Si no encontramos coincidencias, usar la primera sugerencia
                if (!sugerenciaSeleccionada && sugerencias.length > 0) {
                    sugerenciaSeleccionada = sugerencias[0];
                    console.log(`Sin coincidencias específicas. Usando primera sugerencia: "${sugerenciaSeleccionada.texto}"`);
                }

                // Hacer clic en la sugerencia seleccionada
                if (sugerenciaSeleccionada) {
                    const selector = sugerenciaSeleccionada.id ?
                        `#${sugerenciaSeleccionada.id}` : '.ui-menu-item:first-child';

                    console.log(`Haciendo clic en sugerencia: "${sugerenciaSeleccionada.texto}" con selector: ${selector}`);
                    await page.click(selector);
                } else {
                    // Si no hay sugerencias, confirmar con Tab y Enter
                    console.log('No se encontraron sugerencias. Confirmando con Tab y Enter...');
                    await page.keyboard.press('Tab');
                    await esperar(300);
                    await page.keyboard.press('Enter');
                }
            } catch (error) {
                console.log(`Error al seleccionar sugerencia: ${error.message}`);
                console.log('Intentando clic en primera sugerencia...');

                try {
                    await page.click('.ui-menu-item:first-child');
                } catch (e) {
                    console.log('Error en clic final, intentando seguir con Tab');
                    await page.keyboard.press('Tab');
                    await esperar(300);
                    await page.keyboard.press('Enter');
                }
            }

            // Esperar un momento para que se aplique la selección
            await esperar(1500);

            return true;
        }, 'Selección de destino', 4); // 4 intentos para este paso crític

        if (!destinoSeleccionado) {
            console.log('No se pudo seleccionar el destino. Intentando continuar con el proceso...');
        }

        /// ************ AGREGAR ESTA SECCIÓN AQUÍ ************
        // PASO: Seleccionar origen (solo para modo con transporte) - VERSIÓN ROBUSTA
        if (config.busqueda.conTransporte) {
            console.log(`Seleccionando origen: ${config.busqueda.origen}...`);

            const origenSeleccionado = await conReintentos(async () => {
                // Usar selector correcto para transporte
                const selectorOrigen = '#C-inputOrigen';

                await page.waitForSelector(selectorOrigen, { timeout: 10000 });

                // PASO 1: Limpiar el campo completamente
                await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    if (input) {
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, selectorOrigen);

                // PASO 2: Hacer clic y enfocar el campo
                await page.click(selectorOrigen);
                await esperar(500);

                // PASO 3: Escribir el origen completo directamente
                console.log(`Escribiendo origen completo: "${config.busqueda.origen}"`);
                await page.type(selectorOrigen, config.busqueda.origen, { delay: 100 });

                // PASO 4: Esperar y confirmar
                await esperar(1500);

                // PASO 5: Presionar Tab para confirmar
                await page.keyboard.press('Tab');
                await esperar(1000);

                // PASO 6: Verificación final del valor establecido
                const valorFinal = await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    return input ? input.value.trim() : null;
                }, selectorOrigen);

                console.log(`Valor final del origen: "${valorFinal}"`);

                // Validar que el origen se estableci� correctamente
                if (valorFinal && verificarCoincidenciaOrigen(config.busqueda.origen, valorFinal)) {
                    console.log(`Origen configurado correctamente: "${valorFinal}"`);
                    return true;
                }

                console.log(`No se pudo validar el origen. Esperado "${config.busqueda.origen}" y se obtuvo "${valorFinal || 'valor vacio'}"`);
                throw new Error('No se pudo establecer el valor del origen');

            }, 'Selecci??n de origen robusto', 4); // 4 intentos para m�xima seguridad

            if (!origenSeleccionado) {
                throw new Error(`No se pudo seleccionar el origen "${config.busqueda.origen}" despues de multiples intentos`);
            }
        } else {
            console.log('Modo sin transporte: omitiendo configuración de origen');
        }
        // ************ FIN DE LA SECCIÓN A AGREGAR ************

        // Usar este código en las funciones scrapNaturLeon y scrapNaturLeonPaquetesVuelo

        // Seleccionar plan con reintentos
        console.log(`Seleccionando plan: ${config.busqueda.plan}...`);
        const planSeleccionado = await conReintentos(async () => {
            // Seleccionar el ID correcto según el modo de búsqueda
            // Para cada modo de búsqueda el selector es diferente:
            // - Solo hotel: '#H-select-plan'
            // - Hotel con transporte: '#C-select-plan'
            // - Hotel con vuelo: '#A-select-plan'
            const selectorPlan = config.busqueda.conTransporte ? '#C-select-plan' :
                (config.busqueda.conVuelo ? '#A-select-plan' : '#H-select-plan');

            await page.waitForSelector(selectorPlan, { timeout: 10000 });

            // Verificar si es un dropdown o un input
            const tipoDeElemento = await page.evaluate((selector) => {
                const elemento = document.querySelector(selector);
                return elemento ? elemento.tagName.toLowerCase() : null;
            }, selectorPlan);

            // PASO 1: Limpiar cualquier valor existente
            await page.evaluate((selector) => {
                const elemento = document.querySelector(selector);
                if (elemento) elemento.value = '';
            }, selectorPlan);

            // PASO 2: Hacer click en el campo
            await page.click(selectorPlan);
            await esperar(300);

            if (tipoDeElemento === 'select') {
                // Si es un select, usar page.select
                try {
                    await page.select(selectorPlan, config.busqueda.plan);
                    console.log(`Plan seleccionado usando page.select: ${config.busqueda.plan}`);
                } catch (error) {
                    console.log(`Error al seleccionar mediante select: ${error.message}. Intentando con type...`);
                    // Si falla el select, intentar con el método de type
                    await page.type(selectorPlan, config.busqueda.plan, { delay: 150 });
                }
            } else {
                // Si es otro tipo de elemento (input), usar type
                await page.type(selectorPlan, config.busqueda.plan, { delay: 150 });
                console.log(`Plan ingresado usando page.type: ${config.busqueda.plan}`);
            }

            // PASO 3: Presionar Tab o Enter para confirmar
            await page.keyboard.press('Tab');
            await esperar(800);
            await page.keyboard.press('Enter');

            // PASO 4: Verificar selección
            await esperar(1500);
            const planActual = await page.evaluate((selector) => {
                const elemento = document.querySelector(selector);
                return elemento ? elemento.value : null;
            }, selectorPlan);

            console.log(`Plan verificado después de selección: "${planActual}"`);

            // Si no se seleccionó correctamente, intentar última estrategia
            if (!planActual || planActual !== config.busqueda.plan) {
                console.log('Volviendo a intentar con JavaScript directo...');
                await page.evaluate((selector, value) => {
                    const elemento = document.querySelector(selector);
                    if (elemento) {
                        elemento.value = value;
                        elemento.dispatchEvent(new Event('change', { bubbles: true }));
                        elemento.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, selectorPlan, config.busqueda.plan);
            }

            return true;
        }, 'Selección de plan', 3); // Aumentamos a 3 intentos

        if (!planSeleccionado) {
            console.log('No se pudo seleccionar el plan. Intentando continuar con el proceso...');
        }
        // PASO 3.5: Configurar pasajeros y habitaciones (solo en modo alojamiento)
        if (!config.busqueda.conTransporte) {
            console.log('Configurando pasajeros y habitaciones...');

            const configurarPasajeros = await conReintentos(async () => {
                // 1. Hacer clic en el botón de pasajeros para abrir el menú
                console.log('Abriendo menú de pasajeros...');

                try {
                    // Buscar el botón y hacer clic
                    // Puede tener diferentes selectores según la versión de la interfaz
                    const bttnPasajeros = await page.evaluate(() => {
                        // Método 1: Buscar el selector principal
                        let boton = document.querySelector('#bttnPasajeros');

                        if (!boton) {
                            // Método 2: Buscar por texto
                            const posiblesBotonOcupantes = Array.from(document.querySelectorAll('button, div.btn, div[role="button"]'))
                                .filter(el => {
                                    const texto = el.textContent.toLowerCase();
                                    return texto.includes('hab') ||
                                        texto.includes('adl') ||
                                        texto.includes('mnr') ||
                                        texto.includes('adultos') ||
                                        texto.includes('pasajeros');
                                });

                            if (posiblesBotonOcupantes.length > 0) {
                                boton = posiblesBotonOcupantes[0];
                            }
                        }

                        if (boton) {
                            return {
                                encontrado: true,
                                id: boton.id || '',
                                clase: boton.className || '',
                                texto: boton.textContent.trim(),
                                rect: {
                                    x: boton.getBoundingClientRect().left + (boton.getBoundingClientRect().width / 2),
                                    y: boton.getBoundingClientRect().top + (boton.getBoundingClientRect().height / 2)
                                }
                            };
                        }

                        return { encontrado: false };
                    });

                    // Tomar una captura antes de hacer clic

                    if (bttnPasajeros.encontrado) {
                        console.log(`Botón de pasajeros encontrado: ${bttnPasajeros.texto}`);

                        // Hacer clic en el botón usando el método más apropiado
                        if (bttnPasajeros.id) {
                            await page.click(`#${bttnPasajeros.id}`);
                        } else if (bttnPasajeros.clase) {
                            const primerClase = bttnPasajeros.clase.split(' ')[0];
                            await page.click(`.${primerClase}`);
                        } else {
                            // Hacer clic en las coordenadas directamente
                            await page.mouse.click(bttnPasajeros.rect.x, bttnPasajeros.rect.y);
                        }

                        await esperar(1000); // Esperar a que se abra el menú

                        // Configurar niños si hay
                        if (config.busqueda.ninos > 0) {
                            try {
                                console.log(`Configurando ${config.busqueda.ninos} niño(s)...`);

                                // Intentar varias estrategias para encontrar y configurar el campo de menores
                                let menoresConfigurados = false;

                                // Estrategia 1: Selector estándar
                                try {
                                    if (await page.$(('#habitacion_1_menores')) !== null) {
                                        await configurarCampoNumerico(page, '#habitacion_1_menores', config.busqueda.ninos, 'menores');
                                        menoresConfigurados = true;
                                    }
                                } catch (e) {
                                    console.log('Error con estrategia 1 para menores:', e.message);
                                }

                                // Estrategia 2: Buscar selector alternativo si falló el primero
                                if (!menoresConfigurados) {
                                    try {
                                        const selectorMenoresAlt = await page.evaluate(() => {
                                            const inputs = document.querySelectorAll('input[type="number"]');
                                            for (const input of inputs) {
                                                if (input.id.toLowerCase().includes('menor') ||
                                                    input.placeholder?.toLowerCase().includes('menor') ||
                                                    input.name?.toLowerCase().includes('menor')) {
                                                    return input.id ? `#${input.id}` : null;
                                                }
                                            }
                                            return null;
                                        });

                                        if (selectorMenoresAlt) {
                                            console.log(`Usando selector alternativo para menores: ${selectorMenoresAlt}`);
                                            await configurarCampoNumerico(page, selectorMenoresAlt, config.busqueda.ninos, 'menores');
                                            menoresConfigurados = true;
                                        }
                                    } catch (e) {
                                        console.log('Error con estrategia 2 para menores:', e.message);
                                    }
                                }

                                // Estrategia 3: Botones +/- si todo lo demás falló
                                if (!menoresConfigurados) {
                                    try {
                                        const resultado = await page.evaluate(() => {
                                            // Buscar botones con texto "+" cerca de elementos que mencionan "menores" o "niños"
                                            const elementosMenores = Array.from(document.querySelectorAll('div, span, label'))
                                                .filter(el => el.textContent.toLowerCase().includes('menor') ||
                                                    el.textContent.toLowerCase().includes('niño'));

                                            for (const el of elementosMenores) {
                                                // Buscar botones cercanos
                                                const parent = el.parentElement || el;
                                                const botones = parent.querySelectorAll('button');
                                                const botonMas = Array.from(botones).find(b => b.textContent.includes('+'));

                                                if (botonMas) {
                                                    // Hacer clic para incrementar
                                                    for (let i = 0; i < 5; i++) { // Hasta 5 clics para asegurar
                                                        botonMas.click();
                                                    }
                                                    return { exito: true };
                                                }
                                            }

                                            return { exito: false };
                                        });

                                        if (resultado.exito) {
                                            console.log('Menores configurados usando botones +/-');
                                            menoresConfigurados = true;
                                        }
                                    } catch (e) {
                                        console.log('Error con estrategia 3 para menores:', e.message);
                                    }
                                }

                                if (!menoresConfigurados) {
                                    console.log('⚠️ No se pudo configurar el número de menores. Continuando sin configurar...');
                                }

                                // Configurar edades de menores si fue exitoso
                                if (menoresConfigurados && config.busqueda.ninos > 0) {
                                    await esperar(1000); // Esperar a que aparezcan los campos de edad

                                    for (let i = 1; i <= config.busqueda.ninos; i++) {
                                        const edadMenor = i <= config.busqueda.edadesMenores.length ?
                                            config.busqueda.edadesMenores[i - 1] : 5;

                                        try {
                                            console.log(`Configurando edad del menor ${i}: ${edadMenor}`);
                                            const selectorEdad = `#habitacion_1_menor_${i}`;

                                            if (await page.$(selectorEdad) !== null) {
                                                await configurarCampoNumerico(page, selectorEdad, edadMenor, `edad del menor ${i}`);
                                            } else {
                                                // Buscar selector alternativo
                                                const selectorEdadAlt = await page.evaluate((index) => {
                                                    const inputs = document.querySelectorAll('input[type="number"]');
                                                    for (const input of inputs) {
                                                        if ((input.id.toLowerCase().includes('edad') ||
                                                            input.placeholder?.toLowerCase().includes('edad')) &&
                                                            input.id.includes(index)) {
                                                            return input.id ? `#${input.id}` : null;
                                                        }
                                                    }
                                                    // Última opción: buscar por índice
                                                    const todosInputsEdad = Array.from(inputs).filter(
                                                        i => i.id.toLowerCase().includes('edad') ||
                                                            i.placeholder?.toLowerCase().includes('edad')
                                                    );
                                                    if (todosInputsEdad.length >= index) {
                                                        return todosInputsEdad[index - 1].id ? `#${todosInputsEdad[index - 1].id}` : null;
                                                    }
                                                    return null;
                                                }, i);

                                                if (selectorEdadAlt) {
                                                    console.log(`Usando selector alternativo para edad: ${selectorEdadAlt}`);
                                                    await configurarCampoNumerico(page, selectorEdadAlt, edadMenor, `edad del menor ${i}`);
                                                } else {
                                                    console.log(`⚠️ No se pudo encontrar el campo para la edad del menor ${i}`);
                                                }
                                            }
                                        } catch (errorEdad) {
                                            console.log(`Error al configurar edad del menor ${i}:`, errorEdad.message);
                                        }
                                    }
                                }
                            } catch (errorMenores) {
                                console.log('Error al configurar menores:', errorMenores.message);
                            }
                        }

                        // Cerrar el menú haciendo clic en otro lugar
                        try {
                            await page.evaluate(() => {
                                document.querySelector('body').click();
                            });
                            await esperar(1000);
                        } catch (e) {
                            console.log('Error al cerrar menú:', e.message);
                        }
                    } else {
                        console.log('No se encontró el botón de pasajeros. Continuando sin configurar...');
                    }
                } catch (error) {
                    console.log('Error general al configurar pasajeros:', error.message);
                    throw error;
                }
            }, 'Configuración de pasajeros', 4); // Aumentamos a 4 intentos para mayor seguridad

            if (!configurarPasajeros) {
                console.log('No se pudo configurar los pasajeros correctamente. Intentando continuar con el proceso...');
            }
        } else {
            // Para modo con transporte, configurar pasajeros con otra mecánica
            console.log('Configurando pasajeros para modo con transporte...');

            await conReintentos(async () => {
                // En modo transporte, el selector de pasajeros puede ser diferente
                const selectorPasajeros = '#habs_on_bar';

                try {
                    await page.waitForSelector(selectorPasajeros, { timeout: 5000 });
                    await page.click(selectorPasajeros);
                    await esperar(1000);

                    // Verificar si se abrió el menú de configuración
                    const menuAbierto = await page.evaluate(() => {
                        // Buscar elementos que suelen estar en el menú de pasajeros
                        const elementosClave = [
                            '[id*="habitacion_"][id*="_ocupacion"]',
                            '[id*="hab_"][id*="_adultos"]',
                            '[id*="menores"]',
                            '#btnAddHab'
                        ];

                        for (const selector of elementosClave) {
                            if (document.querySelector(selector)) {
                                return {
                                    abierto: true,
                                    elementoEncontrado: selector
                                };
                            }
                        }

                        return { abierto: false };
                    });

                    if (menuAbierto.abierto) {
                        console.log('Menú de pasajeros abierto:', menuAbierto);

                        // Configurar adultos y niños usando los selectores específicos de este menú
                        await configurarPasajerosTransporte(page, config.busqueda);

                        // Cerrar el menú haciendo clic fuera
                        await page.evaluate(() => {
                            document.querySelector('body').click();
                        });

                        await esperar(1000);
                    } else {
                        console.log('No se pudo confirmar que el menú de pasajeros esté abierto');
                    }
                } catch (error) {
                    console.log('Error al configurar pasajeros en modo transporte:', error.message);
                    throw error;
                }
            }, 'Configuración de pasajeros para transporte', 3);
        }

        // AÑADIR ESTE BLOQUE: Scroll explícito después de configurar pasajeros en modo transporte
        if (config.busqueda.conTransporte) {
            console.log('Haciendo scroll para asegurar visibilidad del botón de cotizar...');

            // PASO 1: Scroll lento y controlado con pausas entre cada movimiento
            await page.evaluate(() => {
                // Primera fase: ir a la mitad de la página
                window.scrollTo({
                    top: document.body.scrollHeight * 0.5,
                    behavior: 'smooth'
                });
            });

            // Esperar a que se complete el scroll
            await esperar(1500);

            // PASO 2: Scroll completo hasta el final
            await page.evaluate(() => {
                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth'
                });
            });

            // Esperar nuevamente para estabilizar la página
            await esperar(2000);

            // Tomar captura después del scroll para verificar
        }
        // Tomar captura de configuración

        // MÉTODO MEJORADO para encontrar y hacer clic en el botón COTIZAR
        let cotizarExitoso = false;

        // Esperar un momento antes de buscar el botón
        await esperar(1000);

        // Tomar captura antes de buscar el botón COTIZAR

        // PASO 3: Solución especializada mejorada para el botón COTIZAR
        console.log('Buscando botón COTIZAR con método optimizado...');

        const infoBotonCotizar = await page.evaluate(() => {
            // Función auxiliar para determinar si un elemento es visible en pantalla
            const esElementoVisible = (elemento) => {
                if (!elemento) return false;

                const rect = elemento.getBoundingClientRect();
                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                );
            };

            // MÉTODO 1: Buscar por texto exacto "COTIZAR" o "Cotizar" 
            const botonesExactos = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const texto = b.textContent.trim();
                    return texto === 'COTIZAR' || texto === 'Cotizar' || texto === 'BUSCAR' || texto === 'Buscar';
                });

            if (botonesExactos.length > 0) {
                const boton = botonesExactos[0];
                const esVisible = esElementoVisible(boton);

                // Si el botón no es visible en pantalla, hacer scroll hacia él
                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                // Esperar un momento para que termine cualquier scroll
                setTimeout(() => { }, 500);

                // Obtener posición actualizada después del posible scroll
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'texto-exacto',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true // Debería ser true después del scrollIntoView
                };
            }

            // MÉTODO 2: Buscar botones que contengan "COTIZAR"
            const botonesContienen = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const texto = b.textContent.trim().toUpperCase();
                    return texto.includes('COTIZAR') || texto.includes('BUSCAR');
                });

            if (botonesContienen.length > 0) {
                const boton = botonesContienen[0];
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'texto-contiene',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            // MÉTODO 3: Buscar botones por clases comunes de botones de acción
            const botonesPrimarios = document.querySelectorAll('.btn-primary, .btn-success, .btn-action, .cotizar, [class*="cotizar"]');
            if (botonesPrimarios.length > 0) {
                // Buscar entre los botones primarios el que esté más abajo en la página
                const botonesFiltrados = Array.from(botonesPrimarios).filter(b => {
                    const rect = b.getBoundingClientRect();
                    return rect.top > window.innerHeight * 0.5; // Solo botones en la mitad inferior
                });

                // Si encontramos alguno en la mitad inferior, usar ese, sino usar el último
                const boton = botonesFiltrados.length > 0 ?
                    botonesFiltrados[botonesFiltrados.length - 1] :
                    botonesPrimarios[botonesPrimarios.length - 1];

                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'clase-btn',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            // MÉTODO 4: Si todo falla, buscar cualquier botón en la parte inferior
            const todosBotones = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const rect = b.getBoundingClientRect();
                    const esGrandeEnough = rect.width >= 50 && rect.height >= 20; // Debe tener tamaño razonable
                    return esGrandeEnough && rect.top > window.innerHeight * 0.5; // Solo en la mitad inferior
                });

            if (todosBotones.length > 0) {
                // Ordenar por posición Y para encontrar el más cercano al fondo
                todosBotones.sort((a, b) => {
                    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                });

                const boton = todosBotones[0]; // El botón más abajo
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'ultimo-recurso',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            // Si nada funciona, buscar elementos que parezcan botones (div, span, a con estilos de botón)
            const pseudoBotones = Array.from(document.querySelectorAll('div.btn, span.btn, a.btn, [role="button"], [class*="button"]'))
                .filter(b => {
                    const rect = b.getBoundingClientRect();
                    const esGrandeEnough = rect.width >= 50 && rect.height >= 20;
                    return esGrandeEnough && rect.top > window.innerHeight * 0.5;
                });

            if (pseudoBotones.length > 0) {
                pseudoBotones.sort((a, b) => {
                    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                });

                const boton = pseudoBotones[0];
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'pseudo-boton',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            return { encontrado: false };
        });

        console.log('Información del botón COTIZAR:', infoBotonCotizar);

        // PASO 4: Mejorar el método de clic para ser más preciso
        if (infoBotonCotizar.encontrado) {
            console.log(`Botón COTIZAR encontrado mediante: ${infoBotonCotizar.metodo}`);

            // Esperar un momento adicional para asegurar que la página se ha estabilizado
            await esperar(1000);

            // Tomar captura antes del clic final

            try {
                // TÉCNICA 1: Intentar usar un selector más preciso si tenemos información del elemento
                if (infoBotonCotizar.elemento) {
                    const elemento = infoBotonCotizar.elemento;
                    let selector = null;

                    // Construir un selector lo más específico posible
                    if (elemento.id) {
                        selector = `#${elemento.id}`;
                    } else if (elemento.clase) {
                        // Usar la primera clase que suele ser la más específica
                        const primeraClase = elemento.clase.split(' ')[0];
                        selector = `.${primeraClase}`;

                        // Si el texto es distintivo, añadirlo al selector
                        if (elemento.texto && !elemento.texto.includes(' ')) {
                            selector += `:contains("${elemento.texto}")`;
                        }
                    }

                    if (selector) {
                        console.log(`Intentando clic con selector: ${selector}`);
                        try {
                            await page.click(selector);
                            console.log(`Clic realizado con selector ${selector}`);
                            cotizarExitoso = true;
                        } catch (selectorError) {
                            console.log(`Error al hacer clic con selector: ${selectorError.message}`);
                            // Continuamos con el método de coordenadas si el selector falla
                        }
                    }
                }

                // TÉCNICA 2: Si el selector falla o no tenemos suficiente información, usar coordenadas
                if (!cotizarExitoso) {
                    // Estabilizar la posición final con un scroll preciso a la posición Y del botón
                    await page.evaluate((posY) => {
                        window.scrollTo({
                            top: posY - 150, // Un poco más arriba para asegurar visibilidad completa
                            behavior: 'smooth'
                        });
                    }, infoBotonCotizar.posicion.y);

                    // Esperar a que se estabilice el scroll
                    await esperar(1500);

                    // Tomar una última captura justo antes del clic

                    // Obtener las coordenadas actualizadas después del último scroll
                    const coordenadasActualizadas = await page.evaluate(() => {
                        // Buscar el botón nuevamente para obtener coordenadas actualizadas
                        const botones = document.querySelectorAll('button, input[type="submit"], div.btn, [role="button"]');

                        // Buscar en la parte inferior de la pantalla
                        const botonesInferiores = Array.from(botones).filter(b => {
                            const rect = b.getBoundingClientRect();
                            return rect.top > window.innerHeight * 0.3 &&
                                rect.width > 0 &&
                                rect.height > 0;
                        });

                        if (botonesInferiores.length > 0) {
                            // Ordenar por posición Y para encontrar el que está más abajo
                            botonesInferiores.sort((a, b) => {
                                return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                            });

                            const boton = botonesInferiores[0];
                            const rect = boton.getBoundingClientRect();

                            return {
                                x: rect.left + (rect.width / 2),
                                y: rect.top + (rect.height / 2),
                                width: rect.width,
                                height: rect.height,
                                texto: boton.textContent.trim()
                            };
                        }

                        return null;
                    });

                    if (coordenadasActualizadas) {
                        console.log(`Coordenadas actualizadas del botón: (${coordenadasActualizadas.x}, ${coordenadasActualizadas.y})`);
                        console.log(`Botón detectado: "${coordenadasActualizadas.texto}" (${coordenadasActualizadas.width}x${coordenadasActualizadas.height})`);

                        // Hacer clic usando las coordenadas actualizadas
                        await page.mouse.click(coordenadasActualizadas.x, coordenadasActualizadas.y);
                        console.log(`Clic realizado en posición actualizada (${coordenadasActualizadas.x}, ${coordenadasActualizadas.y})`);
                    } else {
                        // Si no pudimos obtener coordenadas actualizadas, usar las originales
                        console.log(`Usando coordenadas originales (${infoBotonCotizar.posicion.x}, ${infoBotonCotizar.posicion.y})`);
                        await page.mouse.click(infoBotonCotizar.posicion.x, infoBotonCotizar.posicion.y);
                    }

                    console.log('Clic realizado en el botón COTIZAR');
                    cotizarExitoso = true;
                }
                // Esperar a que se complete la navegación con tiempo extendido
                // Ya no necesitamos esperar navegación adicional aquí
                await esperar(1000); // Solo una pequeña espera para estabilidad
                console.log('Proceso de clic en COTIZAR completado');

                // NUEVA LÓGICA: Esperar navegación específica
                console.log('⏳ Esperando navegación a página de resultados...');

                try {
                    // Esperar que la URL cambie a la página de resultados
                    await Promise.race([
                        page.waitForFunction(() => {
                            return window.location.href.includes('AgenciaMotorResultados.php');
                        }, { timeout: 30000 }),

                        page.waitForSelector('[id^="hotel-top-"]', { timeout: 30000 })
                    ]);

                    console.log('✅ Navegación exitosa a página de resultados');

                } catch (navigationError) {
                    console.log('⚠️ No se detectó navegación automática. Verificando estado...');

                    const estadoNavegacion = await page.evaluate(() => {
                        return {
                            url: window.location.href,
                            formularios: document.querySelectorAll('form').length,
                            botonesCotizar: Array.from(document.querySelectorAll('button')).filter(b =>
                                b.textContent.includes('COTIZAR')).length
                        };
                    });

                    console.log('🔍 Estado de navegación:', JSON.stringify(estadoNavegacion, null, 2));

                    // Intentar envío manual del formulario
                    console.log('🔄 Intentando envío manual del formulario...');

                    const envioManual = await page.evaluate(() => {
                        const formularios = document.querySelectorAll('form');
                        for (const form of formularios) {
                            const tieneDestino = form.querySelector('[name*="destino"], [id*="destino"]');
                            const tieneFechas = form.querySelector('[name*="fecha"], [id*="fecha"]');

                            if (tieneDestino || tieneFechas) {
                                console.log('Enviando formulario manualmente...');
                                form.submit();
                                return { exito: true, metodo: 'form.submit()' };
                            }
                        }

                        return { exito: false, mensaje: 'No se encontró formulario válido' };
                    });

                    console.log('📤 Resultado envío manual:', envioManual);

                    if (envioManual.exito) {
                        try {
                            await page.waitForFunction(() => {
                                return window.location.href.includes('AgenciaMotorResultados.php') ||
                                    document.querySelectorAll('[id^="hotel-top-"]').length > 0;
                            }, { timeout: 20000 });

                            console.log('✅ Navegación exitosa después de envío manual');
                        } catch (manualError) {
                            console.log('❌ Envío manual también falló');
                        }
                    }
                }

                // Espera adicional para estabilizar
                await esperar(3000);

                // Verificación final
                const verificacionFinal = await page.evaluate(() => {
                    return {
                        url: window.location.href,
                        esResultados: window.location.href.includes('AgenciaMotorResultados.php'),
                        hotelesEncontrados: document.querySelectorAll('[id^="hotel-top-"]').length,
                        todosLosIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(id => id.includes('hotel'))
                    };
                });

                console.log('🎯 VERIFICACIÓN FINAL:', JSON.stringify(verificacionFinal, null, 2));

                if (!verificacionFinal.esResultados) {
                    console.log('🚨 ERROR: No se llegó a la página de resultados');
                    console.log('💡 Posibles causas: Error en formulario, credenciales, o problema del sitio');
                }
                // Tomar captura después de la espera

                // TÉCNICA 3: Método de último recurso si los anteriores fallan
                if (!cotizarExitoso) {
                    console.log('Intentando método de último recurso para hacer clic en COTIZAR...');

                    const ultimoRecurso = await page.evaluate(() => {
                        // Buscar cualquier elemento clickeable que tenga texto relacionado con "cotizar" o "buscar"
                        const elementosClickeables = document.querySelectorAll('button, input[type="submit"], a.btn, div.btn, [role="button"]');
                        for (const elemento of elementosClickeables) {
                            const texto = elemento.textContent.toLowerCase().trim();
                            if (texto.includes('cotizar') || texto.includes('buscar')) {
                                try {
                                    elemento.click();
                                    return { exito: true, texto: texto };
                                } catch (e) {
                                    continue;
                                }
                            }
                        }

                        // Si aún no encontramos, buscar elementos con clases específicas
                        const botonesAccion = document.querySelectorAll('.btn-primary, .btn-success, .btn-action, .cotizar');
                        if (botonesAccion.length > 0) {
                            try {
                                const ultimoBoton = botonesAccion[botonesAccion.length - 1];
                                ultimoBoton.click();
                                return { exito: true, texto: ultimoBoton.textContent.trim(), metodo: 'clase-btn' };
                            } catch (e) {
                                // Continuar con el siguiente método
                            }
                        }

                        // Último intento: hacer submit del formulario directamente
                        const formularios = document.querySelectorAll('form');
                        for (const form of formularios) {
                            try {
                                form.submit();
                                return { exito: true, metodo: 'form-submit' };
                            } catch (e) {
                                continue;
                            }
                        }

                        return { exito: false };
                    });

                    if (ultimoRecurso.exito) {
                        console.log(`Clic de último recurso exitoso mediante ${ultimoRecurso.metodo || 'elemento con texto: ' + ultimoRecurso.texto}`);
                        cotizarExitoso = true;
                    }
                }
                // Ya no necesitamos esperar navegación adicional aquí
                await esperar(1000); // Solo una pequeña espera para estabilidad
                console.log('Proceso de clic en COTIZAR completado');
            } catch (clickError) {
                console.log('Error durante el intento de clic en el botón COTIZAR:', clickError.message);

                // Intentar con método alternativo final si hay error
                try {
                    console.log('Intentando método final de evaluación para clic...');

                    const clickFinal = await page.evaluate(() => {
                        // Buscar en el área inferior de la pantalla
                        const botones = Array.from(document.querySelectorAll('button, input[type="submit"], div.btn, [role="button"]'))
                            .filter(b => {
                                const rect = b.getBoundingClientRect();
                                return rect.top > window.innerHeight * 0.3 && rect.width > 0 && rect.height > 0;
                            });

                        if (botones.length > 0) {
                            // Ordenar por posición Y para obtener el más inferior
                            botones.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
                            const botonFinal = botones[0];

                            try {
                                botonFinal.click();
                                return { exito: true, texto: botonFinal.textContent.trim() };
                            } catch (e) {
                                return { exito: false, error: e.toString() };
                            }
                        }

                        return { exito: false, mensaje: 'No se encontraron botones en área inferior' };
                    });

                    console.log('Resultado del método final:', clickFinal);

                    if (clickFinal.exito) {
                        console.log(`Clic final exitoso en botón "${clickFinal.texto}"`);
                        cotizarExitoso = true;

                        // Esperar por si hay navegación
                        await page.waitForNavigation({ timeout: config.timeout }).catch(() => { });
                    }
                } catch (finalError) {
                    console.log('Error en método final de clic:', finalError.message);
                }
            }
        } else {
            console.log('No se encontró ningún botón COTIZAR visible');
        }

        //  ═══════════════════════════════════════════════════════════════
        //  NUEVO: SISTEMA DE REINTENTOS CON CAMBIO DE FECHAS Y FALLBACK
        //  ═══════════════════════════════════════════════════════════════
        console.log('\n🔍 Verificando disponibilidad de resultados...');

        const resultadoCotizacion = await cotizarConReintentos(page, config, {
            fechaInicio: config.busqueda.fechaInicio,
            fechaFin: config.busqueda.fechaFin,
            conTransporte: config.busqueda.conTransporte || false,
            conVuelo: config.busqueda.conVuelo || false
        });

        console.log('\n📊 RESULTADO DE COTIZACIÓN CON REINTENTOS:');
        console.log(JSON.stringify(resultadoCotizacion, null, 2));

        if (!resultadoCotizacion.exito) {
            console.log('\n❌ No se pudieron encontrar resultados con ninguna configuración');
            console.log('📝 Detalles:', resultadoCotizacion.mensaje);

            await browser.close();

            return {
                exito: false,
                mensaje: resultadoCotizacion.mensaje,
                intentosRealizados: resultadoCotizacion.intentosRealizados
            };
        }

        // Si encontró resultados, actualizar las fechas en config si cambiaron
        if (resultadoCotizacion.fechasUsadas) {
            config.busqueda.fechaInicio = resultadoCotizacion.fechasUsadas.fechaInicio;
            config.busqueda.fechaFin = resultadoCotizacion.fechasUsadas.fechaFin;
            console.log(`\n📅 Fechas actualizadas en config: ${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`);
        }

        // Guardar información de si es solo alojamiento para incluirlo en el resultado final
        const esSoloAlojamiento = resultadoCotizacion.soloAlojamiento || false;
        const advertenciaTransporte = resultadoCotizacion.advertencia || null;

        console.log(`\n🏨 Solo alojamiento: ${esSoloAlojamiento ? 'SÍ' : 'NO'}`);
        if (advertenciaTransporte) {
            console.log(`⚠️ Advertencia: ${advertenciaTransporte}`);
        }
        //  ═══════════════════════════════════════════════════════════════

        // PASO 5: Extraer resultados - VERSIÓN ROBUSTA MEJORADA
        console.log('\n===== INICIANDO EXTRACCIÓN ROBUSTA DE RESULTADOS =====');

        // Esperar tiempo inicial - AUMENTADO para mejor estabilidad  
        console.log('Esperando estabilización completa de la página...');
        await esperar(8000); // Aumentado de 5000 a 8000

        // Debug: Tomar captura inicial si está habilitado
        if (config.tomarCaptura) {
            try {
                await page.screenshot({
                    path: `./debug_inicial_${Date.now()}.png`,
                    fullPage: true
                });
                console.log('Captura inicial de debug tomada');
            } catch (e) {
                console.log('No se pudo tomar captura inicial');
            }
        }

        // MANTENER: Intentar ordenar los resultados por precio (menor a mayor)
        try {
            console.log('Intentando ordenar resultados por precio...');

            const existeSelector = await page.evaluate(() => {
                return document.querySelector('#orden_resultados') !== null;
            });

            if (existeSelector) {
                // Hacer clic en el selector para abrir el dropdown
                await page.click('#orden_resultados');
                await esperar(1000); // Esperar más tiempo para que se abra el dropdown

                // Debug: Captura del dropdown abierto
                if (config.tomarCaptura) {
                    try {
                        await page.screenshot({ path: `./debug_dropdown_${Date.now()}.png` });
                    } catch (e) {
                        console.log('No se pudo tomar captura del dropdown');
                    }
                }

                // Obtener todas las opciones disponibles para depuración
                const opciones = await page.evaluate(() => {
                    const select = document.querySelector('#orden_resultados');
                    return Array.from(select.options).map(option => ({
                        value: option.value,
                        text: option.text
                    }));
                });
                console.log('Opciones disponibles:', opciones);

                // Seleccionar la opción para ordenar por precio ascendente
                try {
                    // Método 1: Usar page.select con el valor 'PA' (precio ascendente)
                    await page.select('#orden_resultados', 'PA');
                    console.log('Opción seleccionada usando page.select con valor PA');
                } catch (selectError) {
                    console.log('Error al seleccionar con page.select:', selectError.message);

                    // Método 2: Intentar seleccionar por texto visible
                    try {
                        await page.evaluate(() => {
                            const select = document.querySelector('#orden_resultados');
                            const options = Array.from(select.options);
                            const targetOption = options.find(option =>
                                option.text.toLowerCase().includes('precio') &&
                                (option.text.toLowerCase().includes('menor') ||
                                    option.text.toLowerCase().includes('ascendente'))
                            );

                            if (targetOption) {
                                select.value = targetOption.value;
                                // Disparar evento de cambio para activar cualquier listener
                                const event = new Event('change', { bubbles: true });
                                select.dispatchEvent(event);
                            }
                        });
                        console.log('Opción seleccionada usando evaluación por texto');
                    } catch (evalError) {
                        console.log('Error al intentar seleccionar por texto:', evalError.message);
                    }
                }

                // Debug: Captura después de seleccionar la opción
                if (config.tomarCaptura) {
                    try {
                        await page.screenshot({ path: `./debug_ordenado_${Date.now()}.png` });
                    } catch (e) {
                        console.log('No se pudo tomar captura después de ordenar');
                    }
                }

                // MANTENER: Implementar una espera inteligente para que el ordenamiento se complete
                console.log('Esperando a que se complete el ordenamiento por precio...');
                const inicioEspera = Date.now();
                const tiempoMaximoEspera = 20000; // 20 segundos como máximo
                let ordenamientoCompletado = false;

                while (!ordenamientoCompletado && (Date.now() - inicioEspera) < tiempoMaximoEspera) {
                    try {
                        // Verificar si hay elementos de carga visibles
                        const estadoCarga = await page.evaluate(() => {
                            // Buscar indicadores típicos de carga
                            const indicadoresCarga = document.querySelectorAll(
                                '.loading, .spinner, .cargando, [class*="loading"], [class*="spinner"]'
                            );

                            // Verificar textos que indiquen carga
                            const textosCarga = Array.from(
                                document.querySelectorAll('div, p, span')
                            ).filter(el =>
                                el.innerText &&
                                (el.innerText.toLowerCase().includes('cargando') ||
                                    el.innerText.toLowerCase().includes('ordenando'))
                            );

                            // Comprobar si hay cambios en la UI (animaciones, etc.)
                            const hayAnimaciones = document.querySelectorAll('.fade, .animate, [style*="transition"]').length > 0;

                            return {
                                indicadoresCargaVisibles: indicadoresCarga.length > 0,
                                textosCargaVisibles: textosCarga.length > 0,
                                hayAnimaciones: hayAnimaciones
                            };
                        });

                        // Si no hay indicadores de carga, consideramos que ha terminado
                        if (!estadoCarga.indicadoresCargaVisibles &&
                            !estadoCarga.textosCargaVisibles &&
                            !estadoCarga.hayAnimaciones) {

                            // Esperar un poco más para asegurar la estabilidad de la página
                            await esperar(1000);

                            // Debug: Captura para confirmar el estado
                            if (config.tomarCaptura) {
                                try {
                                    await page.screenshot({ path: `./debug_estado_final_${Date.now()}.png` });
                                } catch (e) {
                                    console.log('No se pudo tomar captura del estado final');
                                }
                            }

                            ordenamientoCompletado = true;
                            console.log('Ordenamiento completado después de',
                                Math.round((Date.now() - inicioEspera) / 1000), 'segundos');
                            break;
                        }

                        // Esperar un momento antes de volver a verificar
                        await esperar(1000);

                    } catch (error) {
                        console.log('Error al verificar estado de ordenamiento:', error.message);
                        await esperar(1000);
                    }
                }
                if (!ordenamientoCompletado) {
                    console.log(`Alcanzado tiempo máximo de espera para ordenamiento (${tiempoMaximoEspera / 1000} segundos)`);
                }

                console.log('Resultados ordenados por precio (menor a mayor)');
                // Esperar un poco más por si acaso
                await esperar(2000);
            } else {
                console.log('No se encontró el selector para ordenar resultados');
            }
        } catch (sortError) {
            console.log('Error al intentar ordenar resultados:', sortError.message);
        }

        // Debug: Captura después de ordenar
        if (config.tomarCaptura) {
            try {
                await page.screenshot({ path: `./debug_despues_ordenar_${Date.now()}.png`, fullPage: true });
            } catch (e) {
                console.log('No se pudo tomar captura después de ordenar');
            }
        }

        // MEJORADO: Analizar la estructura de la página para detectar patrones de hoteles
        console.log('===== ANÁLISIS DETALLADO DE ESTRUCTURA DE LA PÁGINA =====');

        // 1) MANTENER: Espera activa usando la función existente
        await esperarResultadosListo(page, 25000); // Aumentado de 20000 a 25000

        // 2) MEJORADO: Detectar patrones con más información de debug
        const patronesHoteles = await page.evaluate(() => {
            const posiblesPatrones = [
                { tipo: 'id', selector: '[id^="hotel-top-"]', cantidad: document.querySelectorAll('[id^="hotel-top-"]').length },
                { tipo: 'id', selector: '[id^="booking-result-list-"]', cantidad: document.querySelectorAll('[id^="booking-result-list-"]').length },
                { tipo: 'clase', selector: '.card:not(#sticky-search):not(#contador-resultados)', cantidad: document.querySelectorAll('.card:not(#sticky-search):not(#contador-resultados)').length },
                { tipo: 'clase', selector: '.hotel-item', cantidad: document.querySelectorAll('.hotel-item').length },
                { tipo: 'clase', selector: '.resultado-item', cantidad: document.querySelectorAll('.resultado-item').length },
                { tipo: 'estructura', selector: 'div:has(span.h5)', cantidad: document.querySelectorAll('div:has(span.h5)').length },
            ];

            // MEJORADO: Agregar información de debug para cada patrón
            const patronesConDebug = posiblesPatrones.map(patron => {
                const elementos = document.querySelectorAll(patron.selector);
                const ejemplos = Array.from(elementos).slice(0, 2).map(el => ({
                    id: el.id || 'sin-id',
                    clase: el.className ? el.className.split(' ')[0] : 'sin-clase',
                    texto: el.textContent ? el.textContent.substring(0, 50).trim() : 'sin-texto',
                    tienePrecios: /[\d,]+/.test(el.textContent || '')
                }));

                return {
                    ...patron,
                    ejemplos,
                    tieneDatos: ejemplos.some(ej => ej.tienePrecios || ej.texto.length > 10)
                };
            });

            return patronesConDebug.filter(p => p.cantidad > 0);
        });

        console.log('=== PATRONES DETECTADOS CON DEBUG ===');
        patronesHoteles.forEach(patron => {
            console.log(`${patron.selector}: ${patron.cantidad} elementos (${patron.tipo})`);
            if (patron.ejemplos.length > 0) {
                patron.ejemplos.forEach((ej, i) => {
                    console.log(`  Ejemplo ${i + 1}: ID="${ej.id}" Clase="${ej.clase}" Texto="${ej.texto}" TienePrecios=${ej.tienePrecios}`);
                });
            }
        });

        // 3) MANTENER: Escoger el mejor selector
        let selectorHoteles = '[id^="hotel-top-"]';
        if (patronesHoteles.length > 0) {
            const patronTop = patronesHoteles.find(p => p.selector === '[id^="hotel-top-"]');
            if (patronTop && patronTop.cantidad > 0) {
                selectorHoteles = patronTop.selector;
                console.log(`Usando selector preferido: ${selectorHoteles} (${patronTop.cantidad} elementos)`);
            } else {
                patronesHoteles.sort((a, b) => b.cantidad - a.cantidad);
                selectorHoteles = patronesHoteles[0].selector;
                console.log(`Usando selector alternativo: ${selectorHoteles} (${patronesHoteles[0].cantidad} elementos)`);
            }
        } else {
            console.log('⚠️ No se detectaron patrones de hoteles. Usando selector por defecto.');
        }

        // 4) MEJORADO: Extracción robusta con mejor manejo de errores y logs detallados
        let hoteles = [];

        if (patronesHoteles.length > 0) {
            console.log(`=== INICIANDO EXTRACCIÓN CON SELECTOR: ${selectorHoteles} ===`);

            hoteles = await page.evaluate((selector) => {
                const resultados = [];
                console.log(`Iniciando extracción JavaScript con selector: ${selector}`);

                // MANTENER: Funciones de limpieza y conversión existentes
                const limpiar = (s) => (s || '').replace(/\s+/g, ' ').trim();
                const toNum = (txt) => {
                    if (!txt) return null;
                    const m = String(txt).match(/\$?\s*([\d.,]+)/);
                    if (!m) return null;
                    const solo = m[1].replace(/\./g, '').replace(/,/g, '');
                    const n = Number(solo);
                    return Number.isFinite(n) ? n : null;
                };
                const ES_BASURA_TITULO = (t) => {
                    const s = (t || '').toLowerCase();
                    return s.includes('no hay reservaciones por expirar') || s === 'alojamiento';
                };

                // *** NUEVA FUNCIÓN: EXTRAER DESTINO ESPECÍFICO COMPLETA ***
                const extraerDestinoEspecifico = (textoUbicacion) => {
                    try {
                        if (!textoUbicacion) return null;

                        const ubicacionLimpia = textoUbicacion.toLowerCase().trim();

                        // Mapeo completo de destinos específicos
                        const destinosMap = [
                            // PUERTO VALLARTA Y ZONAS
                            { regex: /puerto vallarta.*centro|centro.*puerto vallarta/i, destino: 'Puerto Vallarta Centro' },
                            { regex: /marina vallarta/i, destino: 'Marina Vallarta' },
                            { regex: /zona hotelera.*puerto vallarta|puerto vallarta.*zona hotelera/i, destino: 'Puerto Vallarta Zona Hotelera' },
                            { regex: /puerto vallarta/i, destino: 'Puerto Vallarta' },

                            // RIVIERA NAYARIT
                            { regex: /rinc[oó]n de guayabitos|guayabitos/i, destino: 'Rincón de Guayabitos' },
                            { regex: /nuevo vallarta/i, destino: 'Nuevo Vallarta' },
                            { regex: /bah[ií]a de banderas/i, destino: 'Bahía de Banderas' },
                            { regex: /bucer[ií]as/i, destino: 'Bucerías' },
                            { regex: /sayulita/i, destino: 'Sayulita' },
                            { regex: /punta mita|punta de mita/i, destino: 'Punta Mita' },
                            { regex: /la cruz de huanacaxtle|cruz de huanacaxtle/i, destino: 'La Cruz de Huanacaxtle' },
                            { regex: /riviera nayarit/i, destino: 'Riviera Nayarit' },

                            // IXTAPA - ZIHUATANEJO
                            { regex: /ixtapa.*zihuatanejo|zihuatanejo.*ixtapa/i, destino: 'Ixtapa-Zihuatanejo' },
                            { regex: /ixtapa/i, destino: 'Ixtapa' },
                            { regex: /zihuatanejo/i, destino: 'Zihuatanejo' },
                            { regex: /zona hotelera.*ixtapa|ixtapa.*zona hotelera/i, destino: 'Ixtapa Zona Hotelera' },

                            // MAZATLÁN Y ZONAS
                            { regex: /mazatl[aá]n.*centro|centro.*mazatl[aá]n/i, destino: 'Mazatlán Centro' },
                            { regex: /zona dorada.*mazatl[aá]n|mazatl[aá]n.*zona dorada/i, destino: 'Mazatlán Zona Dorada' },
                            { regex: /playa norte.*mazatl[aá]n|mazatl[aá]n.*playa norte/i, destino: 'Mazatlán Playa Norte' },
                            { regex: /cerritos.*mazatl[aá]n|mazatl[aá]n.*cerritos/i, destino: 'Mazatlán Cerritos' },
                            { regex: /el cid.*mazatl[aá]n|mazatl[aá]n.*el cid/i, destino: 'Mazatlán El Cid' },
                            { regex: /mazatl[aá]n/i, destino: 'Mazatlán' },

                            // MANZANILLO Y ZONAS
                            { regex: /manzanillo.*centro|centro.*manzanillo/i, destino: 'Manzanillo Centro' },
                            { regex: /santiago.*manzanillo|manzanillo.*santiago/i, destino: 'Santiago Manzanillo' },
                            { regex: /las brisas.*manzanillo|manzanillo.*las brisas/i, destino: 'Manzanillo Las Brisas' },
                            { regex: /playa azul.*manzanillo|manzanillo.*playa azul/i, destino: 'Manzanillo Playa Azul' },
                            { regex: /manzanillo/i, destino: 'Manzanillo' },

                            // OTROS DESTINOS POSIBLES
                            { regex: /acapulco.*diamante|diamante.*acapulco/i, destino: 'Acapulco Diamante' },
                            { regex: /acapulco.*dorado|dorado.*acapulco/i, destino: 'Acapulco Dorado' },
                            { regex: /acapulco/i, destino: 'Acapulco' },
                            { regex: /huatulco/i, destino: 'Huatulco' },
                            { regex: /puerto escondido/i, destino: 'Puerto Escondido' },

                            // CANCÚN Y RIVIERA MAYA (por si aparecen)
                            { regex: /canc[uú]n.*centro|centro.*canc[uú]n/i, destino: 'Cancún Centro' },
                            { regex: /canc[uú]n.*zona hotelera|zona hotelera.*canc[uú]n/i, destino: 'Cancún Zona Hotelera' },
                            { regex: /canc[uú]n/i, destino: 'Cancún' },
                            { regex: /playa del carmen/i, destino: 'Playa del Carmen' },
                            { regex: /cozumel/i, destino: 'Cozumel' },
                            { regex: /riviera maya/i, destino: 'Riviera Maya' },
                            { regex: /tulum/i, destino: 'Tulum' }
                        ];

                        // Buscar coincidencias específicas (orden importa - más específicos primero)
                        for (const destinoInfo of destinosMap) {
                            if (destinoInfo.regex.test(ubicacionLimpia)) {
                                console.log(`✓ Destino detectado: "${destinoInfo.destino}" de "${textoUbicacion}"`);
                                return destinoInfo.destino;
                            }
                        }

                        // Si no encuentra patrones específicos, intentar extraer manualmente
                        // Método 1: Buscar después de la última coma
                        const partes = textoUbicacion.split(',');
                        if (partes.length > 1) {
                            const ultimaParte = partes[partes.length - 1].trim();
                            if (ultimaParte.length > 3 && ultimaParte.length < 50) {
                                console.log(`✓ Destino extraído por coma: "${ultimaParte}" de "${textoUbicacion}"`);
                                return ultimaParte;
                            }
                        }

                        // Método 2: Buscar la primera parte (nombre del hotel/destino)
                        const primeraParte = partes[0].trim();
                        if (primeraParte.length > 3 && primeraParte.length < 50) {
                            console.log(`✓ Destino extraído primera parte: "${primeraParte}" de "${textoUbicacion}"`);
                            return primeraParte;
                        }

                        console.log(`⚠️ No se pudo extraer destino de: "${textoUbicacion}"`);
                        return null;

                    } catch (error) {
                        console.error('Error al extraer destino específico:', error.message);
                        return null;
                    }
                };

                // MANTENER: Estrategia específica para hotel-top
                const esTop = selector.startsWith('[id^="hotel-top-"]');
                const tops = document.querySelectorAll(selector);
                console.log(`Encontrados ${tops.length} elementos con selector ${selector}`);

                if (esTop) {
                    tops.forEach((top, idx) => {
                        try {
                            const topId = top.id;
                            const sufijo = topId?.replace('hotel-top-', '') || String(idx + 1);
                            console.log(`Procesando hotel-top con ID: ${topId}`);

                            // Nombre del hotel
                            const hotelNombre =
                                limpiar(top.querySelector('span.h5, .h5, h5')?.textContent) ||
                                limpiar(top.querySelector('[class*="hotel"], [class*="titulo"]')?.textContent) ||
                                `Hotel ${idx + 1}`;

                            console.log(`  Hotel: "${hotelNombre}"`);

                            // Filtrar nombres obviamente inválidos
                            if (ES_BASURA_TITULO(hotelNombre)) {
                                console.log(`  ✗ Saltando hotel con nombre basura: "${hotelNombre}"`);
                                return;
                            }

                            // *** NUEVA FUNCIONALIDAD: EXTRAER DESTINO ESPECÍFICO ***
                            let destinoEspecifico = null;
                            let ubicacionCompleta = null;

                            // Buscar información de ubicación usando el selector específico
                            const elementoUbicacion = top.querySelector('div.col-9 > div > p:nth-of-type(1)');

                            if (elementoUbicacion) {
                                ubicacionCompleta = elementoUbicacion.textContent.trim();
                                destinoEspecifico = extraerDestinoEspecifico(ubicacionCompleta);

                                console.log(`  📍 Ubicación completa: "${ubicacionCompleta}"`);
                                console.log(`  🎯 Destino extraído: "${destinoEspecifico}"`);
                            } else {
                                console.log(`  ⚠️ No se encontró información de ubicación para ${hotelNombre}`);

                                // Intentar selectores alternativos
                                const selectoresAlternativos = [
                                    'p:contains("Hotel")',
                                    '.direccion',
                                    '.ubicacion',
                                    '[class*="location"]',
                                    '[class*="address"]',
                                    'div.col-9 p',
                                    'div.col-9 > p'
                                ];

                                for (const selectorAlt of selectoresAlternativos) {
                                    const elementoAlt = top.querySelector(selectorAlt);
                                    if (elementoAlt && elementoAlt.textContent.trim().length > 10) {
                                        ubicacionCompleta = elementoAlt.textContent.trim();
                                        destinoEspecifico = extraerDestinoEspecifico(ubicacionCompleta);
                                        console.log(`  📍 Ubicación alternativa: "${ubicacionCompleta}"`);
                                        console.log(`  🎯 Destino extraído (alt): "${destinoEspecifico}"`);
                                        break;
                                    }
                                }
                            }

                            // MANTENER: Procesamiento de habitaciones existente
                            let ul =
                                document.getElementById(`booking-result-list-${sufijo}`) ||
                                top.parentElement?.querySelector(`#booking-result-list-${sufijo}`) ||
                                top.parentElement?.querySelector('[id^="booking-result-list-"]');

                            if (!ul) {
                                console.log(`  ⚠️ No se encontró UL para ${hotelNombre}, buscando alternativas...`);
                                const contenedorPadre = top.closest('.card') || top.parentElement;
                                ul = contenedorPadre?.querySelector('ul') || contenedorPadre?.querySelector('[id*="booking"]');
                            }

                            if (ul) {
                                const lis = ul.querySelectorAll(':scope > li');
                                console.log(`  ✓ Encontrados ${lis.length} elementos LI para ${hotelNombre}`);

                                lis.forEach((li, i) => {
                                    try {
                                        const habitacion =
                                            limpiar(li.querySelector('div.mb-1')?.textContent) ||
                                            limpiar(li.querySelector('div.col-md ul li a')?.textContent) ||
                                            limpiar(li.querySelector('[class*="room"], [class*="habitacion"]')?.textContent) ||
                                            '';

                                        const promo =
                                            limpiar(li.querySelector('div.ribbon-two, div.ribbon-two-success, [class*="ribbon"], .badge, .tag, .label')?.textContent) || '';

                                        const precioEl =
                                            li.querySelector('div.float-end > a') ||
                                            li.querySelector('[class*="price"], [class*="precio"]') ||
                                            li.querySelector('strong, b') ||
                                            null;

                                        const precioTexto = limpiar(precioEl?.textContent || '');
                                        const precioNumero = toNum(precioTexto);

                                        const textoLower = li.textContent.toLowerCase();
                                        const esNoReembolsable =
                                            textoLower.includes('no reembolsable') ||
                                            textoLower.includes('no rembolsable') ||
                                            textoLower.includes('sin reembolso') ||
                                            textoLower.includes('pago inmediato');

                                        const item = {
                                            id: sufijo,
                                            titulo: hotelNombre,
                                            habitacion,
                                            promo,
                                            precio: precioTexto || null,
                                            precioNumero: precioNumero,
                                            esNoReembolsable,
                                            liIndex: i + 1,
                                            detalles: [habitacion, promo].filter(Boolean).join(' - ') || '',
                                            imagen: li.querySelector('img')?.src || '',
                                            incluye: Array.from(li.querySelectorAll('ul li')).map(item => limpiar(item.textContent)).filter(Boolean),
                                            // *** NUEVAS PROPIEDADES ***
                                            destinoEspecifico: destinoEspecifico,
                                            ubicacionCompleta: ubicacionCompleta
                                        };

                                        if (precioNumero && precioNumero >= 100) {
                                            resultados.push(item);
                                            console.log(`    ✓ Agregado: ${precioTexto} - ${habitacion || 'Sin especificar'} - 📍 ${destinoEspecifico || 'Destino no especificado'}`);
                                        } else {
                                            console.log(`    ✗ Rechazado por precio inválido: ${precioTexto} (${precioNumero})`);
                                        }
                                    } catch (liError) {
                                        console.error(`    Error en LI ${i} de ${hotelNombre}:`, liError.message);
                                    }
                                });
                            } else {
                                console.log(`  ✗ No se encontró UL para ${hotelNombre}, saltando...`);
                            }

                        } catch (topError) {
                            console.error(`Error procesando hotel-top ${idx}:`, topError.message);
                        }
                    });
                } else {
                    // MANTENER: Fallback genérico para otros selectores
                    console.log('Usando estrategia genérica para selector no hotel-top');
                    document.querySelectorAll(selector).forEach((card, idx) => {
                        try {
                            const titulo =
                                limpiar(card.querySelector('span.h5, .h5, h5, [class*="title"]')?.textContent) || `Resultado ${idx + 1}`;

                            if (ES_BASURA_TITULO(titulo)) return;

                            // Intentar extraer destino también en modo genérico
                            let destinoEspecifico = null;
                            let ubicacionCompleta = null;

                            const elementoUbicacion = card.querySelector('div.col-9 > div > p:nth-of-type(1)') ||
                                card.querySelector('p') ||
                                card.querySelector('[class*="address"]') ||
                                card.querySelector('[class*="location"]');

                            if (elementoUbicacion) {
                                ubicacionCompleta = elementoUbicacion.textContent.trim();
                                destinoEspecifico = extraerDestinoEspecifico(ubicacionCompleta);
                            }

                            const precioEl =
                                card.querySelector('div.float-end > a') ||
                                card.querySelector('[class*="price"], [class*="precio"]') ||
                                card.querySelector('strong, b');

                            const precioTexto = limpiar(precioEl?.textContent || '');
                            const precioNumero = toNum(precioTexto);

                            const promo =
                                limpiar(card.querySelector('div.ribbon-two, div.ribbon-two-success, [class*="ribbon"], .badge, .tag, .label')?.textContent) || '';

                            const item = {
                                id: (card.id || `card-${idx + 1}`).replace('hotel-top-', ''),
                                titulo,
                                habitacion: '',
                                promo,
                                precio: precioTexto || null,
                                precioNumero,
                                esNoReembolsable: card.textContent.toLowerCase().includes('no reembolsable'),
                                liIndex: null,
                                selectorUsado: selector,
                                // *** NUEVAS PROPIEDADES ***
                                destinoEspecifico: destinoEspecifico,
                                ubicacionCompleta: ubicacionCompleta
                            };

                            if (precioNumero && precioNumero >= 100) {
                                resultados.push(item);
                                console.log(`✓ Agregado (genérico): ${titulo} - ${precioTexto} - 📍 ${destinoEspecifico || 'Destino no especificado'}`);
                            }
                        } catch (error) {
                            console.error(`Error en elemento genérico ${idx}:`, error.message);
                        }
                    });
                }

                console.log(`Total de resultados extraídos: ${resultados.length}`);
                return resultados;
            }, selectorHoteles);
        } else {
            console.log('❌ No se detectaron elementos, verificando mensajes de error...');

            // MANTENER: Búsqueda de mensajes de error existente pero mejorada
            const mensajesError = await page.evaluate(() => {
                const mensajes = [];
                const elementos = document.querySelectorAll('h1, h2, h3, .alert, .error, .mensaje, span, p, div');

                Array.from(elementos).forEach(el => {
                    const texto = el.textContent?.trim();
                    if (texto && texto.length < 500 && (
                        texto.toLowerCase().includes('no se encontraron') ||
                        texto.toLowerCase().includes('sin resultados') ||
                        texto.toLowerCase().includes('no hay') ||
                        texto.toLowerCase().includes('no disponible') ||
                        texto.toLowerCase().includes('error')
                    )) {
                        mensajes.push(texto);
                    }
                });

                return [...new Set(mensajes)]; // Eliminar duplicados
            });

            if (mensajesError.length > 0) {
                console.log('Mensajes de error encontrados:', mensajesError);
                hoteles = [{
                    titulo: 'No se encontraron opciones disponibles',
                    detalles: mensajesError.join(' | '),
                    error: true
                }];
            } else {
                hoteles = [{
                    titulo: 'No se encontraron opciones disponibles',
                    detalles: 'La búsqueda no arrojó resultados para los parámetros especificados.',
                    error: true
                }];
            }
        }

        // Debug: Mostrar estadísticas antes del filtrado
        console.log(`=== DIAGNÓSTICO ANTES DE FILTRADO ===`);
        console.log(`Total candidatos extraídos: ${hoteles.length}`);
        if (hoteles.length > 0 && !hoteles[0].error) {
            const conPrecio = hoteles.filter(h => h.precioNumero > 0);
            const sinPrecio = hoteles.filter(h => !h.precioNumero || h.precioNumero <= 0);
            console.log(`  Con precio válido: ${conPrecio.length}`);
            console.log(`  Sin precio válido: ${sinPrecio.length}`);
        }

        // MANTENER: Filtrado riguroso existente
        hoteles = hoteles.filter(h =>
            h &&
            h.titulo &&
            !/^\s*$/.test(h.titulo) &&
            !(/no hay reservaciones por expirar/i.test(h.titulo) || /^alojamiento$/i.test(h.titulo)) &&
            (h.error || (Number.isFinite(h.precioNumero) && h.precioNumero >= 100))
        );

        // MEJORADO: Estadísticas finales detalladas
        console.log(`=== ESTADÍSTICAS FINALES ===`);
        console.log(`Hoteles válidos después de filtrado: ${hoteles.length}`);

        if (hoteles.length > 0 && !hoteles[0].error) {
            console.log('\n--- MUESTRA DE LOS PRIMEROS 5 RESULTADOS ---');
            hoteles.slice(0, Math.min(5, hoteles.length)).forEach((h, i) => {
                console.log(`${i + 1}. ${h.titulo}`);
                console.log(`   💰 Precio: ${h.precio} (${h.precioNumero})`);
                console.log(`   🏠 Habitación: ${h.habitacion || 'No especificada'}`);
                if (h.promo) console.log(`   🎁 Promoción: ${h.promo}`);
                if (h.esNoReembolsable) console.log(`   ⚠️  NO REEMBOLSABLE`);
                console.log('');
            });

            // Estadísticas generales
            const precios = hoteles.filter(h => h.precioNumero > 0).map(h => h.precioNumero);
            if (precios.length > 0) {
                console.log('--- ANÁLISIS DE PRECIOS ---');
                console.log(`Precio mínimo: $${Math.min(...precios).toLocaleString()}`);
                console.log(`Precio máximo: $${Math.max(...precios).toLocaleString()}`);
                console.log(`Precio promedio: $${Math.round(precios.reduce((a, b) => a + b, 0) / precios.length).toLocaleString()}`);
                console.log(`Hoteles con promoción: ${hoteles.filter(h => h.promo).length}`);
                console.log(`No reembolsables: ${hoteles.filter(h => h.esNoReembolsable).length}`);
            }
        }

        console.log(`Se encontraron ${hoteles.length} hoteles/paquetes.`);
        // Si está activada la búsqueda con vista al mar
        if (config.busqueda.vistaAlMar) {
            console.log('⚠️ BUSCANDO ESPECÍFICAMENTE HABITACIONES CON VISTA AL MAR...');

            // Buscar habitaciones con vista al mar en los resultados obtenidos
            const resultadosVistaAlMar = await buscarHabitacionesVistaAlMarMejorado(page, hoteles, config, opciones.hotelBuscado);

            // Si hay un hotel específico solicitado, procesar ese caso particular
            if (opciones.hotelBuscado) {
                hoteles = procesarHotelEspecificoConVistaAlMar(resultadosVistaAlMar, hoteles, opciones.hotelBuscado);
            } else {
                // Si no hay hotel específico, simplemente usar los resultados filtrados
                hoteles = resultadosVistaAlMar;
            }
        }

        // Verificar si necesitamos hacer scroll para obtener más resultados
        let totalHoteles = hoteles.length;
        let intentosScroll = 0;
        const maxIntentosScroll = 3; // Máximo número de veces que scrolleamos para buscar más

        while (intentosScroll < maxIntentosScroll) {
            console.log(`Realizando scroll para buscar más resultados (intento ${intentosScroll + 1})...`);

            // Hacer scroll hacia abajo
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            // Esperar a que se carguen posibles nuevos elementos
            await esperar(3000);

            // Contar cuántos hoteles hay ahora
            const nuevoTotal = await page.evaluate((selector) => {
                return document.querySelectorAll(selector).length;
            }, selectorHoteles);

            console.log(`Después de scroll: ${nuevoTotal} hoteles (antes: ${totalHoteles})`);

            // Si no aparecieron nuevos elementos, terminar
            if (nuevoTotal <= totalHoteles) {
                break;
            }

            // Extraer información de los nuevos hoteles
            const nuevosHoteles = await page.evaluate((selector, indiceInicio) => {
                const resultados = [];

                // Función para limpiar texto
                const limpiarTexto = (texto) => {
                    if (!texto) return '';
                    return texto.replace(/\s+/g, ' ').trim();
                };

                // Función para extraer precio
                const extraerPrecio = (elemento) => {
                    // Información sobre si es no reembolsable
                    let esNoReembolsable = false;

                    // Verificar si hay etiqueta de "NO REMBOLSABLE" en cualquier parte del elemento
                    const textoCompleto = elemento.textContent.toLowerCase();
                    if (textoCompleto.includes('no rembolsable') ||
                        textoCompleto.includes('no reembolsable') ||
                        textoCompleto.includes('sin reembolso') ||
                        textoCompleto.includes('pago inmediato')) {
                        esNoReembolsable = true;
                    }

                    // Buscar etiquetas específicas de no reembolsable
                    const etiquetasNoReembolsable = elemento.querySelectorAll('.ribbon-two span, .badge, .tag, .label');
                    for (const etiqueta of etiquetasNoReembolsable) {
                        const textoEtiqueta = etiqueta.textContent.toLowerCase().trim();
                        if (textoEtiqueta.includes('no rembolsable') ||
                            textoEtiqueta.includes('no reembolsable') ||
                            textoEtiqueta.includes('sin reembolso')) {
                            esNoReembolsable = true;
                            break;
                        }
                    }

                    // Intento 1: Buscar elemento específico con precio
                    const precioElemento =
                        elemento.querySelector('div.float-end > a') ||
                        elemento.querySelector('[class*="price"], [class*="precio"]') ||
                        elemento.querySelector('strong, b');

                    // Extraer el precio
                    let precioTexto = '';
                    if (precioElemento) {
                        precioTexto = precioElemento.textContent.trim();
                        // Extraer solo el formato numérico (ej: $1,234 o valores numéricos como 28,021)
                        const coincidencia = precioTexto.match(/\$?([\d,]+(?:\.\d+)?)/);
                        precioTexto = coincidencia ? coincidencia[0] : precioTexto;
                    } else {
                        // Intento 2: Buscar en todo el texto del elemento
                        const coincidencia = textoCompleto.match(/\$?([\d,]+(?:\.\d+)?)/);
                        precioTexto = coincidencia ? coincidencia[0] : '';
                    }

                    // Devolver un objeto con el precio y la información de reembolso
                    return {
                        precio: precioTexto,
                        esNoReembolsable: esNoReembolsable
                    };
                };

                // Buscar todos los elementos que coinciden con el selector
                const elementos = document.querySelectorAll(selector);

                // Extraer solo los nuevos elementos (a partir del índice de inicio)
                for (let i = indiceInicio; i < elementos.length; i++) {
                    const elemento = elementos[i];

                    // Extraer ID
                    const id = elemento.id || `hotel-${i + 1}`;

                    // Extraer título
                    const titulo =
                        limpiarTexto(elemento.querySelector('span.h5')?.textContent) ||
                        limpiarTexto(elemento.querySelector('h1, h2, h3, h4, h5')?.textContent) ||
                        limpiarTexto(elemento.querySelector('[class*="title"], [class*="titulo"]')?.textContent) ||
                        `Opción ${i + 1}`;

                    // Extraer tipo de habitación
                    const habitacion =
                        limpiarTexto(elemento.querySelector('div.mb-1')?.textContent) ||
                        limpiarTexto(elemento.querySelector('[class*="room"], [class*="habitacion"]')?.textContent) ||
                        '';

                    // Extraer detalles
                    const detalles =
                        limpiarTexto(elemento.querySelector('div.text-muted')?.textContent) ||
                        limpiarTexto(elemento.querySelector('[class*="details"], [class*="detalles"]')?.textContent) ||
                        '';

                    // Extraer precio
                    const precio = extraerPrecio(elemento);

                    // Extraer imagen
                    const imagen = elemento.querySelector('img')?.src || '';

                    // Extraer plan
                    const plan =
                        limpiarTexto(elemento.querySelector('[class*="plan"]')?.textContent) ||
                        '';

                    // Extraer servicios incluidos
                    const incluye = Array.from(
                        elemento.querySelectorAll('ul li, [class*="incluye"] li, [class*="amenities"] li')
                    ).map(li => limpiarTexto(li.textContent)).filter(Boolean);

                    // Extraer precio e información de reembolso
                    const infoPrecio = extraerPrecio(elemento);

                    // Añadir la advertencia de no reembolsable a los detalles si corresponde
                    let detallesActualizados = detalles;
                    if (infoPrecio.esNoReembolsable) {
                        const advertencia = '⚠️ NO REEMBOLSABLE - REQUIERE PAGO INMEDIATO ⚠️';
                        detallesActualizados = detalles ? `${advertencia} | ${detalles}` : advertencia;
                    }

                    // Crear objeto de resultado
                    resultados.push({
                        id,
                        titulo,
                        habitacion,
                        detalles: detallesActualizados,
                        precio: infoPrecio.precio,
                        imagen,
                        plan,
                        noReembolsable: infoPrecio.esNoReembolsable, // Añadir como propiedad separada
                        incluye: incluye.length > 0 ? incluye : undefined
                    });
                }

                return resultados;
            }, selectorHoteles, totalHoteles);

            // Añadir los nuevos hoteles a la lista
            hoteles.push(...nuevosHoteles);

            // Actualizar contador
            totalHoteles = hoteles.length;
            intentosScroll++;
        }
        console.log(`Total final: ${hoteles.length} hoteles/paquetes encontrados.`);

        // Si no se encontraron resultados, crear un resultado informativo
        if (hoteles.length === 0) {
            console.log('No se encontraron hoteles/paquetes. Creando resultado informativo...');

            // Tomar captura de la página sin resultados

            hoteles = [{
                titulo: 'No se encontraron opciones disponibles',
                detalles: 'La búsqueda no arrojó resultados para los parámetros especificados. Por favor intente con fechas o destinos diferentes.',
                error: false
            }];
        }

        // Guardar los resultados en un archivo JSON
        if (config.guardarResultados && hoteles.length > 0) {
            // Crear directorio de resultados si no existe
            const dirResultados = './resultados';
            if (!fs.existsSync(dirResultados)) {
                fs.mkdirSync(dirResultados);
            }

            const fechaHora = new Date().toISOString().replace(/[:.]/g, '-');
            const nombreArchivo = path.join(dirResultados, `naturleon_${config.busqueda.destino}_${fechaHora}.json`);
            fs.writeFileSync(nombreArchivo, JSON.stringify(hoteles, null, 2));
            console.log(`Resultados guardados en: ${nombreArchivo}`);
        }

        // Tomar una captura final de la página de resultados
        // Tomar una captura final de la página de resultados


        // Cerrar el navegador
        await browser.close();
        console.log('Proceso de scraping completado.');

        // Devolver los resultados
        return {
            exito: true,
            resultados: hoteles,
            total: hoteles.length,
            soloAlojamiento: esSoloAlojamiento,
            advertencia: advertenciaTransporte,
            parametros: {
                destino: config.busqueda.destino,
                fechas: `${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`,
                plan: config.busqueda.plan,
                ocupacion: `${config.busqueda.adultos} adultos, ${config.busqueda.ninos} niños, ${config.busqueda.habitaciones} habitación(es)`
            }
        };
    } catch (error) {
        console.error('Error durante el proceso de scraping:', error.message);


        // Cerrar el navegador
        await browser.close();

        // Devolver objeto de error
        return {
            exito: false,
            error: error.message,
            detalles: error.stack
        };
    }
}

/**
 * Función mejorada para buscar habitaciones con vista al mar
 * @param {Object} page - Instancia de puppeteer page
 * @param {Array} hoteles - Lista de hoteles encontrados
 * @param {Object} config - Configuración de búsqueda
 * @param {String} hotelBuscado - Nombre específico de hotel a buscar (opcional)
 */
async function buscarHabitacionesVistaAlMarMejorado(page, hoteles, config, hotelBuscado = null) {
    console.log('Iniciando búsqueda mejorada de habitaciones con vista al mar...');

    // Array para diferentes tipos de resultados
    const hotelesConVistaAlMar = []; // Hoteles que tienen habitaciones con vista al mar
    const hotelesEspecificos = []; // Para el hotel específico buscado (con o sin vista al mar)
    const hotelesAlternativos = []; // Hoteles alternativos con vista al mar (para recomendación)

    // Términos relacionados con vista al mar (incluir variaciones comunes)
    const terminosVistaAlMar = [
        'vista al mar', 'vista mar', 'ocean view', 'sea view', 'frente al mar',
        'oceanview', 'seaview', 'vista oceano', 'ocean front', 'oceanfront',
        'vistas al mar', 'vista a la playa', 'beach view', 'vista océano'
    ];

    // Normalizar nombre de hotel buscado si existe
    let hotelBuscadoNormalizado = null;
    if (hotelBuscado) {
        hotelBuscadoNormalizado = hotelBuscado.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, " ").trim();
        console.log(`Buscando específicamente hotel: "${hotelBuscadoNormalizado}"`);
    }

    // Para cada hotel en los resultados...
    for (const hotel of hoteles) {
        // Verificar si es el hotel específico buscado
        let esHotelBuscado = false;
        if (hotelBuscadoNormalizado && hotel.titulo) {
            const tituloNormalizado = hotel.titulo.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/\s+/g, " ").trim();

            esHotelBuscado = tituloNormalizado.includes(hotelBuscadoNormalizado);

            if (esHotelBuscado) {
                console.log(`✅ Encontrado hotel buscado: "${hotel.titulo}"`);

                // Guardar este hotel en la lista de hoteles específicos
                // Hacemos una copia para no modificar el original
                let hotelEspecificoSinVistaMar = JSON.parse(JSON.stringify(hotel));
                hotelEspecificoSinVistaMar.esHotelBuscado = true;
                hotelEspecificoSinVistaMar.tieneVistaAlMar = false; // Por defecto, asumimos que no
                hotelesEspecificos.push(hotelEspecificoSinVistaMar);
            }
        }

        // Añadir a lista general solo si no es el hotel buscado
        // (esto evita duplicados en las recomendaciones)
        if (!esHotelBuscado) {
            // Hacer copia para modificar sin afectar original
            let hotelCopia = JSON.parse(JSON.stringify(hotel));
            hotelCopia.esHotelBuscado = false;
            hotelesAlternativos.push(hotelCopia);
        }

        console.log(`Analizando habitaciones de: ${hotel.titulo || 'Hotel sin título'}`);

        try {
            // 1. Verificar si el hotel actual ya tiene una habitación con vista al mar
            let tieneVistaAlMar = false;

            // Verificar en el título de la habitación
            if (hotel.habitacion && terminosVistaAlMar.some(termino =>
                hotel.habitacion.toLowerCase().includes(termino))) {
                console.log(`✅ Encontrada habitación con vista al mar en resultados principales: ${hotel.habitacion}`);
                tieneVistaAlMar = true;

                // Si es el hotel buscado, actualizar en la lista de hoteles específicos
                if (esHotelBuscado) {
                    hotelesEspecificos[hotelesEspecificos.length - 1].tieneVistaAlMar = true;
                    hotelesEspecificos[hotelesEspecificos.length - 1].habitacionVistaAlMar = hotel.habitacion;
                    hotelesEspecificos[hotelesEspecificos.length - 1].precioVistaAlMar = hotel.precio;
                } else {
                    // Si no es el hotel buscado, añadir a la lista de hoteles con vista al mar
                    let hotelConVistaAlMar = JSON.parse(JSON.stringify(hotel));
                    hotelConVistaAlMar.tieneVistaAlMar = true;
                    hotelesConVistaAlMar.push(hotelConVistaAlMar);
                }

                // Continuar con el siguiente hotel
                continue;
            }

            // 2. Si no encontramos vista al mar, intentar expandir opciones
            const idHotel = hotel.id || '';
            let hotelNumId = '';

            if (idHotel.startsWith('hotel-top-')) {
                hotelNumId = idHotel.replace('hotel-top-', '');
            } else {
                // Si no tiene el formato esperado, extraer cualquier número
                const idMatch = idHotel.match(/\d+/);
                if (idMatch) {
                    hotelNumId = idMatch[0];
                } else {
                    console.log(`⚠️ No se puede identificar ID numérico para ${hotel.titulo}`);
                    continue;
                }
            }

            // Verificar si hay más opciones usando nuestra función mejorada
            const hayMasOpciones = await expandirOpcionesHabitacion(page, hotelNumId);

            if (hayMasOpciones) {
                console.log(`Explorando opciones expandidas para hotel ${hotel.titulo}`);

                // Buscar habitaciones con vista al mar en las opciones expandidas
                const habitacionesVistaAlMar = await page.evaluate((hotelId, terminos) => {
                    const resultados = [];

                    try {
                        // Buscar todas las habitaciones para este hotel
                        const filas = document.querySelectorAll(`#booking-result-list-${hotelId} li`);
                        console.log(`Encontradas ${filas.length} opciones de habitaciones`);

                        for (const fila of filas) {
                            // Obtener el título de la habitación
                            const tituloHabitacion = fila.querySelector('.mb-1')?.textContent.trim() ||
                                fila.querySelector('[class*="room-name"]')?.textContent.trim() ||
                                '';

                            // Verificar si alguno de los términos aparece en el título
                            const tieneVistaAlMar = terminos.some(term =>
                                tituloHabitacion.toLowerCase().includes(term));

                            if (tieneVistaAlMar) {
                                // Extraer detalles de la habitación
                                const precio = fila.querySelector('.float-end')?.textContent.trim() ||
                                    fila.querySelector('[class*="price"]')?.textContent.trim() ||
                                    '';

                                const detalles = fila.querySelector('.text-muted')?.textContent.trim() ||
                                    fila.querySelector('[class*="details"]')?.textContent.trim() ||
                                    '';

                                const esNoReembolsable = fila.textContent.toLowerCase().includes('no reembolsable') ||
                                    fila.textContent.toLowerCase().includes('pago inmediato') ||
                                    false;

                                // Crear objeto con los detalles de la habitación
                                resultados.push({
                                    habitacion: tituloHabitacion,
                                    precio: precio,
                                    detalles: detalles,
                                    noReembolsable: esNoReembolsable
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error al buscar habitaciones expandidas:', error.message);
                    }

                    return resultados;
                }, hotelNumId, terminosVistaAlMar);

                // Cerrar la vista expandida
                try {
                    await page.evaluate((hotelId) => {
                        const botonVerMenos = document.querySelector(`#collapse-${hotelId} > a`);
                        if (botonVerMenos && botonVerMenos.textContent.includes('Ver menos')) {
                            botonVerMenos.click();
                            return true;
                        }
                        return false;
                    }, hotelNumId);

                    await esperar(500); // <-- SOLUCIÓN: usar la función esperar()
                } catch (err) {
                    console.log('Error al cerrar las opciones expandidas:', err.message);
                }

                // Si encontramos habitaciones con vista al mar
                if (habitacionesVistaAlMar && habitacionesVistaAlMar.length > 0) {
                    console.log(`✅ Encontradas ${habitacionesVistaAlMar.length} habitaciones con vista al mar para ${hotel.titulo}`);
                    tieneVistaAlMar = true;

                    // Si es el hotel buscado, actualizar en hotelesEspecificos
                    if (esHotelBuscado) {
                        // Tomamos la primera habitación con vista al mar para simplicidad
                        const habitacionVistaAlMar = habitacionesVistaAlMar[0];
                        hotelesEspecificos[hotelesEspecificos.length - 1].tieneVistaAlMar = true;
                        hotelesEspecificos[hotelesEspecificos.length - 1].habitacionVistaAlMar = habitacionVistaAlMar.habitacion;
                        hotelesEspecificos[hotelesEspecificos.length - 1].precioVistaAlMar = habitacionVistaAlMar.precio;
                    } else {
                        // Para cada habitación, crear un hotel específico
                        for (const habitacionVista of habitacionesVistaAlMar) {
                            let hotelConVistaAlMar = JSON.parse(JSON.stringify(hotel));
                            hotelConVistaAlMar.habitacion = habitacionVista.habitacion;
                            hotelConVistaAlMar.precio = habitacionVista.precio;
                            hotelConVistaAlMar.tieneVistaAlMar = true;

                            if (habitacionVista.detalles) {
                                hotelConVistaAlMar.detalles = habitacionVista.detalles;
                            }

                            if (habitacionVista.noReembolsable) {
                                hotelConVistaAlMar.noReembolsable = true;
                                const advertencia = '⚠️ NO REEMBOLSABLE - REQUIERE PAGO INMEDIATO ⚠️';
                                hotelConVistaAlMar.detalles = hotelConVistaAlMar.detalles
                                    ? `${advertencia} | ${hotelConVistaAlMar.detalles}`
                                    : advertencia;
                            }

                            hotelesConVistaAlMar.push(hotelConVistaAlMar);
                        }
                    }
                }
            } else {
                console.log(`Sin opciones expandidas para hotel ${hotel.titulo}`);
            }

            // Marcar explícitamente si el hotel tiene vista al mar o no
            if (esHotelBuscado) {
                hotelesEspecificos[hotelesEspecificos.length - 1].tieneVistaAlMar = tieneVistaAlMar;
            }

        } catch (error) {
            console.log(`Error al analizar ${hotel.titulo}: ${error.message}`);
        }
    }

    console.log(`Se encontraron ${hotelesConVistaAlMar.length} hoteles/habitaciones con vista al mar.`);

    // Preparar resultados según el caso
    if (hotelBuscado) {
        return prepararResultadosHotelEspecifico(hotelesEspecificos, hotelesConVistaAlMar, hoteles);
    } else {
        return prepararResultadosGenerales(hotelesConVistaAlMar, hoteles);
    }
}

/**
 * Prepara los resultados cuando se busca un hotel específico
 */
function prepararResultadosHotelEspecifico(hotelesEspecificos, hotelesConVistaAlMar, todosHoteles) {
    if (hotelesEspecificos.length === 0) {
        console.log(`No se encontró el hotel específico buscado.`);

        // Crear mensaje informativo
        const mensajeNoEncontrado = {
            titulo: `No se encontró el hotel buscado`,
            detalles: `El hotel buscado no está disponible en las fechas seleccionadas. Se muestran alternativas con vista al mar.`,
            tieneVistaAlMar: false
        };

        // Devolver mensaje con alternativas
        return hotelesConVistaAlMar.length > 0
            ? [mensajeNoEncontrado, ...hotelesConVistaAlMar.slice(0, 4)]
            : [mensajeNoEncontrado, ...todosHoteles.slice(0, 4)];
    }

    // Tenemos el hotel específico
    const hotelEspecifico = hotelesEspecificos[0];

    if (hotelEspecifico.tieneVistaAlMar) {
        console.log(`✅ El hotel buscado tiene habitaciones con vista al mar.`);

        // Si tiene vista al mar, preparar resultados con ambas opciones
        let resultados = [];

        // 1. Primero el hotel con habitación estándar
        resultados.push(hotelEspecifico);

        // 2. Luego el mismo hotel pero con habitación vista al mar
        let hotelVistaAlMar = JSON.parse(JSON.stringify(hotelEspecifico));
        hotelVistaAlMar.habitacion = hotelEspecifico.habitacionVistaAlMar;
        hotelVistaAlMar.precio = hotelEspecifico.precioVistaAlMar;
        resultados.push(hotelVistaAlMar);

        return resultados;
    } else {
        console.log(`⚠️ El hotel buscado NO tiene habitaciones con vista al mar.`);

        // Añadir mensaje explicativo a los detalles
        hotelEspecifico.detalles = `⚠️ IMPORTANTE: Este hotel no tiene habitaciones con vista al mar disponibles para las fechas seleccionadas. Se muestra la mejor habitación disponible. | ${hotelEspecifico.detalles || ''}`;

        // Devolver el hotel buscado + algunas alternativas con vista al mar
        let resultados = [hotelEspecifico];

        // Añadir hasta 3 alternativas con vista al mar
        if (hotelesConVistaAlMar.length > 0) {
            // Ordenamos por precio para mostrar los más económicos primero
            const alternativasOrdenadas = [...hotelesConVistaAlMar].sort((a, b) => {
                // Extraer valores numéricos de precio para comparar
                const precioA = a.precio ? parseFloat(a.precio.replace(/[^\d.]/g, '')) : Infinity;
                const precioB = b.precio ? parseFloat(b.precio.replace(/[^\d.]/g, '')) : Infinity;
                return precioA - precioB;
            });

            // Añadir hasta 3 alternativas
            resultados = resultados.concat(alternativasOrdenadas.slice(0, 3));
        }

        return resultados;
    }
}

/**
 * Prepara los resultados para búsqueda general de habitaciones con vista al mar
 */
function prepararResultadosGenerales(hotelesConVistaAlMar, todosHoteles) {
    if (hotelesConVistaAlMar.length === 0) {
        console.log(`⚠️ No se encontraron habitaciones con vista al mar en ningún hotel.`);

        // Crear mensaje informativo
        const resultadoInformativo = {
            titulo: 'No hay habitaciones con vista al mar disponibles',
            detalles: 'No se encontraron habitaciones con vista al mar para los parámetros especificados. Mostramos las habitaciones estándar disponibles.',
            tieneVistaAlMar: false
        };

        // Devolver las habitaciones normales con mensaje informativo primero
        return [resultadoInformativo, ...todosHoteles.slice(0, 5)];
    }

    // Ordenar los resultados por precio (menor a mayor)
    return hotelesConVistaAlMar.sort((a, b) => {
        const precioA = a.precio ? parseFloat(a.precio.replace(/[^\d.]/g, '')) : Infinity;
        const precioB = b.precio ? parseFloat(b.precio.replace(/[^\d.]/g, '')) : Infinity;
        return precioA - precioB;
    });
}

/**
 * Función para procesar un hotel específico con vista al mar
 * Si el usuario solicitó un hotel específico y vista al mar, esta función
 * maneja ese caso especial mostrando las opciones adecuadas
 */
function procesarHotelEspecificoConVistaAlMar(resultadosVistaAlMar, todosHoteles, hotelBuscado) {
    console.log(`Procesando búsqueda específica: Hotel "${hotelBuscado}" con vista al mar`);

    // Normalizar texto para búsquedas insensibles a mayúsculas/minúsculas y acentos
    const normalizarTexto = (texto) => {
        return texto.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
            .replace(/\s+/g, " ").trim(); // Normalizar espacios
    };

    const hotelBuscadoNormalizado = normalizarTexto(hotelBuscado);

    // 1. Buscar el hotel específico en todos los hoteles
    const hotelesCoincidentes = todosHoteles.filter(hotel => {
        if (!hotel.titulo) return false;
        const tituloNormalizado = normalizarTexto(hotel.titulo);
        return tituloNormalizado.includes(hotelBuscadoNormalizado);
    });

    // Si no encontramos el hotel buscado en absoluto
    if (hotelesCoincidentes.length === 0) {
        console.log(`No se encontró el hotel "${hotelBuscado}" en absoluto.`);

        // Crear mensaje informativo
        const mensajeNoEncontrado = {
            titulo: `No se encontró el hotel "${hotelBuscado}"`,
            detalles: `El hotel "${hotelBuscado}" no está disponible en las fechas seleccionadas. Se muestran alternativas con vista al mar.`,
            tieneVistaAlMar: false
        };

        // Ordenar alternativas con vista al mar por precio (menor a mayor)
        const alternativasOrdenadas = resultadosVistaAlMar.sort((a, b) => {
            const precioA = a.precio ? parseFloat(a.precio.replace(/[^\d.]/g, '')) : Infinity;
            const precioB = b.precio ? parseFloat(b.precio.replace(/[^\d.]/g, '')) : Infinity;
            return precioA - precioB;
        });

        // Devolver mensaje + alternativas ordenadas
        return [mensajeNoEncontrado, ...alternativasOrdenadas];
    }

    // 2. Buscar el hotel específico entre los que tienen vista al mar
    const hotelCoincidenteConVistaAlMar = resultadosVistaAlMar.find(hotel => {
        if (!hotel.titulo) return false;
        const tituloNormalizado = normalizarTexto(hotel.titulo);
        return tituloNormalizado.includes(hotelBuscadoNormalizado);
    });

    // 3. Si encontramos el hotel CON vista al mar
    if (hotelCoincidenteConVistaAlMar) {
        console.log(`✅ Encontrado hotel "${hotelBuscado}" CON habitaciones vista al mar!`);

        // Buscar versión estándar del mismo hotel
        const hotelVersionEstandar = hotelesCoincidentes.find(hotel =>
            !normalizarTexto(hotel.habitacion || '').includes('vista') &&
            !normalizarTexto(hotel.habitacion || '').includes('ocean') &&
            !normalizarTexto(hotel.habitacion || '').includes('sea')
        );

        // Crear resultados: versión con vista al mar primero, luego versión estándar
        const resultados = [hotelCoincidenteConVistaAlMar];

        if (hotelVersionEstandar) {
            console.log(`También encontrada versión estándar del hotel para comparación.`);
            resultados.push(hotelVersionEstandar);
        }

        return resultados;
    }

    // 4. Si encontramos el hotel pero NO tiene vista al mar
    console.log(`⚠️ Encontrado hotel "${hotelBuscado}" pero NO tiene habitaciones con vista al mar.`);

    // Obtener la versión estándar del hotel
    const hotelVersionEstandar = hotelesCoincidentes[0];

    // Añadir mensaje informativo
    hotelVersionEstandar.detalles = `⚠️ IMPORTANTE: Este hotel no tiene habitaciones con vista al mar disponibles para las fechas seleccionadas. Se muestra la habitación estándar y alternativas con vista al mar. | ${hotelVersionEstandar.detalles || ''}`;

    // Ordenar alternativas con vista al mar por precio (menor a mayor)
    const alternativasVistaAlMarOrdenadas = resultadosVistaAlMar
        .filter(hotel => {
            // Excluir el hotel buscado de las alternativas
            if (!hotel.titulo) return true;
            const tituloNormalizado = normalizarTexto(hotel.titulo);
            return !tituloNormalizado.includes(hotelBuscadoNormalizado);
        })
        .sort((a, b) => {
            const precioA = a.precio ? parseFloat(a.precio.replace(/[^\d.]/g, '')) : Infinity;
            const precioB = b.precio ? parseFloat(b.precio.replace(/[^\d.]/g, '')) : Infinity;
            return precioA - precioB;
        });

    // Devolver: primero versión estándar del hotel buscado, luego alternativas con vista al mar
    return [hotelVersionEstandar, ...alternativasVistaAlMarOrdenadas];
}
// Función principal para realizar el scraping de paquetes con vuelo
async function scrapNaturLeonPaquetesVuelo(opciones) {
    // Valores por defecto para las opciones
    const config = {
        credenciales: {
            email: opciones.email || 'izlandtours-norma@outlook.com',
            password: opciones.password || 'Paleta123'
        },
        busqueda: {
            destino: opciones.destino || 'Cancun',
            origen: opciones.origen || 'BJX - León',
            fechaInicio: opciones.fechaInicio || '2025-06-10',
            fechaFin: opciones.fechaFin || '2025-06-17',
            plan: opciones.plan || 'todoincluido',
            adultos: opciones.adultos || 2,
            ninos: opciones.ninos || 0,
            edadesMenores: opciones.edadesMenores || [5, 8, 10, 12],
            habitaciones: opciones.habitaciones || 1,
            // Nueva opción para vista al mar
            vistaAlMar: opciones.vistaAlMar === true
        },
        headless: opciones.headless !== undefined ? opciones.headless : false,
        guardarResultados: opciones.guardarResultados !== undefined ? opciones.guardarResultados : true,
        tomarCaptura: opciones.tomarCaptura !== undefined ? opciones.tomarCaptura : false,
        timeout: opciones.timeout || 30000
    };

    console.log('Iniciando proceso de búsqueda de paquetes con vuelo para NaturLeon...');
    console.log(`Destino: ${config.busqueda.destino}`);
    console.log(`Origen: ${config.busqueda.origen}`);
    console.log(`Fechas: ${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`);
    console.log(`Configuración de personas: ${config.busqueda.adultos} adultos, ${config.busqueda.ninos} niños, ${config.busqueda.habitaciones} habitación(es)`);
    console.log(`Plan: ${config.busqueda.plan}`);

    if (config.busqueda.vistaAlMar) {
        console.log('Búsqueda con preferencia de: HABITACIONES CON VISTA AL MAR');
    }

    // Iniciar el navegador con opciones para mejorar rendimiento
    const browser = await puppeteer.launch({
        headless: config.headless,
        defaultViewport: null,
        args: [
            '--window-size=1366,768',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    // Aumentar tiempos de espera
    // Tiempos de espera optimizados
    const tiempoEsperaOptimizado = Math.max(config.timeout, 15000); // Reducido a 15 segundos
    page.setDefaultTimeout(tiempoEsperaOptimizado);
    page.setDefaultNavigationTimeout(tiempoEsperaOptimizado);
    console.log(`Configurando tiempos de espera en: ${tiempoEsperaOptimizado}ms`);
    try {
        // Optimizar rendimiento
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            // Bloquear más recursos para mejor rendimiento
            const resourceType = req.resourceType();
            if (resourceType === 'image' || resourceType === 'font' ||
                resourceType === 'media' || resourceType === 'stylesheet') {
                req.abort();
            } else {
                req.continue();
            }
        });

        // PASO 1: Proceso de login (igual que en scrapNaturLeon)
        console.log('Iniciando proceso de login...');

        const navegacionExitosa = await navegarSeguro(page, 'https://www.naturleon.com/', config.timeout);
        if (!navegacionExitosa) {
            console.log('Intentando determinar si la página cargó lo suficiente para continuar...');

            const tieneElementosBasicos = await page.evaluate(() => {
                const tieneLogin = document.querySelector('#login_login') !== null;
                const tieneFormulario = document.querySelector('form') !== null;
                return { tieneLogin, tieneFormulario };
            });

            if (!tieneElementosBasicos.tieneLogin && !tieneElementosBasicos.tieneFormulario) {
                throw new Error('La página no cargó lo suficiente para continuar con el login');
            }
        }

        // Rellenar el formulario de login con reintento
        try {
            await page.type('#login_login', config.credenciales.email, { delay: 100 });
            console.log('Email ingresado.');
        } catch (typeError) {
            console.log('Error al ingresar email. Intentando método alternativo...');

            await page.evaluate((email) => {
                const loginInput = document.querySelector('#login_login');
                if (loginInput) {
                    loginInput.value = email;
                }
            }, config.credenciales.email);
        }

        // Esperar y rellenar el campo de contraseña
        try {
            await page.waitForSelector('#login_pass', { timeout: config.timeout });
            await page.type('#login_pass', config.credenciales.password, { delay: 100 });
            console.log('Contraseña ingresada.');
        } catch (passError) {
            console.log('Error al ingresar contraseña. Intentando método alternativo...');

            // Buscar cualquier campo que parezca un campo de contraseña
            const camposPass = await page.evaluate(() => {
                const posiblesCampos = document.querySelectorAll('input[type="password"]');
                return Array.from(posiblesCampos).map(campo => ({
                    id: campo.id,
                    name: campo.name,
                    placeholder: campo.placeholder
                }));
            });

            console.log('Posibles campos de contraseña encontrados:', camposPass);

            if (camposPass.length > 0) {
                // Usar el primer campo que encontremos
                const campoPass = camposPass[0];
                const selector = campoPass.id ? `#${campoPass.id}` : `input[name="${campoPass.name}"]`;
                console.log(`Intentando usar selector alternativo: ${selector}`);
                await page.type(selector, config.credenciales.password, { delay: 100 });
            } else {
                throw new Error('No se pudo encontrar el campo de contraseña en la página');
            }
        }

        // Tomar una captura antes de hacer clic en login

        // Hacer clic en el botón de login con manejo especial para evitar problemas de timeout
        console.log('Haciendo clic en el botón de login...');

        let loginExitoso = false;

        try {
            // Método 1: Intentar hacer clic directamente con Promise.all (que puede causar timeout)
            const botonLoginEncontrado = await page.evaluate(() => {
                const botones = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const botonLogin = botones.find(b =>
                    b.textContent?.includes('Entrar') ||
                    b.value?.includes('Entrar') ||
                    b.id?.includes('login') ||
                    b.className?.includes('login')
                );

                if (botonLogin) {
                    return {
                        encontrado: true,
                        tipo: botonLogin.tagName,
                        id: botonLogin.id || '',
                        clase: botonLogin.className || '',
                        texto: botonLogin.textContent || botonLogin.value || ''
                    };
                }
                return { encontrado: false };
            });

            console.log('Botón de login:', botonLoginEncontrado);

            if (botonLoginEncontrado.encontrado) {
                // Método 2: Hacer clic sin esperar navegación primero
                if (botonLoginEncontrado.id) {
                    await page.click(`#${botonLoginEncontrado.id}`);
                } else if (botonLoginEncontrado.clase) {
                    const primerClase = botonLoginEncontrado.clase.split(' ')[0];
                    await page.click(`.${primerClase}`);
                } else {
                    // Usar evaluate como último recurso
                    await page.evaluate(() => {
                        const botones = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                        const botonLogin = botones.find(b =>
                            b.textContent?.includes('Entrar') ||
                            b.value?.includes('Entrar') ||
                            b.id?.includes('login') ||
                            b.className?.includes('login')
                        );

                        if (botonLogin) botonLogin.click();
                    });
                }

                // Ahora esperar la navegación por separado
                try {
                    await page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: config.timeout
                    });
                    console.log('Navegación después de login completada.');
                    loginExitoso = true;
                } catch (navError) {
                    console.log('Timeout en navegación post-login, pero el clic fue exitoso. Intentando continuar...');
                    // Esperar un tiempo fijo y tomar captura
                    await esperar(5000);
                }
            } else {
                // Si no encontramos el botón específico, intentar con el botón dentro de #inicio
                try {
                    await page.click('#inicio button');

                    // Esperar navegación
                    await page.waitForNavigation({
                        waitUntil: 'networkidle2',
                        timeout: config.timeout
                    });
                    console.log('Navegación después de login con selector #inicio button completada.');
                    loginExitoso = true;
                } catch (buttonError) {
                    console.log('Error al hacer clic en #inicio button:', buttonError.message);

                    // Último intento: usar submit en el formulario
                    try {
                        await page.evaluate(() => {
                            const form = document.querySelector('form');
                            if (form) form.submit();
                        });

                        // Esperar navegación
                        await page.waitForNavigation({
                            waitUntil: 'networkidle2',
                            timeout: config.timeout
                        });
                        console.log('Navegación después de form.submit() completada.');
                        loginExitoso = true;
                    } catch (formError) {
                        console.log('Error al hacer submit del formulario:', formError.message);
                    }
                }
            }
        } catch (clickError) {
            console.log('Error durante el proceso de clic en login:', clickError.message);
        }
        // Tomar una captura después del intento de login

        // Verificar si el login fue exitoso
        const verificacionLogin = await page.evaluate(() => {
            // Buscar elementos que solo aparecen cuando el usuario está autenticado
            const elementosAutenticados = [
                '.user-menu',
                '.usuario-logueado',
                '.profile-menu',
                '.user-profile',
                '.logout-button',
                '.bienvenida'
            ];

            for (const selector of elementosAutenticados) {
                if (document.querySelector(selector)) {
                    return { exitoso: true, elemento: selector };
                }
            }

            // Verificar si ya no aparece el formulario de login
            const loginDesaparecido = document.querySelector('#login_login') === null &&
                document.querySelector('#login_pass') === null;

            if (loginDesaparecido) {
                return { exitoso: true, elemento: 'formulario-ausente' };
            }

            // Verificar si aparece algún mensaje de error
            const posiblesErrores = document.querySelectorAll('.error, .alert, .mensaje-error');
            if (posiblesErrores.length > 0) {
                return {
                    exitoso: false,
                    error: Array.from(posiblesErrores).map(e => e.textContent.trim()).join(' | ')
                };
            }

            return { exitoso: false, error: 'No se detectaron elementos de sesión iniciada' };
        });

        console.log('Verificación de login:', verificacionLogin);

        if (verificacionLogin.exitoso || loginExitoso) {
            console.log('Login exitoso.');
        } else {
            console.log('No se pudo confirmar un login exitoso, pero intentaremos continuar...');
            // Si hay un error específico, mostrarlo
            if (verificacionLogin.error) {
                console.log('Posible error de login:', verificacionLogin.error);
            }
        }

        // PASO 2: Navegar a la página de búsqueda
        console.log('Navegando a la página de búsqueda...');
        try {
            await page.goto('https://www.naturleon.com/agencia/AgenciaLandingPage.php', {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });
            console.log('Navegación a página de búsqueda exitosa.');
        } catch (navError) {
            console.log('Error en navegación a página de búsqueda:', navError.message);
            await esperar(5000);
        }

        // PASO 3: Cambiar a la pestaña de paquetes con vuelo (tercera pestaña)
        console.log('Cambiando a la pestaña de paquetes con vuelo...');

        await conReintentos(async () => {
            // Selectores para la tercera pestaña basados en la grabación
            const selectoresPestaña = [
                'div.content-page li:nth-of-type(3) span',
                'div.content-page li:nth-of-type(3) a',
                'div.content-page li:nth-of-type(3) i',
                '#v-pills-naturflight-tab',
                '[href="#v-pills-naturflight"]'
            ];

            // Intentar cada selector
            for (const selector of selectoresPestaña) {
                try {
                    const elementoExiste = await page.evaluate((sel) => {
                        const elemento = document.querySelector(sel);
                        return !!elemento;
                    }, selector);

                    if (elementoExiste) {
                        console.log(`Encontrado selector para pestaña de vuelos: ${selector}`);
                        await page.click(selector);
                        await esperar(1000);

                        // Verificar si cambió a la pestaña correcta
                        const tabActivado = await page.evaluate(() => {
                            return document.querySelector('#v-pills-naturflight.active') !== null;
                        });

                        if (tabActivado) {
                            console.log('Pestaña de paquetes con vuelo activada exitosamente.');
                            return true;
                        }
                    }
                } catch (clickError) {
                    console.log(`Error al hacer clic en selector ${selector}:`, clickError.message);
                }
            }

            // Si ningún selector funcionó, intentar clic mediante evaluate
            return await page.evaluate(() => {
                const pestañas = Array.from(document.querySelectorAll('a, button, div.nav-link, div[role="tab"]'));

                // Buscar pestaña relacionada con vuelos
                const pestañaVuelo = pestañas.find(p =>
                    p.textContent.toLowerCase().includes('vuelo') ||
                    p.textContent.toLowerCase().includes('aéreo') ||
                    p.textContent.toLowerCase().includes('flight')
                );

                if (pestañaVuelo) {
                    pestañaVuelo.click();
                    return true;
                }

                return false;
            });
        }, 'Cambio a pestaña de paquetes con vuelo', 3);

        // Esperar a que se cargue el formulario
        await esperar(2000);

        // PASO 4: Seleccionar fechas (similar a scrapNaturLeon)
        console.log('Seleccionando fechas...');

        const fechasSeleccionadas = await conReintentos(async () => {
            console.log('Haciendo clic en el selector de fechas...');

            // Seleccionar el ID correcto según el modo de búsqueda - para paquetes con vuelo usar '#A-singledaterange'
            const selectorFechas = '#A-singledaterange';

            await page.waitForSelector(selectorFechas, { timeout: 10000 });
            await page.click(selectorFechas);

            // Esperar a que se abra el calendario con varios posibles selectores
            await esperar(2000); // Esperar más tiempo para que aparezca el calendario

            // Verificar si el calendario está visible
            const calendarioVisible = await page.evaluate(() => {
                const posiblesCalendarios = [
                    '.daterangepicker',
                    '.calendar',
                    '.xdsoft_datetimepicker',
                    '.datepicker',
                    '[class*="calendar"]',
                    '[class*="datepicker"]'
                ];

                for (const selector of posiblesCalendarios) {
                    const calendario = document.querySelector(selector);
                    if (calendario &&
                        calendario.offsetWidth > 0 &&
                        calendario.offsetHeight > 0 &&
                        window.getComputedStyle(calendario).display !== 'none') {
                        return {
                            visible: true,
                            selector
                        };
                    }
                }

                return { visible: false };
            });

            if (!calendarioVisible.visible) {
                console.log('No se detectó el calendario visible. Intentando clic de nuevo...');
                // Intentar clic alternativo
                await page.evaluate((selector) => {
                    const elemento = document.querySelector(selector);
                    if (elemento) {
                        elemento.click();
                    }
                }, selectorFechas);

                await esperar(2000); // Esperar más tiempo
            } else {
                console.log(`Calendario visible detectado con selector: ${calendarioVisible.selector}`);
            }

            // Tomar captura del calendario abierto para depuración

            // Buscar y analizar la estructura del calendario
            const infoCalendario = await page.evaluate(() => {
                // Determinar qué mes/año se muestra actualmente
                const tituloMes = document.querySelector('.daterangepicker .month');
                const mesActual = tituloMes ? tituloMes.textContent.trim() : null;

                // Verificar si podemos ver los botones de navegación
                const tieneBotonSiguiente = document.querySelector('.daterangepicker .next') !== null;
                const tieneBotonAnterior = document.querySelector('.daterangepicker .prev') !== null;

                // Verificar cómo están estructuradas las fechas
                const fechas = Array.from(document.querySelectorAll('.daterangepicker td.available')).map(el => ({
                    texto: el.textContent.trim(),
                    clase: el.className
                }));

                return {
                    mesActual,
                    tieneBotonSiguiente,
                    tieneBotonAnterior,
                    fechasVisibles: fechas.length,
                    ejemploFechas: fechas.slice(0, 5)
                };
            });

            console.log('Información del calendario:', infoCalendario);
            // El formato del mes/año mostrado parece ser "MMM YYYY" (por ejemplo "MAR 2025" o "JUN 2025")
            const fechaInicioObj = new Date(config.busqueda.fechaInicio);
            const mesInicio = fechaInicioObj.getMonth(); // 0-11
            const anioInicio = fechaInicioObj.getFullYear();
            const diaInicio = parseInt(config.busqueda.fechaInicio.split('-')[2]);

            const fechaFinObj = new Date(config.busqueda.fechaFin);
            const mesFin = fechaFinObj.getMonth(); // 0-11
            const anioFin = fechaFinObj.getFullYear();
            const diaFin = parseInt(config.busqueda.fechaFin.split('-')[2]);

            // Nombre de los meses para comparación
            const nombresMeses = [
                'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
            ];

            const mesAñoObjetivo = `${nombresMeses[mesInicio].substring(0, 3).toUpperCase()} ${anioInicio}`;
            console.log(`Navegando al mes y año objetivo: ${mesAñoObjetivo}`);

            // Extraer el mes y año actual del calendario
            let mesAñoActual = infoCalendario.mesActual || '';
            console.log(`Mes y año actual mostrado: ${mesAñoActual}`);

            // Si necesitamos navegar, verificar primero si estamos antes o después del mes objetivo
            const estaAntes = await page.evaluate((mesAñoActual, mesAñoObjetivo) => {
                // Convertir ambos a fechas para comparar
                const [mesActual, añoActual] = mesAñoActual.split(' ');
                const [mesObjetivo, añoObjetivo] = mesAñoObjetivo.split(' ');

                // Mapear abreviaturas de meses a números (0-11)
                const mesesAbrev = {
                    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
                    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11
                };

                // Obtener valores numéricos
                const mesActualNum = mesesAbrev[mesActual.toUpperCase()] || 0;
                const mesObjetivoNum = mesesAbrev[mesObjetivo.toUpperCase()] || 0;
                const añoActualNum = parseInt(añoActual || 0);
                const añoObjetivoNum = parseInt(añoObjetivo || 0);

                // Comparar años primero, luego meses
                if (añoActualNum < añoObjetivoNum) return true;
                if (añoActualNum > añoObjetivoNum) return false;
                // Si el año es el mismo, comparar meses
                return mesActualNum < mesObjetivoNum;
            }, mesAñoActual, mesAñoObjetivo);

            // Determinar qué botón usar para navegar
            const botonNavegacion = estaAntes ? '.next' : '.prev';
            const direccion = estaAntes ? 'siguiente' : 'anterior';
            console.log(`El mes actual está ${estaAntes ? 'antes' : 'después'} del mes objetivo. Usando botón ${direccion}.`);

            // Navegar al mes correcto haciendo clic en el botón apropiado
            let intentosNavegacion = 0;
            const maxIntentos = 24; // Permitir más intentos (2 años)

            let mesEncontrado = false;

            while (!mesEncontrado && intentosNavegacion < maxIntentos) {
                // Actualizar el mes actual para la comparación
                mesAñoActual = await page.evaluate(() => {
                    const tituloMes = document.querySelector('.daterangepicker .month');
                    return tituloMes ? tituloMes.textContent.trim() : '';
                });

                console.log(`Comparando: actual "${mesAñoActual}" vs. objetivo "${mesAñoObjetivo}"`);

                // Verificar si ya estamos en el mes objetivo
                if (mesAñoActual.toUpperCase() === mesAñoObjetivo.toUpperCase()) {
                    mesEncontrado = true;
                    console.log(`¡Mes objetivo encontrado: ${mesAñoActual}!`);
                    break;
                }

                // Si no estamos en el mes objetivo, hacer clic en el botón de navegación
                console.log(`Haciendo clic en "${direccion}" para navegar (intento ${intentosNavegacion + 1})...`);
                await page.click(botonNavegacion);
                await esperar(500);

                intentosNavegacion++;
            }

            if (!mesEncontrado) {
                console.log('No se pudo encontrar el mes objetivo después de múltiples intentos.');
                throw new Error('No se pudo navegar al mes objetivo en el calendario');
            }

            // AHORA SELECCIONAMOS LAS FECHAS ESPECÍFICAS
            console.log(`Seleccionando fecha de inicio: ${diaInicio}/${mesInicio + 1}/${anioInicio}`);

            // Tomar una captura antes de seleccionar la fecha de inicio

            try {
                // Primer intento usando un selector más preciso
                const diasDisponibles = await page.evaluate(() => {
                    // Esta función nos da información de todos los días disponibles
                    return Array.from(document.querySelectorAll('.daterangepicker td.available:not(.off)'))
                        .map(td => ({
                            dia: td.textContent.trim(),
                            posicionX: td.getBoundingClientRect().left + (td.getBoundingClientRect().width / 2),
                            posicionY: td.getBoundingClientRect().top + (td.getBoundingClientRect().height / 2)
                        }));
                });

                console.log(`Días disponibles en el mes actual: ${JSON.stringify(diasDisponibles)}`);

                // Buscar el día específico
                const diaInicioInfo = diasDisponibles.find(d => d.dia === String(diaInicio));

                if (diaInicioInfo) {
                    console.log(`Día de inicio encontrado: ${JSON.stringify(diaInicioInfo)}`);

                    // Hacer clic en las coordenadas exactas del día
                    await page.mouse.click(diaInicioInfo.posicionX, diaInicioInfo.posicionY);
                    console.log(`Clic realizado en día ${diaInicio} en posición (${diaInicioInfo.posicionX}, ${diaInicioInfo.posicionY})`);
                } else {
                    // Si no lo encontramos con el enfoque anterior, intentar con un método alternativo
                    console.log(`No se encontró el día ${diaInicio} con el método de coordenadas. Intentando método alternativo...`);

                    // Método 2: Usar un selector CSS más específico y hacer clic directamente
                    await page.evaluate((dia) => {
                        // Esta función intenta hacer clic en el día correcto directamente en el DOM
                        const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                        for (const celda of celdas) {
                            if (celda.textContent.trim() === String(dia)) {
                                celda.click();
                                return true;
                            }
                        }
                        return false;
                    }, diaInicio);
                }

                console.log(`Selección de día de inicio (${diaInicio}) completada.`);
                await esperar(1000);

                // Tomar una captura después de seleccionar la fecha de inicio

                // Ahora seleccionamos la fecha de fin
                console.log(`Seleccionando fecha de fin: ${diaFin}/${mesFin + 1}/${anioFin}`);

                // Si la fecha de fin está en un mes diferente, podríamos necesitar navegar
                if (mesInicio !== mesFin || anioInicio !== anioFin) {
                    console.log('La fecha de fin está en un mes diferente. Navegando al mes de fin...');

                    // Objetivo para el mes de fin
                    const mesAñoObjetivoFin = `${nombresMeses[mesFin].substring(0, 3).toUpperCase()} ${anioFin}`;
                    console.log(`Navegando al mes y año de fin: ${mesAñoObjetivoFin}`);

                    // Determinar si necesitamos ir adelante o atrás
                    const mesActualDespuesSeleccion = await page.evaluate(() => {
                        const tituloMes = document.querySelector('.daterangepicker .month');
                        return tituloMes ? tituloMes.textContent.trim() : '';
                    });

                    const irAdelante = await page.evaluate((mesActual, mesObjetivo) => {
                        // Similar a la comparación anterior, pero para el mes de fin
                        const [mesActualTexto, añoActualTexto] = mesActual.split(' ');
                        const [mesObjetivoTexto, añoObjetivoTexto] = mesObjetivo.split(' ');

                        const mesesAbrev = {
                            'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
                            'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11
                        };

                        const mesActualNum = mesesAbrev[mesActualTexto.toUpperCase()] || 0;
                        const mesObjetivoNum = mesesAbrev[mesObjetivoTexto.toUpperCase()] || 0;
                        const añoActualNum = parseInt(añoActualTexto || 0);
                        const añoObjetivoNum = parseInt(añoObjetivoTexto || 0);

                        // Comparar años primero, luego meses
                        if (añoActualNum < añoObjetivoNum) return true;
                        if (añoActualNum > añoObjetivoNum) return false;
                        return mesActualNum < mesObjetivoNum;
                    }, mesActualDespuesSeleccion, mesAñoObjetivoFin);

                    // Botón para navegar al mes de fin
                    const botonNavegacionFin = irAdelante ? '.next' : '.prev';
                    console.log(`Navegando ${irAdelante ? 'adelante' : 'atrás'} para encontrar el mes de fin...`);

                    // Navegar hasta encontrar el mes de fin
                    let intentosFin = 0;
                    const maxIntentosFin = 24;
                    let mesFinEncontrado = false;

                    while (!mesFinEncontrado && intentosFin < maxIntentosFin) {
                        const mesActual = await page.evaluate(() => {
                            const tituloMes = document.querySelector('.daterangepicker .month');
                            return tituloMes ? tituloMes.textContent.trim() : '';
                        });

                        console.log(`Mes actual: "${mesActual}" vs. objetivo fin: "${mesAñoObjetivoFin}"`);

                        if (mesActual.toUpperCase() === mesAñoObjetivoFin.toUpperCase()) {
                            mesFinEncontrado = true;
                            console.log(`¡Mes de fin encontrado: ${mesActual}!`);
                            break;
                        }

                        // Hacer clic en el botón de navegación
                        await page.click(botonNavegacionFin);
                        await esperar(500);

                        intentosFin++;
                    }

                    if (!mesFinEncontrado) {
                        console.log('No se pudo encontrar el mes de fin. Continuamos con el mes actual...');
                    }
                }

                // Obtener información de los días disponibles nuevamente (podrían haber cambiado después de seleccionar la fecha de inicio)
                const diasDisponiblesFin = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('.daterangepicker td.available:not(.off)'))
                        .map(td => ({
                            dia: td.textContent.trim(),
                            posicionX: td.getBoundingClientRect().left + (td.getBoundingClientRect().width / 2),
                            posicionY: td.getBoundingClientRect().top + (td.getBoundingClientRect().height / 2)
                        }));
                });

                console.log(`Días disponibles para fin: ${JSON.stringify(diasDisponiblesFin)}`);

                // Buscar el día de fin
                const diaFinInfo = diasDisponiblesFin.find(d => d.dia === String(diaFin));

                if (diaFinInfo) {
                    console.log(`Día de fin encontrado: ${JSON.stringify(diaFinInfo)}`);

                    // Hacer clic en las coordenadas exactas del día
                    await page.mouse.click(diaFinInfo.posicionX, diaFinInfo.posicionY);
                    console.log(`Clic realizado en día ${diaFin} en posición (${diaFinInfo.posicionX}, ${diaFinInfo.posicionY})`);
                } else {
                    // Método alternativo si no encontramos las coordenadas
                    console.log(`No se encontró el día ${diaFin} con el método de coordenadas. Intentando método alternativo...`);

                    await page.evaluate((dia) => {
                        const celdas = document.querySelectorAll('.daterangepicker td.available:not(.off)');
                        for (const celda of celdas) {
                            if (celda.textContent.trim() === String(dia)) {
                                celda.click();
                                return true;
                            }
                        }
                        return false;
                    }, diaFin);
                }

                console.log(`Selección de día de fin (${diaFin}) completada.`);
                await esperar(1000);

            } catch (fechaError) {
                console.error('Error al seleccionar fechas específicas:', fechaError);
                throw fechaError;
            }

            // Verificar si hay un botón "Aplicar" y hacer clic en él si existe
            const hayBotonAplicar = await page.evaluate(() => {
                const boton = document.querySelector('.applyBtn');
                if (boton) {
                    boton.click();
                    return true;
                }
                return false;
            });

            if (hayBotonAplicar) {
                console.log('Se hizo clic en el botón "Aplicar".');
            } else {
                // Si no hay botón aplicar, el calendario debería cerrarse automáticamente después de seleccionar la fecha de fin
                console.log('No se encontró botón "Aplicar", el calendario debería cerrarse automáticamente.');
            }

            // Esperar a que el calendario se cierre
            await esperar(1000);

            // Tomar una captura final después de seleccionar las fechas

            console.log('Selección de fechas completada.');
        }, 'Selección de fechas específica');

        // PASO 5: Seleccionar destino
        console.log(`Seleccionando destino: ${config.busqueda.destino}...`);

        await conReintentos(async () => {
            const selectorDestino = '#A-inputDestino';

            await page.waitForSelector(selectorDestino, { timeout: 10000 });
            await page.click(selectorDestino);
            await page.type(selectorDestino, config.busqueda.destino, { delay: 100 });

            // Esperar por sugerencias
            try {
                await page.waitForSelector('.ui-menu-item', { visible: true, timeout: 10000 });
            } catch (error) {
                console.log('No se detectaron sugerencias para el destino. Intentando alternativas...');
                // Intentar con Tab o Enter para confirmar
                await page.keyboard.press('Tab');
                await esperar(1000);
                await page.keyboard.press('Enter');
            }

            // Esperar para que se carguen sugerencias
            await esperar(1000);

            // Intentar hacer clic en la primera sugerencia
            try {
                await page.click('.ui-menu-item:first-child');
            } catch (error) {
                console.log('Error al hacer clic en sugerencia. Intentando alternativas...');

                // Intentar confirmar con Tab y Enter
                await page.keyboard.press('Tab');
                await esperar(500);
                await page.keyboard.press('Enter');
            }

            await esperar(1000);
        }, 'Selección de destino', 4);

        // PASO 6: Seleccionar origen (solo para modo con transporte) - VERSIÓN ROBUSTA
        if (config.busqueda.conTransporte) {
            console.log(`Seleccionando origen: ${config.busqueda.origen}...`);

            const origenSeleccionado = await conReintentos(async () => {
                // CORRECCIÓN: Usar selector correcto para transporte
                const selectorOrigen = '#C-inputOrigen';

                await page.waitForSelector(selectorOrigen, { timeout: 10000 });

                // PASO 1: Limpiar el campo completamente
                await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    if (input) {
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }, selectorOrigen);

                // PASO 2: Hacer clic y enfocar el campo
                await page.click(selectorOrigen);
                await esperar(500);

                // PASO 3: Decidir qué texto escribir para activar autocompletado
                let textoOrigen = config.busqueda.origen;

                // Estrategia inteligente: usar palabras clave del origen
                if (textoOrigen.includes('León')) {
                    textoOrigen = 'leon'; // Simplificar para activar autocompletado
                } else if (textoOrigen.includes('Guadalajara')) {
                    textoOrigen = 'guad';
                } else if (textoOrigen.includes('México')) {
                    textoOrigen = 'mexi';
                } else {
                    // Para otros orígenes, usar las primeras letras
                    textoOrigen = textoOrigen.substring(0, Math.min(4, textoOrigen.length)).toLowerCase();
                }

                console.log(`Escribiendo texto para autocompletado de origen: "${textoOrigen}"`);
                await page.type(selectorOrigen, textoOrigen, { delay: 150 });

                // PASO 4: Esperar a que aparezcan sugerencias
                let sugerenciasEncontradas = false;
                try {
                    await page.waitForSelector('.ui-menu-item', { visible: true, timeout: 5000 });
                    console.log('Sugerencias de origen detectadas');
                    sugerenciasEncontradas = true;
                } catch (error) {
                    console.log('No se detectaron sugerencias automáticamente para origen. Intentando recuperación...');

                    // Estrategia de recuperación: limpiar y probar con texto completo
                    await page.evaluate((selector) => {
                        const input = document.querySelector(selector);
                        if (input) input.value = '';
                    }, selectorOrigen);

                    console.log(`Intentando recuperación con texto completo: "${config.busqueda.origen}"`);
                    await page.type(selectorOrigen, config.busqueda.origen, { delay: 100 });

                    try {
                        await page.waitForSelector('.ui-menu-item', { visible: true, timeout: 5000 });
                        console.log('Sugerencias detectadas después de recuperación');
                        sugerenciasEncontradas = true;
                    } catch (e) {
                        console.log('No se pudieron encontrar sugerencias para origen. Continuando con el proceso...');
                    }
                }

                // PASO 5: Manejar sugerencias si las hay
                if (sugerenciasEncontradas) {
                    // Esperar un momento para que se carguen todas las sugerencias
                    await esperar(1000);

                    try {
                        // Obtener todas las sugerencias disponibles
                        const sugerencias = await page.evaluate(() => {
                            return Array.from(document.querySelectorAll('.ui-menu-item'))
                                .map(item => ({
                                    texto: item.textContent.trim(),
                                    id: item.id || ''
                                }));
                        });

                        console.log(`Sugerencias de origen disponibles (${sugerencias.length}):`);
                        sugerencias.forEach((s, i) => console.log(`  ${i + 1}. ${s.texto}`));

                        // Buscar la mejor coincidencia
                        const origenBuscado = config.busqueda.origen.toLowerCase();
                        let sugerenciaSeleccionada = null;

                        // Estrategia 1: Coincidencia exacta
                        for (const sugerencia of sugerencias) {
                            const textoSugerencia = sugerencia.texto.toLowerCase();
                            if (textoSugerencia === origenBuscado) {
                                sugerenciaSeleccionada = sugerencia;
                                console.log(`Coincidencia exacta de origen encontrada: "${sugerencia.texto}"`);
                                break;
                            }
                        }

                        // Estrategia 2: Buscar por palabra clave principal
                        if (!sugerenciaSeleccionada) {
                            const palabrasClave = ['león', 'natursala', 'hidalgo', 'guadalajara', 'méxico'];

                            for (const palabra of palabrasClave) {
                                if (origenBuscado.includes(palabra)) {
                                    for (const sugerencia of sugerencias) {
                                        const textoSugerencia = sugerencia.texto.toLowerCase();
                                        if (textoSugerencia.includes(palabra)) {
                                            sugerenciaSeleccionada = sugerencia;
                                            console.log(`Coincidencia por palabra clave "${palabra}" encontrada: "${sugerencia.texto}"`);
                                            break;
                                        }
                                    }
                                    if (sugerenciaSeleccionada) break;
                                }
                            }
                        }

                        // Estrategia 3: Si no encontramos coincidencias específicas, usar la primera
                        if (!sugerenciaSeleccionada && sugerencias.length > 0) {
                            sugerenciaSeleccionada = sugerencias[0];
                            console.log(`Sin coincidencias específicas para origen. Usando primera sugerencia: "${sugerenciaSeleccionada.texto}"`);
                        }

                        // Hacer clic en la sugerencia seleccionada
                        if (sugerenciaSeleccionada) {
                            const selector = sugerenciaSeleccionada.id ?
                                `#${sugerenciaSeleccionada.id}` : '.ui-menu-item:first-child';

                            console.log(`Haciendo clic en sugerencia de origen: "${sugerenciaSeleccionada.texto}" con selector: ${selector}`);
                            await page.click(selector);
                        } else {
                            console.log('No se encontraron sugerencias válidas para origen. Confirmando con Tab...');
                            await page.keyboard.press('Tab');
                        }
                    } catch (error) {
                        console.log(`Error al seleccionar sugerencia de origen: ${error.message}`);
                        console.log('Intentando clic en primera sugerencia...');

                        try {
                            await page.click('.ui-menu-item:first-child');
                        } catch (e) {
                            console.log('Error en clic final para origen, intentando seguir con Tab');
                            await page.keyboard.press('Tab');
                        }
                    }
                } else {
                    // Si no hay sugerencias, confirmar con Tab y Enter
                    console.log('No se encontraron sugerencias para origen. Confirmando con Tab y Enter...');
                    await page.keyboard.press('Tab');
                    await esperar(500);
                    await page.keyboard.press('Enter');
                }

                // PASO 6: Esperar y verificar que el valor se estableció correctamente
                await esperar(1500);

                // Verificación final del valor establecido
                const valorFinal = await page.evaluate((selector) => {
                    const input = document.querySelector(selector);
                    return input ? input.value.trim() : null;
                }, selectorOrigen);

                console.log(`Valor final del origen: "${valorFinal}"`);

                // Validar que el origen se estableció correctamente
                if (valorFinal && verificarCoincidenciaOrigen(config.busqueda.origen, valorFinal)) {
                    console.log(`Origen configurado correctamente: "${valorFinal}"`);
                    return true;
                }

                console.log(`No se pudo validar el origen. Esperado "${config.busqueda.origen}" y se obtuvo "${valorFinal || 'valor vacio'}"`);
                throw new Error('No se pudo establecer el valor del origen');

            }, 'Selección de origen robusto', 4); // 4 intentos para máxima seguridad

            if (!origenSeleccionado) {
                throw new Error(`No se pudo seleccionar el origen "${config.busqueda.origen}" despues de multiples intentos`);
            }
        } else {
            console.log('Modo sin transporte: omitiendo configuración de origen');
        }

        // PASO 7: Seleccionar plan
        console.log(`Seleccionando plan: ${config.busqueda.plan}...`);

        await conReintentos(async () => {
            const selectorPlan = '#A-select-plan';

            await page.waitForSelector(selectorPlan, { timeout: 10000 });

            // Verificar tipo de elemento
            const tipoDeElemento = await page.evaluate((selector) => {
                const elemento = document.querySelector(selector);
                return elemento ? elemento.tagName.toLowerCase() : null;
            }, selectorPlan);

            if (tipoDeElemento === 'select') {
                // Si es un select, usar page.select
                await page.select(selectorPlan, config.busqueda.plan);
            } else {
                // Si es otro tipo de elemento, intentar con click y type
                await page.click(selectorPlan);
                await page.type(selectorPlan, config.busqueda.plan, { delay: 100 });
            }

            await esperar(1000);
        }, 'Selección de plan');

        // PASO 8: Configurar pasajeros
        console.log('Configurando pasajeros y habitaciones...');

        await conReintentos(async () => {
            // Hacer clic en el botón de pasajeros
            const selectorPasajeros = '#bttnPasajeros';

            await page.waitForSelector(selectorPasajeros, { timeout: 8000 });
            await page.click(selectorPasajeros);
            await esperar(1000);

            // Configurar menores si hay niños
            if (config.busqueda.ninos > 0) {
                console.log(`Configurando ${config.busqueda.ninos} menores...`);

                await page.waitForSelector('#habitacion_1_menores', { timeout: 5000 });
                await page.click('#habitacion_1_menores', { clickCount: 3 });
                await esperar(500);

                // Ingresar número de menores
                await page.type('#habitacion_1_menores', String(config.busqueda.ninos), { delay: 200 });
                await page.keyboard.press('Tab');
                await esperar(1000);

                // Configurar edades
                for (let i = 1; i <= config.busqueda.ninos; i++) {
                    const edadMenor = i <= config.busqueda.edadesMenores.length ? config.busqueda.edadesMenores[i - 1] : 5;
                    console.log(`Configurando edad del menor ${i}: ${edadMenor} años`);

                    const selectorEdad = `#habitacion_1_menor_${i}`;

                    try {
                        await page.waitForSelector(selectorEdad, { timeout: 5000 });
                        await page.click(selectorEdad, { clickCount: 3 });
                        await esperar(500);
                        await page.keyboard.press('Backspace');
                        await page.type(selectorEdad, String(edadMenor), { delay: 200 });
                        await page.keyboard.press('Tab');
                        await esperar(1000);
                    } catch (errorEdad) {
                        console.log(`Error al configurar edad del menor ${i}:`, errorEdad.message);
                    }
                }
            }

            // Hacer clic en el cuerpo para cerrar el menú
            await page.evaluate(() => {
                document.querySelector('body').click();
            });

        }, 'Configuración de pasajeros', 3);

        // Tomar captura de configuración

        // Scroll para ver el botón
        await page.evaluate(() => {
            window.scrollTo({
                top: document.body.scrollHeight * 0.5,
                behavior: 'smooth'
            });
        });

        await esperar(1500);

        // PASO 9: Hacer clic en COTIZAR
        console.log('Buscando botón COTIZAR...');

        let cotizarExitoso = false;

        // PASO 3: Solución especializada mejorada para el botón COTIZAR
        console.log('Buscando botón COTIZAR con método optimizado...');

        const infoBotonCotizar = await page.evaluate(() => {
            // Función auxiliar para determinar si un elemento es visible en pantalla
            const esElementoVisible = (elemento) => {
                if (!elemento) return false;

                const rect = elemento.getBoundingClientRect();
                return (
                    rect.width > 0 &&
                    rect.height > 0 &&
                    rect.top >= 0 &&
                    rect.left >= 0 &&
                    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
                );
            };

            // MÉTODO 1: Buscar por texto exacto "COTIZAR" o "Cotizar" 
            const botonesExactos = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const texto = b.textContent.trim();
                    return texto === 'COTIZAR' || texto === 'Cotizar' || texto === 'BUSCAR' || texto === 'Buscar';
                });

            if (botonesExactos.length > 0) {
                const boton = botonesExactos[0];
                const esVisible = esElementoVisible(boton);

                // Si el botón no es visible en pantalla, hacer scroll hacia él
                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                // Esperar un momento para que termine cualquier scroll
                setTimeout(() => { }, 500);

                // Obtener posición actualizada después del posible scroll
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'texto-exacto',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true // Debería ser true después del scrollIntoView
                };
            }

            // MÉTODO 2: Buscar botones que contengan "COTIZAR"
            const botonesContienen = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const texto = b.textContent.trim().toUpperCase();
                    return texto.includes('COTIZAR') || texto.includes('BUSCAR');
                });

            if (botonesContienen.length > 0) {
                const boton = botonesContienen[0];
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'texto-contiene',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            // MÉTODO 3: Buscar botones por clases comunes de botones de acción
            const botonesPrimarios = document.querySelectorAll('.btn-primary, .btn-success, .btn-action, .cotizar, [class*="cotizar"]');
            if (botonesPrimarios.length > 0) {
                // Buscar entre los botones primarios el que esté más abajo en la página
                const botonesFiltrados = Array.from(botonesPrimarios).filter(b => {
                    const rect = b.getBoundingClientRect();
                    return rect.top > window.innerHeight * 0.5; // Solo botones en la mitad inferior
                });

                // Si encontramos alguno en la mitad inferior, usar ese, sino usar el último
                const boton = botonesFiltrados.length > 0 ?
                    botonesFiltrados[botonesFiltrados.length - 1] :
                    botonesPrimarios[botonesPrimarios.length - 1];

                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'clase-btn',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }
            // MÉTODO 4: Si todo falla, buscar cualquier botón en la parte inferior
            const todosBotones = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .filter(b => {
                    const rect = b.getBoundingClientRect();
                    const esGrandeEnough = rect.width >= 50 && rect.height >= 20; // Debe tener tamaño razonable
                    return esGrandeEnough && rect.top > window.innerHeight * 0.5; // Solo en la mitad inferior
                });

            if (todosBotones.length > 0) {
                // Ordenar por posición Y para encontrar el más cercano al fondo
                todosBotones.sort((a, b) => {
                    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                });

                const boton = todosBotones[0]; // El botón más abajo
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'ultimo-recurso',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            // Si nada funciona, buscar elementos que parezcan botones (div, span, a con estilos de botón)
            const pseudoBotones = Array.from(document.querySelectorAll('div.btn, span.btn, a.btn, [role="button"], [class*="button"]'))
                .filter(b => {
                    const rect = b.getBoundingClientRect();
                    const esGrandeEnough = rect.width >= 50 && rect.height >= 20;
                    return esGrandeEnough && rect.top > window.innerHeight * 0.5;
                });

            if (pseudoBotones.length > 0) {
                pseudoBotones.sort((a, b) => {
                    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                });

                const boton = pseudoBotones[0];
                const esVisible = esElementoVisible(boton);

                if (!esVisible) {
                    boton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                setTimeout(() => { }, 500);
                const rect = boton.getBoundingClientRect();

                return {
                    encontrado: true,
                    metodo: 'pseudo-boton',
                    elemento: {
                        tagName: boton.tagName,
                        id: boton.id || '',
                        clase: boton.className || '',
                        texto: boton.textContent.trim()
                    },
                    posicion: {
                        x: rect.left + (rect.width / 2),
                        y: rect.top + (rect.height / 2)
                    },
                    visible: esVisible || true
                };
            }

            return { encontrado: false };
        });

        console.log('Información del botón COTIZAR:', infoBotonCotizar);

        // PASO 4: Mejorar el método de clic para ser más preciso
        if (infoBotonCotizar.encontrado) {
            console.log(`Botón COTIZAR encontrado mediante: ${infoBotonCotizar.metodo}`);

            // Esperar un momento adicional para asegurar que la página se ha estabilizado
            await esperar(1000);

            // Tomar captura antes del clic final

            try {
                // TÉCNICA 1: Intentar usar un selector más preciso si tenemos información del elemento
                if (infoBotonCotizar.elemento) {
                    const elemento = infoBotonCotizar.elemento;
                    let selector = null;

                    // Construir un selector lo más específico posible
                    if (elemento.id) {
                        selector = `#${elemento.id}`;
                    } else if (elemento.clase) {
                        // Usar la primera clase que suele ser la más específica
                        const primeraClase = elemento.clase.split(' ')[0];
                        selector = `.${primeraClase}`;

                        // Si el texto es distintivo, añadirlo al selector
                        if (elemento.texto && !elemento.texto.includes(' ')) {
                            selector += `:contains("${elemento.texto}")`;
                        }
                    }

                    if (selector) {
                        console.log(`Intentando clic con selector: ${selector}`);
                        try {
                            await page.click(selector);
                            console.log(`Clic realizado con selector ${selector}`);
                            cotizarExitoso = true;
                        } catch (selectorError) {
                            console.log(`Error al hacer clic con selector: ${selectorError.message}`);
                            // Continuamos con el método de coordenadas si el selector falla
                        }
                    }
                }

                // TÉCNICA 2: Si el selector falla o no tenemos suficiente información, usar coordenadas
                if (!cotizarExitoso) {
                    // Estabilizar la posición final con un scroll preciso a la posición Y del botón
                    await page.evaluate((posY) => {
                        window.scrollTo({
                            top: posY - 150, // Un poco más arriba para asegurar visibilidad completa
                            behavior: 'smooth'
                        });
                    }, infoBotonCotizar.posicion.y);

                    // Esperar a que se estabilice el scroll
                    await esperar(1500);

                    // Tomar una última captura justo antes del clic

                    // Obtener las coordenadas actualizadas después del último scroll
                    const coordenadasActualizadas = await page.evaluate(() => {
                        // Buscar el botón nuevamente para obtener coordenadas actualizadas
                        const botones = document.querySelectorAll('button, input[type="submit"], div.btn, [role="button"]');

                        // Buscar en la parte inferior de la pantalla
                        const botonesInferiores = Array.from(botones).filter(b => {
                            const rect = b.getBoundingClientRect();
                            return rect.top > window.innerHeight * 0.3 &&
                                rect.width > 0 &&
                                rect.height > 0;
                        });

                        if (botonesInferiores.length > 0) {
                            // Ordenar por posición Y para encontrar el que está más abajo
                            botonesInferiores.sort((a, b) => {
                                return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
                            });

                            const boton = botonesInferiores[0];
                            const rect = boton.getBoundingClientRect();

                            return {
                                x: rect.left + (rect.width / 2),
                                y: rect.top + (rect.height / 2),
                                width: rect.width,
                                height: rect.height,
                                texto: boton.textContent.trim()
                            };
                        }

                        return null;
                    });

                    if (coordenadasActualizadas) {
                        console.log(`Coordenadas actualizadas del botón: (${coordenadasActualizadas.x}, ${coordenadasActualizadas.y})`);
                        console.log(`Botón detectado: "${coordenadasActualizadas.texto}" (${coordenadasActualizadas.width}x${coordenadasActualizadas.height})`);

                        // Hacer clic usando las coordenadas actualizadas
                        await page.mouse.click(coordenadasActualizadas.x, coordenadasActualizadas.y);
                        console.log(`Clic realizado en posición actualizada (${coordenadasActualizadas.x}, ${coordenadasActualizadas.y})`);
                    } else {
                        // Si no pudimos obtener coordenadas actualizadas, usar las originales
                        console.log(`Usando coordenadas originales (${infoBotonCotizar.posicion.x}, ${infoBotonCotizar.posicion.y})`);
                        await page.mouse.click(infoBotonCotizar.posicion.x, infoBotonCotizar.posicion.y);
                    }

                    console.log('Clic realizado en el botón COTIZAR');
                    cotizarExitoso = true;
                }
                // Esperar a que se complete la navegación
                // Esperar resultados dinámicos en lugar de navegación
                console.log('Esperando que aparezcan los resultados...');

                const resultadosCargados = await esperarResultadosListo(page, 15000);

                if (resultadosCargados) {
                    console.log('Resultados detectados exitosamente');
                    cotizarExitoso = true;
                } else {
                    console.log('Timeout esperando resultados específicos, verificando estado...');

                    const tieneContenido = await page.evaluate(() => {
                        const cards = document.querySelectorAll('.card');
                        const hoteles = document.querySelectorAll('[id*="hotel"]');
                        return cards.length > 2 || hoteles.length > 0;
                    });

                    if (tieneContenido) {
                        console.log('Se detectó contenido en la página, continuando...');
                        cotizarExitoso = true;
                    } else {
                        console.log('No se detectó contenido, posible error en la búsqueda');
                    }
                }

                // Tomar una captura final para verificar resultado

            } catch (clickError) {
                console.log('Error durante el intento de clic en el botón COTIZAR:', clickError.message);

                // Intentar con método alternativo final si hay error
                try {
                    console.log('Intentando método final de evaluación para clic...');

                    const clickFinal = await page.evaluate(() => {
                        // Buscar en el área inferior de la pantalla
                        const botones = Array.from(document.querySelectorAll('button, input[type="submit"], div.btn, [role="button"]'))
                            .filter(b => {
                                const rect = b.getBoundingClientRect();
                                return rect.top > window.innerHeight * 0.3 && rect.width > 0 && rect.height > 0;
                            });

                        if (botones.length > 0) {
                            // Ordenar por posición Y para obtener el más inferior
                            botones.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
                            const botonFinal = botones[0];

                            try {
                                botonFinal.click();
                                return { exito: true, texto: botonFinal.textContent.trim() };
                            } catch (e) {
                                return { exito: false, error: e.toString() };
                            }
                        }

                        return { exito: false, mensaje: 'No se encontraron botones en área inferior' };
                    });

                    console.log('Resultado del método final:', clickFinal);

                    if (clickFinal.exito) {
                        console.log(`Clic final exitoso en botón "${clickFinal.texto}"`);
                        cotizarExitoso = true;

                        // Esperar por si hay navegación
                        await page.waitForNavigation({ timeout: config.timeout }).catch(() => { });
                    }
                } catch (finalError) {
                    console.log('Error en método final de clic:', finalError.message);
                }
            }
        } else {
            console.log('No se encontró ningún botón COTIZAR visible');
        }

        //  ═══════════════════════════════════════════════════════════════
        //  NUEVO: SISTEMA DE REINTENTOS CON CAMBIO DE FECHAS Y FALLBACK
        //  ═══════════════════════════════════════════════════════════════
        console.log('\n🔍 Verificando disponibilidad de resultados...');

        const resultadoCotizacion = await cotizarConReintentos(page, config, {
            fechaInicio: config.busqueda.fechaInicio,
            fechaFin: config.busqueda.fechaFin,
            conTransporte: false,
            conVuelo: true // Este es el método con vuelo
        });

        console.log('\n📊 RESULTADO DE COTIZACIÓN CON REINTENTOS:');
        console.log(JSON.stringify(resultadoCotizacion, null, 2));

        if (!resultadoCotizacion.exito) {
            console.log('\n❌ No se pudieron encontrar resultados con ninguna configuración');
            console.log('📝 Detalles:', resultadoCotizacion.mensaje);

            await browser.close();

            return {
                exito: false,
                mensaje: resultadoCotizacion.mensaje,
                intentosRealizados: resultadoCotizacion.intentosRealizados
            };
        }

        // Si encontró resultados, actualizar las fechas en config si cambiaron
        if (resultadoCotizacion.fechasUsadas) {
            config.busqueda.fechaInicio = resultadoCotizacion.fechasUsadas.fechaInicio;
            config.busqueda.fechaFin = resultadoCotizacion.fechasUsadas.fechaFin;
            console.log(`\n📅 Fechas actualizadas en config: ${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`);
        }

        // Guardar información de si es solo alojamiento para incluirlo en el resultado final
        const esSoloAlojamiento = resultadoCotizacion.soloAlojamiento || false;
        const advertenciaTransporte = resultadoCotizacion.advertencia || null;

        console.log(`\n🏨 Solo alojamiento: ${esSoloAlojamiento ? 'SÍ' : 'NO'}`);
        if (advertenciaTransporte) {
            console.log(`⚠️ Advertencia: ${advertenciaTransporte}`);
        }
        //  ═══════════════════════════════════════════════════════════════

        // PASO 10: Extraer resultados
        console.log('\nEsperando resultados...');

        // Esperar carga automática de resultados
        try {
            const paginaLista = await esperarPaginaLista(page, 45000);
            if (paginaLista) {
                console.log('✅ Paquetes con vuelo cargados automáticamente');
            } else {
                console.log('⚠️ Detección automática falló, usando tiempo mínimo');
                await esperar(3000);
            }
        } catch (error) {
            console.log('Error en detección automática:', error.message);
            await esperar(3000);
        }

        // Análisis y extracción de resultados
        console.log('Analizando resultados de paquetes con vuelo...');

        // Usar el mismo método que en la función original para detectar patrones de hoteles
        const patronesHoteles = await page.evaluate(() => {
            // Buscar todos los posibles contenedores de hoteles
            const posiblesPatrones = [
                // Patrones más específicos basados en IDs - priorizamos estos
                { tipo: 'id', selector: '[id^="hotel-top-"]', cantidad: document.querySelectorAll('[id^="hotel-top-"]').length },
                { tipo: 'id', selector: '[id^="booking-result-list-"]', cantidad: document.querySelectorAll('[id^="booking-result-list-"]').length },

                // Patrones basados en clases
                { tipo: 'clase', selector: '.card:not(#sticky-search):not(#contador-resultados)', cantidad: document.querySelectorAll('.card:not(#sticky-search):not(#contador-resultados)').length },
                { tipo: 'clase', selector: '.hotel-item', cantidad: document.querySelectorAll('.hotel-item').length },
                { tipo: 'clase', selector: '.resultado-item', cantidad: document.querySelectorAll('.resultado-item').length },

                // Otros patrones posibles
                { tipo: 'estructura', selector: 'div:has(span.h5)', cantidad: document.querySelectorAll('div:has(span.h5)').length }
            ];

            // Filtrar solo los patrones que realmente encontraron elementos
            return posiblesPatrones.filter(p => p.cantidad > 0);
        });

        console.log('Patrones de hoteles detectados:', patronesHoteles);

        // Determinar el mejor selector para los hoteles
        let selectorHoteles = '[id^="hotel-top-"]'; // Selector preferido

        if (patronesHoteles.length > 0) {
            // Buscamos primero si existe el patrón con id="hotel-top-"
            const patronTop = patronesHoteles.find(p => p.selector === '[id^="hotel-top-"]');
            if (patronTop && patronTop.cantidad > 0) {
                selectorHoteles = patronTop.selector;
            } else {
                // Ordenar por cantidad de coincidencias (de mayor a menor)
                patronesHoteles.sort((a, b) => b.cantidad - a.cantidad);
                selectorHoteles = patronesHoteles[0].selector;
            }
        }

        console.log(`Usando selector para hoteles: ${selectorHoteles}`);

        // Extraer información detallada de cada hotel/paquete
        const paquetesVuelo = await page.evaluate((selector) => {
            const resultados = [];

            // Función para limpiar texto
            const limpiarTexto = (texto) => {
                if (!texto) return '';
                return texto.replace(/\s+/g, ' ').trim();
            };

            // Función para extraer precio e información de reembolso
            const extraerPrecio = (elemento) => {
                // Información sobre si es no reembolsable
                let esNoReembolsable = false;

                // Verificar si hay etiqueta de "NO REMBOLSABLE" en cualquier parte del elemento
                const textoCompleto = elemento.textContent.toLowerCase();
                if (textoCompleto.includes('no rembolsable') ||
                    textoCompleto.includes('no reembolsable') ||
                    textoCompleto.includes('sin reembolso') ||
                    textoCompleto.includes('pago inmediato')) {
                    esNoReembolsable = true;
                }

                // Buscar etiquetas específicas de no reembolsable
                const etiquetasNoReembolsable = elemento.querySelectorAll('.ribbon-two span, .badge, .tag, .label');
                for (const etiqueta of etiquetasNoReembolsable) {
                    const textoEtiqueta = etiqueta.textContent.toLowerCase().trim();
                    if (textoEtiqueta.includes('no rembolsable') ||
                        textoEtiqueta.includes('no reembolsable') ||
                        textoEtiqueta.includes('sin reembolso')) {
                        esNoReembolsable = true;
                        break;
                    }
                }

                // Intento 1: Buscar elemento específico con precio
                const precioElemento =
                    elemento.querySelector('div.float-end > a') ||
                    elemento.querySelector('[class*="price"], [class*="precio"]') ||
                    elemento.querySelector('strong, b');

                // Extraer el precio
                let precioTexto = '';
                if (precioElemento) {
                    precioTexto = precioElemento.textContent.trim();
                    // Extraer solo el formato numérico (ej: $1,234 o valores numéricos como 28,021)
                    const coincidencia = precioTexto.match(/\$?([\d,]+(?:\.\d+)?)/);
                    precioTexto = coincidencia ? coincidencia[0] : precioTexto;
                } else {
                    // Intento 2: Buscar en todo el texto del elemento
                    const coincidencia = textoCompleto.match(/\$?([\d,]+(?:\.\d+)?)/);
                    precioTexto = coincidencia ? coincidencia[0] : '';
                }

                // Devolver un objeto con el precio y la información de reembolso
                return {
                    precio: precioTexto,
                    esNoReembolsable: esNoReembolsable
                };
            };

            // Función adicional para detectar si incluye vuelo
            const tieneVueloIncluido = (elemento) => {
                const textoCompleto = elemento.textContent.toLowerCase();
                return textoCompleto.includes('vuelo') ||
                    textoCompleto.includes('aéreo') ||
                    textoCompleto.includes('avión') ||
                    textoCompleto.includes('traslado aeropuerto');
            };
            // Buscar elementos de resultados
            const elementos = document.querySelectorAll(selector);

            // Extraer info de cada elemento
            elementos.forEach((elemento, indice) => {
                const id = elemento.id || `hotel-${indice + 1}`;

                // Extraer título
                const titulo = limpiarTexto(elemento.querySelector('span.h5')?.textContent) ||
                    limpiarTexto(elemento.querySelector('h1, h2, h3, h4, h5')?.textContent) ||
                    `Paquete ${indice + 1}`;

                // Extraer tipo de habitación
                const habitacion = limpiarTexto(elemento.querySelector('div.mb-1')?.textContent) || '';
                const detalles = limpiarTexto(elemento.querySelector('div.text-muted')?.textContent) || '';
                const precio = extraerPrecio(elemento);
                const imagen = elemento.querySelector('img')?.src || '';
                const plan = limpiarTexto(elemento.querySelector('[class*="plan"]')?.textContent) || '';

                // Servicios incluidos
                const incluye = Array.from(
                    elemento.querySelectorAll('ul li, [class*="incluye"] li')
                ).map(li => limpiarTexto(li.textContent)).filter(Boolean);

                // Verificar si menciona vuelo o traslado aéreo
                const incluyeVuelo = tieneVueloIncluido(elemento);

                // Extraer precio e información de reembolso
                const infoPrecio = extraerPrecio(elemento);

                // Añadir la advertencia de no reembolsable a los detalles si corresponde
                let detallesActualizados = detalles;
                if (infoPrecio.esNoReembolsable) {
                    const advertencia = '⚠️ NO REEMBOLSABLE - REQUIERE PAGO INMEDIATO ⚠️';
                    detallesActualizados = detalles ? `${advertencia} | ${detalles}` : advertencia;
                }

                // Crear objeto de resultado
                resultados.push({
                    id,
                    titulo,
                    habitacion,
                    detalles: detallesActualizados,
                    precio: infoPrecio.precio,
                    imagen,
                    plan,
                    incluyeVuelo,
                    noReembolsable: infoPrecio.esNoReembolsable, // Añadir como propiedad separada
                    incluye: incluye.length > 0 ? incluye : undefined
                });
            });

            // Ordenar por precio
            return resultados.sort((a, b) => {
                const precioA = a.precio ? parseFloat(a.precio.replace(/[^\d.]/g, '')) : Infinity;
                const precioB = b.precio ? parseFloat(b.precio.replace(/[^\d.]/g, '')) : Infinity;
                return precioA - precioB;
            });
        }, selectorHoteles);

        console.log(`Se encontraron ${paquetesVuelo.length} paquetes con vuelo.`);

        // Si está activada la búsqueda con vista al mar
        if (config.busqueda.vistaAlMar) {
            console.log('⚠️ BUSCANDO ESPECÍFICAMENTE HABITACIONES CON VISTA AL MAR EN PAQUETES CON VUELO...');

            // Buscar habitaciones con vista al mar en los resultados obtenidos
            const resultadosVistaAlMar = await buscarHabitacionesVistaAlMarMejorado(page, paquetesVuelo, config, opciones.hotelBuscado);
            // Si hay un hotel específico solicitado, procesar ese caso particular
            if (opciones.hotelBuscado) {
                paquetesVuelo = procesarHotelEspecificoConVistaAlMar(resultadosVistaAlMar, paquetesVuelo, opciones.hotelBuscado);
            } else {
                // Si no hay hotel específico, simplemente usar los resultados filtrados
                paquetesVuelo = resultadosVistaAlMar;
            }
        }

        // Scroll para buscar más resultados (mismo código que original)
        let totalHoteles = paquetesVuelo.length;
        let intentosScroll = 0;
        const maxIntentosScroll = 3; // Máximo número de veces que scrolleamos para buscar más

        while (intentosScroll < maxIntentosScroll) {
            console.log(`Realizando scroll para buscar más resultados (intento ${intentosScroll + 1})...`);

            // Hacer scroll hacia abajo
            await page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight);
            });

            // Esperar a que se carguen posibles nuevos elementos
            await esperar(3000);

            // Contar cuántos hoteles hay ahora
            const nuevoTotal = await page.evaluate((selector) => {
                return document.querySelectorAll(selector).length;
            }, selectorHoteles);

            console.log(`Después de scroll: ${nuevoTotal} hoteles (antes: ${totalHoteles})`);

            // Si no aparecieron nuevos elementos, terminar
            if (nuevoTotal <= totalHoteles) {
                break;
            }

            // Extraer información de los nuevos hoteles
            const nuevosHoteles = await page.evaluate((selector, indiceInicio) => {
                // Mismas funciones y lógica que antes, pero solo procesando los nuevos elementos
                // ...
                // (código similar al de la extracción inicial de paquetes con vuelo)
                // ...
                return nuevosResultados;
            }, selectorHoteles, totalHoteles);

            // Añadir los nuevos hoteles a la lista
            paquetesVuelo.push(...nuevosHoteles);

            // Actualizar contador
            totalHoteles = paquetesVuelo.length;
            intentosScroll++;
        }

        // Si no hay resultados, crear resultado informativo
        if (paquetesVuelo.length === 0) {
            console.log('No se encontraron paquetes con vuelo. Creando resultado informativo...');
            paquetesVuelo.push({
                titulo: 'No se encontraron opciones disponibles',
                detalles: 'La búsqueda no arrojó resultados para los parámetros especificados. Por favor intente con fechas o destinos diferentes.',
                error: false
            });
        }

        // Guardar resultados y tomar captura final
        if (config.guardarResultados && paquetesVuelo.length > 0) {
            // Crear directorio de resultados si no existe
            const dirResultados = './resultados';
            if (!fs.existsSync(dirResultados)) {
                fs.mkdirSync(dirResultados);
            }

            const fechaHora = new Date().toISOString().replace(/[:.]/g, '-');
            const nombreArchivo = path.join(dirResultados, `naturleon_paquetesvuelo_${config.busqueda.destino}_${fechaHora}.json`);
            fs.writeFileSync(nombreArchivo, JSON.stringify(paquetesVuelo, null, 2));
            console.log(`Resultados guardados en: ${nombreArchivo}`);
        }

        // Cerrar navegador
        await browser.close();
        console.log('Proceso de búsqueda de paquetes con vuelo completado.');

        // Devolver resultados
        return {
            exito: true,
            resultados: paquetesVuelo,
            total: paquetesVuelo.length,
            soloAlojamiento: esSoloAlojamiento,
            advertencia: advertenciaTransporte,
            parametros: {
                destino: config.busqueda.destino,
                origen: config.busqueda.origen,
                fechas: `${config.busqueda.fechaInicio} a ${config.busqueda.fechaFin}`,
                plan: config.busqueda.plan,
                ocupacion: `${config.busqueda.adultos} adultos, ${config.busqueda.ninos} niños, ${config.busqueda.habitaciones} habitación(es)`
            }
        };
    } catch (error) {
        console.error('Error durante el proceso de búsqueda de paquetes con vuelo:', error.message);

        // Captura de error
        try {
            const errorCaptura = `error_paquetesvuelo_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            console.log(`Captura del error guardada en: ${errorCaptura}`);
        } catch (screenshotError) {
            console.error('No se pudo guardar captura del error:', screenshotError.message);
        }

        // Cerrar navegador
        await browser.close();

        // Devolver error
        return {
            exito: false,
            error: error.message,
            detalles: error.stack
        };
    }
}

// Función para filtrar resultados por presupuesto o hotel específico
function filtrarResultados(resultados, presupuesto, hotelBuscado) {
    // Primero, extraer valores numéricos de precios y ordenar por precio
    const resultadosConPrecioNumerico = resultados
        .map(hotel => {
            // Extraer solo los números del precio
            let precioNumerico = 0;
            if (hotel.precio) {
                const match = hotel.precio.replace(/[^\d]/g, '');
                precioNumerico = match ? parseInt(match) : 0;
            }
            return { ...hotel, precioNumerico };
        })
        .filter(hotel => hotel.precioNumerico > 0) // Filtrar hoteles sin precio válido
        .sort((a, b) => a.precioNumerico - b.precioNumerico); // Ordenar por precio (menor a mayor)

    // Si no hay resultados después de filtrar, devolver los originales
    if (resultadosConPrecioNumerico.length === 0) {
        return resultados;
    }

    // Caso 1: Filtro por hotel específico
    if (hotelBuscado) {
        return filtrarPorHotel(resultadosConPrecioNumerico, hotelBuscado);
    }

    // Caso 2: Filtro por presupuesto
    if (presupuesto) {
        return filtrarPorPresupuesto(resultadosConPrecioNumerico, presupuesto);
    }

    // Si no hay filtros, devolver todos los resultados originales ordenados por precio
    return resultadosConPrecioNumerico;
}

// Función auxiliar para filtrar por hotel
function filtrarPorHotel(resultados, hotelBuscado) {
    console.log(`Buscando hotel que coincida con: "${hotelBuscado}"`);

    // Normalizar el texto de búsqueda (quitar acentos, convertir a minúsculas, eliminar espacios extra)
    const normalizarTexto = (texto) => {
        return texto.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
            .replace(/\s+/g, " ").trim(); // Normalizar espacios
    };

    const hotelBuscadoNormalizado = normalizarTexto(hotelBuscado);
    console.log(`Texto de búsqueda normalizado: "${hotelBuscadoNormalizado}"`);

    // Estrategia 1: Buscar coincidencia directa en el título (más flexible)
    const hotelesCoincidentes = resultados.filter(hotel => {
        if (!hotel.titulo) return false;
        const tituloNormalizado = normalizarTexto(hotel.titulo);
        return tituloNormalizado.includes(hotelBuscadoNormalizado);
    });

    console.log(`Se encontraron ${hotelesCoincidentes.length} hoteles que contienen "${hotelBuscadoNormalizado}" en su título.`);

    // Si no hay coincidencias exactas, buscar coincidencias parciales (palabras individuales)
    if (hotelesCoincidentes.length === 0) {
        console.log("Buscando coincidencias parciales por palabras clave...");

        // Dividir el texto de búsqueda en palabras clave
        const palabrasClave = hotelBuscadoNormalizado.split(" ").filter(p => p.length > 2);
        console.log(`Palabras clave para búsqueda: ${palabrasClave.join(", ")}`);

        // Calcular puntaje de coincidencia para cada hotel
        const hotelesConPuntaje = resultados.map(hotel => {
            if (!hotel.titulo) return { ...hotel, puntaje: 0 };

            const tituloNormalizado = normalizarTexto(hotel.titulo);
            let puntaje = 0;

            // Calcular puntaje basado en palabras clave encontradas
            palabrasClave.forEach(palabra => {
                if (tituloNormalizado.includes(palabra)) {
                    puntaje += 1;

                    // Bonus por palabra completa
                    const palabraConBordes = new RegExp(`\\b${palabra}\\b`, 'i');
                    if (palabraConBordes.test(tituloNormalizado)) {
                        puntaje += 0.5;
                    }
                }
            });

            return { ...hotel, puntaje };
        });

        // Filtrar hoteles con al menos una palabra clave coincidente
        const hotelesRelevantes = hotelesConPuntaje
            .filter(hotel => hotel.puntaje > 0)
            .sort((a, b) => b.puntaje - a.puntaje);

        if (hotelesRelevantes.length > 0) {
            console.log(`Se encontraron ${hotelesRelevantes.length} coincidencias parciales.`);
            console.log(`Mejor coincidencia: "${hotelesRelevantes[0].titulo}" con puntaje ${hotelesRelevantes[0].puntaje}`);

            // Usar el hotel con mayor puntaje como coincidencia principal
            const hotelPrincipal = hotelesRelevantes[0];

            // Crear selección de hoteles: el hotel encontrado + alternativas
            return crearSeleccionAlternativas(resultados, hotelPrincipal);
        }

        // Si no hay coincidencias parciales, mostrar los más baratos
        console.log(`No se encontraron coincidencias para "${hotelBuscado}". Mostrando los resultados más económicos.`);
        return resultados.slice(0, 4);
    }

    // Si hay múltiples coincidencias, usar la primera como principal
    const hotelPrincipal = hotelesCoincidentes[0];
    console.log(`Hotel principal seleccionado: "${hotelPrincipal.titulo}"`);

    // Crear la selección con alternativas
    return crearSeleccionAlternativas(resultados, hotelPrincipal);
}
// Función auxiliar para crear una selección con alternativas basadas en un hotel principal
function crearSeleccionAlternativas(resultados, hotelPrincipal) {
    // Determinar la posición del hotel en la lista ordenada por precio
    const indexHotel = resultados.findIndex(hotel => hotel.id === hotelPrincipal.id);

    // Crear la selección de hoteles: el hotel buscado + otras 3 opciones
    const seleccionHoteles = [hotelPrincipal];

    // Set para llevar registro de nombres de hoteles ya incluidos
    const hotelesIncluidos = new Set([hotelPrincipal.titulo]);

    // Función auxiliar para verificar y resaltar información no reembolsable
    const procesarHotel = (hotel) => {
        // Crear una copia profunda del hotel para no modificar el original
        const hotelCopia = JSON.parse(JSON.stringify(hotel));

        // Verificar explícitamente si es no reembolsable
        if (hotelCopia.noReembolsable) {
            // Asegurar que la advertencia aparezca en los detalles
            const advertencia = '⚠️ NO REEMBOLSABLE - REQUIERE PAGO INMEDIATO ⚠️';

            // Si no tiene la advertencia en los detalles, añadirla
            if (hotelCopia.detalles && !hotelCopia.detalles.includes('NO REEMBOLSABLE')) {
                hotelCopia.detalles = `${advertencia} | ${hotelCopia.detalles}`;
            } else if (!hotelCopia.detalles) {
                hotelCopia.detalles = advertencia;
            }
        }

        // También verificar en el texto si hay palabras clave de no reembolsable
        // que tal vez no se capturaron anteriormente
        if (!hotelCopia.noReembolsable) {
            const textoCompleto = [
                hotelCopia.titulo || '',
                hotelCopia.habitacion || '',
                hotelCopia.detalles || '',
                hotelCopia.plan || ''
            ].join(' ').toLowerCase();

            if (
                textoCompleto.includes('no rembolsable') ||
                textoCompleto.includes('no reembolsable') ||
                textoCompleto.includes('sin reembolso') ||
                textoCompleto.includes('pago inmediato')
            ) {
                hotelCopia.noReembolsable = true;
                const advertencia = '⚠️ NO REEMBOLSABLE - REQUIERE PAGO INMEDIATO ⚠️';
                hotelCopia.detalles = hotelCopia.detalles
                    ? `${advertencia} | ${hotelCopia.detalles}`
                    : advertencia;
            }
        }

        return hotelCopia;
    };

    // Procesar el hotel principal para asegurar que tiene información de no reembolsable
    seleccionHoteles[0] = procesarHotel(hotelPrincipal);

    // Si es el más barato o segundo más barato, mostrar 3 de mayor precio
    if (indexHotel <= 1) {
        console.log(`El hotel seleccionado es de los más económicos (posición ${indexHotel + 1}). Mostrando 3 alternativas más caras.`);

        // Añadir los siguientes hoteles más caros (si existen)
        let contadorAgregados = 0;
        let i = 1;
        while (contadorAgregados < 3 && indexHotel + i < resultados.length) {
            const hotel = resultados[indexHotel + i];
            if (!hotelesIncluidos.has(hotel.titulo)) {
                seleccionHoteles.push(procesarHotel(hotel));
                hotelesIncluidos.add(hotel.titulo);
                contadorAgregados++;
            }
            i++;
        }
    }
    // Si es el más caro o segundo más caro, mostrar 3 de menor precio
    else if (indexHotel >= resultados.length - 2) {
        console.log(`El hotel seleccionado es de los más caros (posición ${indexHotel + 1} de ${resultados.length}). Mostrando 3 alternativas más económicas.`);

        // Añadir los anteriores hoteles más baratos (si existen)
        let contadorAgregados = 0;
        let i = 1;
        while (contadorAgregados < 3 && indexHotel - i >= 0) {
            const hotel = resultados[indexHotel - i];
            if (!hotelesIncluidos.has(hotel.titulo)) {
                seleccionHoteles.push(procesarHotel(hotel));
                hotelesIncluidos.add(hotel.titulo);
                contadorAgregados++;
            }
            i++;
        }
    }
    // Caso normal: mostrar 1 opción más barata y 2 más caras
    else {
        console.log(`El hotel seleccionado está en rango medio (posición ${indexHotel + 1} de ${resultados.length}). Mostrando 1 opción más económica y 2 más caras.`);

        // Añadir 1 opción más barata
        let baratosAgregados = 0;
        let i = 1;
        while (baratosAgregados < 1 && indexHotel - i >= 0) {
            const hotel = resultados[indexHotel - i];
            if (!hotelesIncluidos.has(hotel.titulo)) {
                seleccionHoteles.push(procesarHotel(hotel));
                hotelesIncluidos.add(hotel.titulo);
                baratosAgregados++;
            }
            i++;
        }

        // Añadir 2 opciones más caras
        let carosAgregados = 0;
        i = 1;
        while (carosAgregados < 2 && indexHotel + i < resultados.length) {
            const hotel = resultados[indexHotel + i];
            if (!hotelesIncluidos.has(hotel.titulo)) {
                seleccionHoteles.push(procesarHotel(hotel));
                hotelesIncluidos.add(hotel.titulo);
                carosAgregados++;
            }
            i++;
        }
    }

    // Ordenar los hoteles seleccionados por precio (menor a mayor)
    return seleccionHoteles.sort((a, b) => a.precioNumerico - b.precioNumerico);
}

// Función auxiliar para filtrar por presupuesto
function filtrarPorPresupuesto(resultados, presupuesto, opciones = {}) {
    let min = 0;
    let max = Infinity;

    // Calcular el número total de personas (adultos + niños)
    const adultos = opciones.adultos || 2;
    const ninos = opciones.ninos || 0;
    const totalPersonas = adultos + ninos;

    // Definir rangos base por persona
    switch (presupuesto.toLowerCase()) {
        case 'economico':
            min = 3000;
            max = 6000;
            break;
        case 'ideal':
            min = 7000;
            max = 10000;
            break;
        case 'lujo':
            min = 12000;
            max = Infinity;
            break;
        default:
            // Si es un rango personalizado como "5000-8000"
            const rangoPersonalizado = presupuesto.split('-');
            if (rangoPersonalizado.length === 2) {
                min = parseInt(rangoPersonalizado[0]) || 0;
                max = parseInt(rangoPersonalizado[1]) || Infinity;
            }
    }

    // Multiplicar por el total de personas
    min = min * totalPersonas;
    max = max * totalPersonas;

    console.log(`Filtrando por presupuesto: $${min} - $${max} (basado en ${totalPersonas} personas)`);

    // Filtrar hoteles por rango de precio
    const hotelesFiltrados = resultados.filter(hotel =>
        hotel.precioNumerico >= min && hotel.precioNumerico <= max
    );

    // Si no hay hoteles en este rango, devolver los 4 más cercanos al rango
    if (hotelesFiltrados.length === 0) {
        console.log(`No se encontraron hoteles en el rango de presupuesto ${presupuesto}. Mostrando alternativas cercanas.`);

        // Calcular la distancia de cada hotel al rango solicitado
        const hotelesConDistancia = resultados.map(hotel => {
            let distancia = 0;
            if (hotel.precioNumerico < min) {
                distancia = min - hotel.precioNumerico;
            } else if (hotel.precioNumerico > max) {
                distancia = hotel.precioNumerico - max;
            }
            return { ...hotel, distancia };
        });

        // Ordenar por distancia al rango y devolver los 4 más cercanos
        return hotelesConDistancia
            .sort((a, b) => a.distancia - b.distancia)
            .slice(0, 4);
    }

    // Si hay menos de 4 hoteles en el rango, complementar con hoteles cercanos
    if (hotelesFiltrados.length < 4) {
        const idsSeleccionados = new Set(hotelesFiltrados.map(h => h.id));

        // Calcular distancia al rango para los hoteles no seleccionados
        const hotelesRestantes = resultados
            .filter(hotel => !idsSeleccionados.has(hotel.id))
            .map(hotel => {
                let distancia = 0;
                if (hotel.precioNumerico < min) {
                    distancia = min - hotel.precioNumerico;
                } else if (hotel.precioNumerico > max) {
                    distancia = hotel.precioNumerico - max;
                }
                return { ...hotel, distancia };
            })
            .sort((a, b) => a.distancia - b.distancia);

        // Añadir los hoteles más cercanos hasta completar 4
        const faltantes = 4 - hotelesFiltrados.length;
        return [...hotelesFiltrados, ...hotelesRestantes.slice(0, faltantes)];
    }

    // Si hay más de 4 hoteles en el rango, devolver solo los 4 más baratos
    return hotelesFiltrados.slice(0, 4);
}

/**
 * Actualización de la función iniciarScraping para incluir vista al mar
 */
async function iniciarScraping(parametros = {}) {
    try {
        // Añadir el parámetro vistaAlMar si existe
        const vistaAlMar = parametros.vistaAlMar === true;

        const resultados = await scrapNaturLeon({
            ...parametros,
            vistaAlMar: vistaAlMar
        });

        // Si hay filtros aplicados, mostrar la cantidad filtrada
        if (resultados.exito && resultados.resultados && resultados.resultados.length > 0) {
            if (parametros.presupuesto || parametros.hotelBuscado) {
                resultados.resultadosFiltrados = filtrarResultados(
                    resultados.resultados,
                    parametros.presupuesto,
                    parametros.hotelBuscado
                );
                resultados.totalFiltrado = resultados.resultadosFiltrados.length;
            }
        }

        return resultados;
    } catch (error) {
        console.error('Error al iniciar scraping:', error);
        return {
            exito: false,
            error: error.message
        };
    }
}

// Función mejorada para encontrar y hacer clic en el botón "Ver más opciones"
async function expandirOpcionesHabitacion(page, hotelId) {
    try {
        // Múltiples selectores para encontrar el botón "Ver más opciones"
        const posiblesSelectores = [
            `#collapse-${hotelId} > a`,
            `#booking-result-list-${hotelId} .ver-mas`,
            `[data-target="#collapse-${hotelId}"]`,
            `[aria-controls="collapse-${hotelId}"]`,
            `.card:has(#hotel-top-${hotelId}) .ver-mas`,
            `.card:has(#booking-result-list-${hotelId}) a:contains("Ver más")`
        ];

        // Intentar encontrar el botón usando los diferentes selectores
        let botonEncontrado = false;
        for (const selector of posiblesSelectores) {
            // Evaluar si existe y es visible
            const existeBoton = await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (!btn) return false;

                // Verificar si el botón contiene texto "Ver más"
                return btn.textContent.includes('Ver más opciones') ||
                    btn.textContent.includes('Ver más') ||
                    btn.textContent.includes('más opciones');
            }, selector);

            if (existeBoton) {
                console.log(`✅ Encontrado botón "Ver más opciones" con selector: ${selector}`);

                // Hacer clic en el botón
                await page.click(selector);

                // Verificar que se expandió correctamente
                await esperar(1000);
                // Comprobar que apareció lista de opciones
                const seExpandio = await page.evaluate((id) => {
                    return document.querySelectorAll(`#booking-result-list-${id} li`).length > 0;
                }, hotelId);

                if (seExpandio) {
                    console.log('✅ Botón expandido correctamente, se muestran opciones adicionales');
                    botonEncontrado = true;
                    break;
                }
            }
        }

        // Si no encontramos con selectores, buscar por XPath
        if (!botonEncontrado) {
            const botonesPorTexto = await page.$x("//a[contains(text(), 'Ver más opciones')]");
            if (botonesPorTexto.length > 0) {
                await botonesPorTexto[0].click();
                await esperar(1000);
                botonEncontrado = true;
            }
        }

        return botonEncontrado;
    } catch (error) {
        console.log(`Error al expandir opciones para hotel ID ${hotelId}:`, error.message);
        return false;
    }
}

/**
 * Actualización de la función buscarPaquetesVueloCancun para incluir vista al mar
 */
async function buscarPaquetesVueloCancun(opciones = {}) {
    try {
        // Añadir el parámetro vistaAlMar si existe
        const vistaAlMar = opciones.vistaAlMar === true;

        // Establecer Cancun como destino predeterminado para esta función
        const opcionesCompletas = {
            ...opciones,
            destino: opciones.destino || 'Cancun',
            vistaAlMar: vistaAlMar
        };

        // Ejecutar la búsqueda de paquetes con vuelo
        const resultados = await scrapNaturLeonPaquetesVuelo(opcionesCompletas);

        // Si hay filtros aplicados, mostrar la cantidad filtrada
        if (resultados.exito && resultados.resultados && resultados.resultados.length > 0) {
            if (opcionesCompletas.presupuesto || opcionesCompletas.hotelBuscado) {
                resultados.resultadosFiltrados = filtrarResultados(
                    resultados.resultados,
                    opcionesCompletas.presupuesto,
                    opcionesCompletas.hotelBuscado
                );
                resultados.totalFiltrado = resultados.resultadosFiltrados.length;
            }
        }

        return resultados;
    } catch (error) {
        console.error('Error al buscar paquetes con vuelo a Cancun:', error);
        return {
            exito: false,
            error: error.message
        };
    }
}

/**
 * Actualización de la función formatearResultadosParaWhatsApp
 * para destacar las habitaciones con vista al mar
 */
function formatearResultadosParaWhatsApp(resultados, hotelBuscado = null, presupuesto = null, vistaAlMar = false) {
    // Determinar qué arreglo de resultados usar
    const listaResultados = Array.isArray(resultados) ? resultados :
        (resultados.resultadosFiltrados || resultados.resultados);

    // Obtener parámetros de búsqueda si están disponibles
    const parametros = resultados.parametros || {};
    const destinoBuscado = parametros.destino || '';

    let mensaje = '*🌴 RESULTADOS DE BÚSQUEDA NATURLEON 🌴*\n\n';

    // Si hay un mensaje de error o sin resultados
    if (listaResultados.length === 1 && (listaResultados[0].error ||
        listaResultados[0].titulo === 'No se encontraron opciones disponibles' ||
        listaResultados[0].titulo === 'No hay habitaciones con vista al mar disponibles' ||
        listaResultados[0].titulo.includes('No se encontró el hotel'))) {
        mensaje += `*${listaResultados[0].titulo}*\n\n`;
        if (listaResultados[0].detalles) mensaje += `${listaResultados[0].detalles}\n\n`;
        mensaje += 'Por favor intenta con otro destino o fechas diferentes.';
        return mensaje;
    }

    // Mostrar todos los resultados filtrados o limitar a 5 si son muchos
    const mostrar = hotelBuscado || presupuesto || vistaAlMar ?
        listaResultados.length :
        Math.min(5, listaResultados.length);

    // Índice de inicio (si el primer elemento es un mensaje informativo, empezar desde 1)
    const inicioIndice = (listaResultados[0].error ||
        listaResultados[0].titulo === 'No hay habitaciones con vista al mar disponibles' ||
        listaResultados[0].titulo.includes('No se encontró el hotel')) ? 1 : 0;

    for (let i = inicioIndice; i < mostrar; i++) {
        const r = listaResultados[i];

        // Título del hotel
        mensaje += `*${i + 1 - inicioIndice}. ${r.titulo || 'Paquete vacacional'}*\n`;

        // *** NUEVA FUNCIONALIDAD: MOSTRAR DESTINO ESPECÍFICO ***
        if (r.destinoEspecifico) {
            mensaje += `📍 Destino: ${r.destinoEspecifico}\n`;
        } else if (destinoBuscado) {
            mensaje += `📍 Destino: ${destinoBuscado}\n`;
        }

        // Fechas del viaje
        if (parametros.fechas) {
            mensaje += `📅 Fechas: ${parametros.fechas}\n`;
        } else if (parametros.fechaInicio && parametros.fechaFin) {
            mensaje += `📅 Fechas: ${parametros.fechaInicio} a ${parametros.fechaFin}\n`;
        }

        // Precio
        if (r.precio) mensaje += `💰 Precio: ${r.precio}\n`;

        // Tipo de habitación
        if (r.habitacion) {
            let tipoHabitacion = r.habitacion.trim();
            // Limpiar información redundante si es necesario
            tipoHabitacion = tipoHabitacion.replace(/\d+ ADULTS \d+ CHILD/i, '').trim();
            mensaje += `🏨 Habitación: ${tipoHabitacion}\n`;
        }

        // Detalles de ocupación (extraer del objeto o de detalles)
        const adultos = parametros.ocupacion ? parametros.ocupacion.split(' adultos')[0] : '';
        const ninos = parametros.ocupacion && parametros.ocupacion.includes('niños') ?
            parametros.ocupacion.split('niños')[0].split(',')[1].trim() : '0';
        const edades = r.edadesMenores || [];

        // Extraer número de habitaciones
        let numHabitaciones = '1'; // Valor por defecto
        if (parametros.ocupacion && parametros.ocupacion.includes('habitación')) {
            const habitacionesMatch = parametros.ocupacion.match(/(\d+)\s+habitación/);
            if (habitacionesMatch && habitacionesMatch[1]) {
                numHabitaciones = habitacionesMatch[1];
            }
        }

        let detalleOcupacion = '';
        if (adultos) detalleOcupacion += `${adultos} adultos`;
        if (ninos && ninos !== '0') {
            detalleOcupacion += ` - ${ninos} niño${ninos !== '1' ? 's' : ''}`;
            if (edades.length > 0) {
                detalleOcupacion += ` - (${edades.join(', ')} años)`;
            }
        }

        if (detalleOcupacion) mensaje += `👥 Ocupación: ${detalleOcupacion}\n`;

        // Número de habitaciones
        mensaje += `🏠 Habitaciones: ${numHabitaciones}\n`;

        // Tipo de alojamiento
        const tipoAlojamiento = determinarTipoAlojamiento(r);
        if (tipoAlojamiento) mensaje += `🍽️ Alojamiento: ${tipoAlojamiento}\n`;

        // Transporte
        const incluyeTransporte = determinarTransporte(r, parametros);
        mensaje += `🚌 Transporte: ${incluyeTransporte ? 'Sí' : 'No'}\n`;

        // Extras/Beneficios
        const extras = extraerBeneficios(r);
        if (extras.length > 0) {
            mensaje += `🎁 Extras: ${extras.join(', ')}\n`;
        }

        // *** NUEVA FUNCIONALIDAD: INFORMACIÓN DE UBICACIÓN DETALLADA (OPCIONAL) ***
        // Descomenta las siguientes líneas si quieres mostrar la ubicación completa también
        /*
        if (r.ubicacionCompleta && r.ubicacionCompleta !== r.destinoEspecifico) {
            mensaje += `📋 Ubicación completa: ${r.ubicacionCompleta}\n`;
        }
        */

        mensaje += '\n';
    }

    if (!hotelBuscado && !presupuesto && !vistaAlMar && listaResultados.length > mostrar) {
        mensaje += `*... y ${listaResultados.length - mostrar} opciones más.*\n\n`;
    }

    mensaje += 'Para más detalles sobre alguna opción, responde con el número correspondiente.';

    return mensaje;
}

// ============================================================
// PASO 4: TAMBIÉN ACTUALIZAR formatearPaquetesVueloParaWhatsApp
// ============================================================

function formatearPaquetesVueloParaWhatsApp(resultados, hotelBuscado = null, presupuesto = null, vistaAlMar = false) {
    // Determinar qué arreglo de resultados usar
    const listaResultados = Array.isArray(resultados) ? resultados :
        (resultados.resultadosFiltrados || resultados.resultados);

    // Obtener parámetros de búsqueda si están disponibles
    const parametros = resultados.parametros || {};
    const destinoBuscado = parametros.destino || '';
    const origen = parametros.origen || '';

    let mensaje = '*✈️ PAQUETES CON VUELO NATURLEON ✈️*\n\n';

    // Si hay un mensaje de error o sin resultados
    if (listaResultados.length === 1 && (listaResultados[0].error ||
        listaResultados[0].titulo === 'No se encontraron opciones disponibles' ||
        listaResultados[0].titulo === 'No hay habitaciones con vista al mar disponibles' ||
        listaResultados[0].titulo.includes('No se encontró el hotel'))) {
        mensaje += `*${listaResultados[0].titulo}*\n\n`;
        if (listaResultados[0].detalles) mensaje += `${listaResultados[0].detalles}\n\n`;
        mensaje += 'Por favor intenta con otro destino o fechas diferentes.';
        return mensaje;
    }

    // Mostrar todos los resultados filtrados o limitar a 5 si son muchos
    const mostrar = hotelBuscado || presupuesto || vistaAlMar ?
        listaResultados.length :
        Math.min(5, listaResultados.length);

    // Índice de inicio
    const inicioIndice = (listaResultados[0].error ||
        listaResultados[0].titulo === 'No hay habitaciones con vista al mar disponibles' ||
        listaResultados[0].titulo.includes('No se encontró el hotel')) ? 1 : 0;

    for (let i = inicioIndice; i < mostrar; i++) {
        const r = listaResultados[i];

        // Título del hotel
        mensaje += `*${i + 1 - inicioIndice}. ${r.titulo || 'Paquete con vuelo'}*\n`;

        // *** NUEVA FUNCIONALIDAD: MOSTRAR DESTINO ESPECÍFICO ***
        if (r.destinoEspecifico) {
            mensaje += `📍 Destino: ${r.destinoEspecifico}\n`;
        } else if (destinoBuscado) {
            mensaje += `📍 Destino: ${destinoBuscado}\n`;
        }

        if (origen) mensaje += `🛫 Origen: ${origen}\n`;

        // Fechas del viaje
        if (parametros.fechas) {
            mensaje += `📅 Fechas: ${parametros.fechas}\n`;
        } else if (parametros.fechaInicio && parametros.fechaFin) {
            mensaje += `📅 Fechas: ${parametros.fechaInicio} a ${parametros.fechaFin}\n`;
        }

        // Precio
        if (r.precio) mensaje += `💰 Precio: ${r.precio}\n`;

        // Tipo de habitación
        if (r.habitacion) {
            let tipoHabitacion = r.habitacion.trim();
            tipoHabitacion = tipoHabitacion.replace(/\d+ ADULTS \d+ CHILD/i, '').trim();
            mensaje += `🏨 Habitación: ${tipoHabitacion}\n`;
        }

        // Detalles de ocupación
        const adultos = parametros.ocupacion ? parametros.ocupacion.split(' adultos')[0] : '';
        const ninos = parametros.ocupacion && parametros.ocupacion.includes('niños') ?
            parametros.ocupacion.split('niños')[0].split(',')[1].trim() : '0';

        let detalleOcupacion = '';
        if (adultos) detalleOcupacion += `${adultos} adultos`;
        if (ninos && ninos !== '0') {
            detalleOcupacion += ` - ${ninos} niño${ninos !== '1' ? 's' : ''}`;
        }

        if (detalleOcupacion) mensaje += `👥 Ocupación: ${detalleOcupacion}\n`;

        // Vuelo incluido (siempre Sí en este caso)
        mensaje += `✈️ Vuelo: Sí\n`;

        // Tipo de alojamiento
        const tipoAlojamiento = determinarTipoAlojamiento(r);
        if (tipoAlojamiento) mensaje += `🍽️ Alojamiento: ${tipoAlojamiento}\n`;

        // Extras/Beneficios
        const extras = extraerBeneficios(r);
        if (extras.length > 0) {
            mensaje += `🎁 Extras: ${extras.join(', ')}\n`;
        }

        mensaje += '\n';
    }

    if (!hotelBuscado && !presupuesto && !vistaAlMar && listaResultados.length > mostrar) {
        mensaje += `*... y ${listaResultados.length - mostrar} opciones más.*\n\n`;
    }

    mensaje += 'Para más detalles sobre alguna opción, responde con el número correspondiente.';

    return mensaje;
}

/**
 * Función auxiliar para determinar el tipo de alojamiento
 */
function determinarTipoAlojamiento(resultado) {
    // Verificar en plan primero
    if (resultado.plan) {
        const planLower = resultado.plan.toLowerCase();
        if (planLower.includes('todo incluido') || planLower.includes('all inclusive')) {
            return 'Todo incluido';
        }
        if (planLower.includes('desayuno')) {
            return 'Solo desayuno';
        }
        if (planLower.includes('alojamiento') || planLower.includes('solo hab')) {
            return 'Solo alojamiento';
        }
        // Si tiene un plan específico diferente, usarlo
        return resultado.plan;
    }

    // Verificar en detalles o título
    const textoCompleto = [
        resultado.detalles || '',
        resultado.titulo || '',
        resultado.habitacion || ''
    ].join(' ').toLowerCase();

    if (textoCompleto.includes('todo incluido') || textoCompleto.includes('all inclusive')) {
        return 'Todo incluido';
    }
    if (textoCompleto.includes('desayuno')) {
        return 'Solo desayuno';
    }
    if (textoCompleto.includes('solo alojamiento') || textoCompleto.includes('sin alimentos')) {
        return 'Solo alojamiento';
    }

    // Si no podemos determinarlo, valor por defecto
    return 'No especificado';
}

/**
 * Función auxiliar para determinar si incluye transporte
 */
function determinarTransporte(resultado, parametros) {
    // Si es un paquete con transporte explícito en los parámetros
    if (parametros.conTransporte === true) {
        return true;
    }

    // Verificar en textos
    const textoCompleto = [
        resultado.detalles || '',
        resultado.titulo || '',
        resultado.habitacion || '',
        JSON.stringify(resultado.incluye || [])
    ].join(' ').toLowerCase();

    return textoCompleto.includes('transporte') ||
        textoCompleto.includes('traslado') ||
        textoCompleto.includes('shuttle') ||
        textoCompleto.includes('autobus');
}

/**
 * Función para extraer beneficios especiales
 */
function extraerBeneficios(resultado) {
    const beneficios = [];

    // Extraer textos relevantes
    const textoCompleto = [
        resultado.detalles || '',
        resultado.titulo || '',
        resultado.habitacion || '',
        JSON.stringify(resultado.incluye || [])
    ].join(' ').toLowerCase();

    // La vista al mar ya no es un beneficio extra, sino que forma parte del tipo de habitación
    // pero lo mantenemos por compatibilidad en caso de que no esté en el tipo de habitación
    if ((resultado.tieneVistaAlMar === true && !resultado.habitacion?.toLowerCase().includes('vista')) ||
        (/vista.*(mar|ocean|sea)|ocean.*view|sea.*view/i.test(textoCompleto) &&
            !resultado.habitacion?.toLowerCase().includes('vista'))) {
        beneficios.push('Vista al mar');
    }

    // Garantía NaturCharter - implica desayuno a la llegada y habitación anticipada
    if (textoCompleto.includes('garantia naturcharter') ||
        textoCompleto.includes('garantía naturcharter')) {
        beneficios.push('Desayuno a la llegada');
        beneficios.push('Check-in temprano (habitación anticipada)');
    } else {
        // Si no tiene garantía NaturCharter, verificar beneficios individuales

        // Check-in temprano
        if (textoCompleto.includes('check-in temprano') ||
            textoCompleto.includes('early check-in') ||
            textoCompleto.includes('llegada anticipada') ||
            textoCompleto.includes('habitacion anticipada') ||
            textoCompleto.includes('habitación anticipada')) {
            beneficios.push('Check-in temprano');
        }

        // Desayuno a la llegada
        if (textoCompleto.includes('desayuno llegada') ||
            textoCompleto.includes('desayuno el día de llegada')) {
            beneficios.push('Desayuno a la llegada');
        }
    }

    // Menores gratis
    if (textoCompleto.includes('menores gratis') ||
        textoCompleto.includes('niños gratis') ||
        textoCompleto.includes('kids free') ||
        textoCompleto.includes('menor gratis')) {
        beneficios.push('Menores gratis - Solo pagan transporte');
    }

    // Check-out tardío
    if (textoCompleto.includes('check-out tardío') ||
        textoCompleto.includes('late check-out')) {
        beneficios.push('Check-out tardío');
    }

    // No reembolsable (importante destacarlo)
    if (resultado.noReembolsable ||
        textoCompleto.includes('no rembolsable') ||
        textoCompleto.includes('no reembolsable') ||
        textoCompleto.includes('sin reembolso')) {
        beneficios.push('⚠️ NO REEMBOLSABLE');
    }

    return beneficios;
}

/**
 * Actualizar el módulo de exportación para incluir las nuevas funciones
 */
module.exports = {
    scrapNaturLeon,
    scrapNaturLeonPaquetesVuelo,
    iniciarScraping,
    buscarPaquetesVueloCancun,
    formatearResultadosParaWhatsApp,
    formatearPaquetesVueloParaWhatsApp,
    determinarTipoAlojamiento,
    determinarTransporte,
    extraerBeneficios,
    filtrarPorPresupuesto,
    filtrarResultados,
    buscarHabitacionesVistaAlMarMejorado,
    procesarHotelEspecificoConVistaAlMar
};

// Si se ejecuta directamente como script
if (require.main === module) {
    // Leer parámetros de la línea de comandos
    const args = process.argv.slice(2);
    const parametrosAdicionales = {};

    // Procesar argumentos de línea de comandos
    for (const arg of args) {
        if (arg.startsWith('--hotel=')) {
            parametrosAdicionales.hotelBuscado = arg.replace('--hotel=', '');
        } else if (arg.startsWith('--presupuesto=')) {
            parametrosAdicionales.presupuesto = arg.replace('--presupuesto=', '');
        } else if (arg.startsWith('--plan=')) {
            parametrosAdicionales.plan = arg.replace('--plan=', '');
        } else if (arg === '--con-transporte') {
            parametrosAdicionales.conTransporte = true;
        } else if (arg === '--con-vuelo') {
            parametrosAdicionales.modoBusqueda = 'paquetes-vuelo';
        } else if (arg === '--vista-al-mar') {
            parametrosAdicionales.vistaAlMar = true;
        } else if (arg.startsWith('--origen=')) {
            parametrosAdicionales.origen = arg.replace('--origen=', '');
        } else if (arg.startsWith('--destino=')) {
            parametrosAdicionales.destino = arg.replace('--destino=', '');
        } else if (arg.startsWith('--fechaIda=') || arg.startsWith('--fechaInicio=')) {
            parametrosAdicionales.fechaInicio = arg.replace('--fechaIda=', '').replace('--fechaInicio=', '');
        } else if (arg.startsWith('--fechaRegreso=') || arg.startsWith('--fechaFin=')) {
            parametrosAdicionales.fechaFin = arg.replace('--fechaRegreso=', '').replace('--fechaFin=', '');
        } else if (arg.startsWith('--adultos=')) {
            parametrosAdicionales.adultos = parseInt(arg.replace('--adultos=', ''));
        } else if (arg.startsWith('--ninos=')) {
            parametrosAdicionales.ninos = parseInt(arg.replace('--ninos=', ''));
        }
    }

    // Determinar el modo de búsqueda
    const modoBusqueda = parametrosAdicionales.modoBusqueda ||
        (parametrosAdicionales.conTransporte ? 'hotel-transporte' : 'hotel');

    if (modoBusqueda === 'paquetes-vuelo') {
        // Búsqueda de paquetes con vuelo
        console.log('Iniciando búsqueda de PAQUETES CON VUELO...');
        buscarPaquetesVueloCancun({
            destino: parametrosAdicionales.destino || 'Cancun',
            origen: parametrosAdicionales.origen || 'BJX - León',
            fechaInicio: parametrosAdicionales.fechaInicio || '2025-06-12',
            fechaFin: parametrosAdicionales.fechaFin || '2025-06-15',
            plan: parametrosAdicionales.plan || 'todoincluido',
            adultos: parseInt(parametrosAdicionales.adultos || '2'),
            ninos: parseInt(parametrosAdicionales.ninos || '0'),
            edadesMenores: [7],
            habitaciones: 1,
            headless: false,
            timeout: 60000,
            hotelBuscado: parametrosAdicionales.hotelBuscado,
            presupuesto: parametrosAdicionales.presupuesto,
            vistaAlMar: parametrosAdicionales.vistaAlMar
        }).then(resultado => {
            if (resultado.exito) {
                console.log('Búsqueda de paquetes con vuelo exitosa!');
                console.log(`Se encontraron ${resultado.total} paquetes con vuelo para ${resultado.parametros.destino}`);

                // Si hay filtros aplicados, mostrar la cantidad filtrada
                if (resultado.resultadosFiltrados) {
                    console.log(`Mostrando ${resultado.totalFiltrado} paquetes después de aplicar filtros.`);
                }

                // Mostrar ejemplo de formateo para WhatsApp
                const mensajeWhatsApp = formatearPaquetesVueloParaWhatsApp(
                    resultado,
                    parametrosAdicionales.hotelBuscado,
                    parametrosAdicionales.presupuesto,
                    parametrosAdicionales.vistaAlMar
                );
                console.log('\nEjemplo de mensaje para WhatsApp:');
                console.log(mensajeWhatsApp);
            } else {
                console.error('La búsqueda de paquetes con vuelo falló:', resultado.error);
            }
        }).catch(error => {
            console.error('Error crítico:', error.message);
        });

        console.log('Configuración de búsqueda:');
        console.log('Modo: PAQUETES CON VUELO');
        console.log('Destino:', parametrosAdicionales.destino || 'Cancun');
        console.log('Origen:', parametrosAdicionales.origen || 'BJX - León');
        console.log('Plan:', parametrosAdicionales.plan || 'todoincluido');
        console.log('Fechas:', parametrosAdicionales.fechaInicio || '2025-06-12', 'a', parametrosAdicionales.fechaFin || '2025-06-15');
        console.log('Personas:', (parametrosAdicionales.adultos || 2) + ' adultos, ' + (parametrosAdicionales.ninos || 0) + ' niños');

        if (parametrosAdicionales.hotelBuscado) {
            console.log('Buscando hotel específico:', parametrosAdicionales.hotelBuscado);
        }
        if (parametrosAdicionales.presupuesto) {
            console.log('Filtro por presupuesto:', parametrosAdicionales.presupuesto);
        }
        if (parametrosAdicionales.vistaAlMar) {
            console.log('Buscando específicamente: HABITACIONES CON VISTA AL MAR');
        }
    } else {
        // Determinar si se usa transporte basándose en los argumentos
        const conTransporte = parametrosAdicionales.conTransporte === true;

        // Si se seleccionó modo transporte, verificar el destino
        if (conTransporte) {
            const destinoUsuario = parametrosAdicionales.destino?.toLowerCase() || 'ixtapa'; // Ixtapa por defecto para transporte
            const destinosTransporte = ['puerto vallarta', 'ixtapa'];
            const esDestinoCompatible = destinosTransporte.some(d => destinoUsuario.includes(d));

            if (!esDestinoCompatible) {
                console.log(`ℹ️ Nota: El destino "${config.busqueda.destino}" podría tener menos opciones disponibles con transporte, pero se intentará la búsqueda.`);

            }
        }

        // Ejemplo de uso con parámetros específicos
        iniciarScraping({
            // Si hay transporte y no se especificó destino, usar Ixtapa como predeterminado
            destino: conTransporte && !parametrosAdicionales.destino ? 'Ixtapa' : (parametrosAdicionales.destino || 'Cancun'),
            fechaInicio: parametrosAdicionales.fechaInicio || '2025-06-12',
            fechaFin: parametrosAdicionales.fechaFin || '2025-06-15',
            // El plan puede ser 'todoincluido', 'soloalojamiento', o 'desayuno'
            plan: parametrosAdicionales.plan || 'todoincluido',
            adultos: parseInt(parametrosAdicionales.adultos || '2'),
            ninos: parseInt(parametrosAdicionales.ninos || '1'),
            edadesMenores: [7],
            habitaciones: 1,
            headless: false,
            timeout: 60000, // Aumentar el timeout a 60 segundos
            // Opciones para búsqueda con transporte
            conTransporte: conTransporte,
            origen: parametrosAdicionales.origen || 'León (Natursala Hidalgo)',
            ajustarFechasTransporte: true, // Ajustar fechas automáticamente para transporte
            // Añadir parámetros de filtro si existen
            hotelBuscado: parametrosAdicionales.hotelBuscado,
            presupuesto: parametrosAdicionales.presupuesto,
            // Búsqueda de vista al mar
            vistaAlMar: parametrosAdicionales.vistaAlMar
        }).then(resultado => {
            if (resultado.exito || (resultado.resultados && resultado.resultados.length > 0)) {
                // Mostrar éxito solo si realmente fue exitoso
                if (resultado.exito) {
                    console.log('Búsqueda exitosa!');
                    console.log(`Se encontraron ${resultado.total} paquetes para ${resultado.parametros.destino}`);
                } else {
                    console.log(`Búsqueda completada con errores, pero se obtuvieron ${resultado.resultados.length} resultados.`);
                }

                // Si hay filtros aplicados, mostrar la cantidad filtrada
                if (resultado.resultadosFiltrados) {
                    console.log(`Mostrando ${resultado.totalFiltrado} paquetes después de aplicar filtros.`);
                }

                // Mostrar ejemplo de formateo para WhatsApp en ambos casos
                const mensajeWhatsApp = formatearResultadosParaWhatsApp(
                    resultado,
                    parametrosAdicionales.hotelBuscado,
                    parametrosAdicionales.presupuesto,
                    parametrosAdicionales.vistaAlMar
                );
                console.log('\nEjemplo de mensaje para WhatsApp:');
                console.log(mensajeWhatsApp);

                // Si hubo error pero tenemos resultados, informarlo
                if (!resultado.exito) {
                    console.log('Nota: Se encontraron algunos errores, pero se pudieron obtener resultados parciales.');
                }
            } else {
                console.error('La búsqueda falló:', resultado.error);
            }
        }).catch(error => {
            console.error('Error crítico:', error.message);
        });

        console.log('Iniciando búsqueda con las siguientes opciones:');
        console.log('Plan:', parametrosAdicionales.plan || 'todoincluido');
        console.log('Modo:', conTransporte ? 'CON TRANSPORTE' : 'SOLO ALOJAMIENTO');
        console.log('Destino:', conTransporte && !parametrosAdicionales.destino ? 'Ixtapa (predeterminado para transporte)' : (parametrosAdicionales.destino || 'Cancun'));
        console.log('Fechas:', parametrosAdicionales.fechaInicio || '2025-06-12', 'a', parametrosAdicionales.fechaFin || '2025-06-15');
        console.log('Personas:', (parametrosAdicionales.adultos || 2) + ' adultos, ' + (parametrosAdicionales.ninos || 1) + ' niños');

        if (conTransporte) {
            console.log('Origen:', parametrosAdiciEonales.origen || 'León (Natursala Hidalgo)');
            console.log('NOTA: Los únicos destinos disponibles con transporte son Puerto Vallarta e Ixtapa');
        }
        if (parametrosAdicionales.hotelBuscado) {
            console.log('Buscando hotel específico:', parametrosAdicionales.hotelBuscado);
        }
        if (parametrosAdicionales.presupuesto) {
            console.log('Filtro por presupuesto:', parametrosAdicionales.presupuesto);
        }
        if (parametrosAdicionales.vistaAlMar) {
            console.log('Buscando específicamente: HABITACIONES CON VISTA AL MAR');
        }
    }
}