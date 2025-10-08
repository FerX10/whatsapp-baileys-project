const fs = require('fs');
const path = 'src/services/ficha-coti-processor.js';
let text = fs.readFileSync(path, 'utf8');
const startToken = '    for (let i = 0; i < parsed.dateWindows.length && i < this.maxWindows; i++) {';
const endToken = '\r\n  }\r\n\r\n';
const startIdx = text.indexOf(startToken);
if (startIdx === -1) throw new Error('start not found');
const endIdx = text.indexOf(endToken + '  _parsePayload', startIdx);
if (endIdx === -1) throw new Error('end not found');
const oldSegment = text.slice(startIdx, endIdx + endToken.length);
const newSegment = (
`    const transportModesInput = Array.isArray(parsed.transportes) && parsed.transportes.length\r\n` +
`      ? parsed.transportes\r\n` +
`      : [parsed.transporte].filter(Boolean);\r\n` +
`    const uniqueModes = Array.from(new Set(transportModesInput.length ? transportModesInput : ['camion']));\r\n` +
`    const rawWindows = Array.isArray(parsed.rawDateWindows) && parsed.rawDateWindows.length\r\n` +
`      ? parsed.rawDateWindows\r\n` +
`      : parsed.dateWindows;\r\n\r\n` +
`    let cotizacionRegistrada = false;\r\n\r\n` +
`    for (const mode of uniqueModes) {\r\n` +
`      const windowsForMode = (rawWindows || [])\r\n` +
`        .map(window => adjustWindowForTransport(window, mode))\r\n` +
`        .filter(Boolean)\r\n` +
`        .slice(0, this.maxWindows);\r\n\r\n` +
`      if (!windowsForMode.length) continue;\r\n\r\n` +
`      if (uniqueModes.length > 1) {\r\n` +
`        await this._safeSend(phoneNumber, formatTransportLabel(mode) + ' · preparando opciones...');\r\n` +
`        await sleep(250);\r\n` +
`      }\r\n\r\n` +
`      for (let i = 0; i < windowsForMode.length; i += 1) {\r\n` +
`        const window = windowsForMode[i];\r\n` +
`        try {\r\n` +
`          const tierResults = await this._executeSearch(parsed, window, pasajerosConfig, mode);\r\n` +
`          if (!tierResults || !tierResults.options.length) {\r\n` +
`            await this._safeSend(phoneNumber, 'Para ' + formatDateRange(window.salida, window.regreso) + ' (' + formatTransportLabel(mode, false) + ') no encontre opciones disponibles. Probamos con otra fecha?');\r\n` +
`            await sleep(300);\r\n` +
`            continue;\r\n` +
`          }\r\n\r\n` +
`          const decorated = [];\r\n` +
`          for (const opt of tierResults.options) {\r\n` +
`            decorated.push(await this._enrichWithMedia(opt));\r\n` +
`          }\r\n\r\n` +
`          const parsedForMode = { ...parsed, transporte: mode };\r\n` +
`          const messageChunks = await this._buildWindowMessages(parsedForMode, window, {\r\n` +
`            ...tierResults,\r\n` +
`            mode,\r\n` +
`            options: decorated\r\n` +
`          });\r\n\r\n` +
`          for (const chunk of messageChunks) {\r\n` +
`            await this._safeSend(phoneNumber, chunk);\r\n` +
`            await sleep(450);\r\n` +
`          }\r\n\r\n` +
`          if (!cotizacionRegistrada) {\r\n` +
`            try {\r\n` +
`              const cotizacionesService = require('./cotizaciones.service');\r\n` +
`              await cotizacionesService.guardarCotizacion({\r\n` +
`                numero_telefono: phoneNumber,\r\n` +
`                tipo: 'PERSONALIZADA',\r\n` +
`                datos_cotizacion: {\r\n` +
`                  destino: parsed.destino,\r\n` +
`                  check_in: window.salida,\r\n` +
`                  check_out: window.regreso,\r\n` +
`                  ocupacion: {\r\n` +
`                    adultos: parsed.adultos.map((_, idx) => ({ nombre: 'Adulto ' + (idx + 1), edad: 30 })),\r\n` +
`                    menores: parsed.menores.map(edad => ({ nombre: 'Menor', edad }))\r\n` +
`                  },\r\n` +
`                  plan: parsed.plan,\r\n` +
`                  transporte: uniqueModes.join(' + '),\r\n` +
`                  hotel_deseado: parsed.hotelDeseado,\r\n` +
`                  presupuesto_aprox_adulto: parsed.presupuestoAdulto,\r\n` +
`                  num_opciones: tierResults.options.length\r\n` +
`                }\r\n` +
`              });\r\n` +
`              console.log('Cotizacion guardada exitosamente para ' + phoneNumber);\r\n` +
`              cotizacionRegistrada = true;\r\n` +
`            } catch (err) {\r\n` +
`              console.error('Error guardando cotizacion:', err);\r\n` +
`            }\r\n` +
`          }\r\n` +
`        } catch (error) {\r\n` +
`          console.error('FichaCotiProcessor window error:', error);\r\n` +
`          await this._safeSend(\r\n` +
`            phoneNumber,\r\n` +
`            '?? Tuvimos un detallito con la ventana *' + formatDateRange(window.salida, window.regreso) + '* (' + formatTransportLabel(mode, false) + '). Ya avisé al equipo humano para ayudarte en cuanto tengan disponibilidad.'\r\n` +
`          );\r\n` +
`          await sleep(300);\r\n` +
`        }\r\n` +
`      }\r\n` +
`    }\r\n\r\n`;
const newText = before + newSegment + after;
fs.writeFileSync(path, newText);
