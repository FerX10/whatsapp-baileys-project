(function (global) {
    const { useState, useEffect } = React;

    const BulkMessageSender = function () {
        const [step, setStep] = useState(1);
        const [selectedNumbers, setSelectedNumbers] = useState([]);
        const [message, setMessage] = useState('');
        const [file, setFile] = useState(null);
        const [preview, setPreview] = useState('');
        const [existingNumbers, setExistingNumbers] = useState([]);
        const [manualNumber, setManualNumber] = useState('');
        const [searchTerm, setSearchTerm] = useState('');
        const [error, setError] = useState('');
        const [success, setSuccess] = useState('');
        const [isProcessing, setIsProcessing] = useState(false);
        const [isScheduled, setIsScheduled] = useState(false);
        const [scheduleDate, setScheduleDate] = useState('');
        const [scheduleTime, setScheduleTime] = useState('');

        // Cargar números existentes al inicio
        useEffect(() => {
            loadExistingNumbers();
            setInitialDateTime();
        }, []);

        const setInitialDateTime = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            setScheduleDate(tomorrow.toISOString().split('T')[0]);
            setScheduleTime(now.toTimeString().slice(0, 5));
        };

        const loadExistingNumbers = async () => {
            try {
                const token = sessionStorage.getItem('token');
                const response = await fetch('/chat-list', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                setExistingNumbers(data.map(chat => chat.numero_telefono));
            } catch (err) {
                setError('Error al cargar contactos');
            }
        };

        // Función para manejar carga de archivos Excel/CSV
        const handleContactsUpload = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            setIsProcessing(true);
            setError('');

            const isExcel = /\.(xlsx|xls)$/i.test(file.name);
            const isCSV = /\.csv$/i.test(file.name);

            if (!isExcel && !isCSV) {
                setError('Por favor sube un archivo Excel (.xlsx, .xls) o CSV (.csv)');
                setIsProcessing(false);
                return;
            }

            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    let extractedNumbers = [];

                    if (isCSV) {
                        // Procesar CSV con PapaParse
                        Papa.parse(e.target.result, {
                            header: true,
                            skipEmptyLines: true,
                            complete: (results) => {
                                // Buscar columna que podría contener números telefónicos
                                const possibleColumns = ['telefono', 'phone', 'celular', 'movil', 'numero', 'number', 'tel'];
                                const headers = results.meta.fields.map(h => h.toLowerCase());

                                // Encontrar columna de teléfono
                                let phoneColumn = null;
                                for (let col of possibleColumns) {
                                    const index = headers.findIndex(h => h.includes(col));
                                    if (index !== -1) {
                                        phoneColumn = results.meta.fields[index];
                                        break;
                                    }
                                }

                                // Si no se encuentra columna específica, usar la primera
                                if (!phoneColumn && results.meta.fields.length > 0) {
                                    phoneColumn = results.meta.fields[0];
                                }

                                if (phoneColumn) {
                                    results.data.forEach(row => {
                                        if (row[phoneColumn]) {
                                            const cleanedNumber = row[phoneColumn].toString().replace(/\D/g, '');
                                            if (cleanedNumber.length >= 10) {
                                                extractedNumbers.push(cleanedNumber);
                                            }
                                        }
                                    });
                                }

                                if (extractedNumbers.length > 0) {
                                    setSelectedNumbers(prev => [...new Set([...prev, ...extractedNumbers])]);
                                    setSuccess(`Se importaron ${extractedNumbers.length} números de teléfono del CSV`);
                                } else {
                                    setError('No se encontraron números de teléfono válidos en el archivo');
                                }
                                setIsProcessing(false);
                            },
                            error: (error) => {
                                setError(`Error al procesar CSV: ${error.message}`);
                                setIsProcessing(false);
                            }
                        });
                    } else if (isExcel) {
                        // Procesar Excel con SheetJS
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(worksheet);

                        // Buscar columna que podría contener números telefónicos
                        let phoneColumn = null;
                        if (jsonData.length > 0) {
                            const firstRow = jsonData[0];
                            const possibleColumns = ['telefono', 'phone', 'celular', 'movil', 'numero', 'number', 'tel'];

                            for (let key of Object.keys(firstRow)) {
                                if (possibleColumns.some(col => key.toLowerCase().includes(col))) {
                                    phoneColumn = key;
                                    break;
                                }
                            }

                            // Si no se encuentra columna específica, usar la primera
                            if (!phoneColumn) {
                                phoneColumn = Object.keys(firstRow)[0];
                            }

                            jsonData.forEach(row => {
                                if (row[phoneColumn]) {
                                    const cleanedNumber = row[phoneColumn].toString().replace(/\D/g, '');
                                    if (cleanedNumber.length >= 10) {
                                        extractedNumbers.push(cleanedNumber);
                                    }
                                }
                            });
                        }

                        if (extractedNumbers.length > 0) {
                            setSelectedNumbers(prev => [...new Set([...prev, ...extractedNumbers])]);
                            setSuccess(`Se importaron ${extractedNumbers.length} números de teléfono del Excel`);
                        } else {
                            setError('No se encontraron números de teléfono válidos en el archivo');
                        }
                        setIsProcessing(false);
                    }
                } catch (error) {
                    console.error('Error al procesar archivo:', error);
                    setError(`Error al procesar el archivo: ${error.message}`);
                    setIsProcessing(false);
                }
            };

            reader.onerror = () => {
                setError('Error al leer el archivo');
                setIsProcessing(false);
            };

            if (isCSV) {
                reader.readAsText(file);
            } else {
                reader.readAsArrayBuffer(file);
            }
        };

        // Función para manejar carga de archivos multimedia
        const handleFileUpload = (e) => {
            e.stopPropagation(); // Detener propagación para evitar que otros manejadores lo capturen
            
            const file = e.target.files[0];
            if (!file) return;

            // Validación del archivo
            if (file.size > 50 * 1024 * 1024) { // 50MB
                setError('El archivo no debe exceder 50MB');
                return;
            }

            const allowedTypes = [
                'image/jpeg',
                'image/png',
                'image/gif',
                'video/mp4',
                'audio/mpeg',
                'audio/ogg',
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ];

            if (!allowedTypes.includes(file.type)) {
                setError('Tipo de archivo no permitido');
                return;
            }

            // Establecer el archivo y mostrar la vista previa
            setFile(file);
            
            // Solo generar vista previa para imágenes
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => setPreview(e.target.result);
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('video/')) {
                // Para videos, mostrar un icono o miniatura genérica
                setPreview('/img/video-icon.png'); // Ajusta la ruta según corresponda
            } else {
                // Para otros tipos de archivos
                setPreview('/img/file-icon.png'); // Ajusta la ruta según corresponda
            }
        };

        const renderStepIndicator = () => {
            return React.createElement('div', {
                className: 'flex items-center justify-center mb-8 bg-gray-50 p-4 rounded-lg'
            }, [1, 2, 3].map(number =>
                React.createElement('div', {
                    key: number,
                    className: `flex items-center ${number < 3 ? 'flex-1' : ''}`
                }, [
                    React.createElement('div', {
                        className: `w-10 h-10 rounded-full flex items-center justify-center
                            ${step >= number ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`
                    }, number),
                    number < 3 && React.createElement('div', {
                        className: `flex-1 h-1 mx-4 ${step > number ? 'bg-blue-600' : 'bg-gray-200'}`
                    })
                ])
            ));
        };

        const renderStep1 = () => {
            return React.createElement('div', {
                className: 'space-y-6'
            }, [
                // Sección de búsqueda y agregar número
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('div', {
                        className: 'flex gap-4 mb-4'
                    }, [
                        React.createElement('input', {
                            type: 'text',
                            value: manualNumber,
                            onChange: (e) => setManualNumber(e.target.value),
                            placeholder: 'Agregar número: 5512345678',
                            className: 'flex-1 px-4 py-2 border rounded-lg'
                        }),
                        React.createElement('button', {
                            onClick: () => {
                                if (!manualNumber.match(/^\d{10,12}$/)) {
                                    setError('Número inválido');
                                    return;
                                }
                                setSelectedNumbers(prev => [...new Set([...prev, manualNumber])]);
                                setManualNumber('');
                            },
                            className: 'px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
                        }, 'Agregar')
                    ]),
                    React.createElement('input', {
                        type: 'text',
                        value: searchTerm,
                        onChange: (e) => setSearchTerm(e.target.value),
                        placeholder: 'Buscar en contactos existentes...',
                        className: 'w-full px-4 py-2 border rounded-lg'
                    })
                ]),

                // AÑADIR NUEVA SECCIÓN AQUÍ - Importación de contactos
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('h3', {
                        className: 'text-lg font-semibold mb-4'
                    }, 'Importar Contactos'),
                    React.createElement('input', {
                        type: 'file',
                        onChange: handleContactsUpload,
                        accept: '.xlsx,.xls,.csv',
                        className: 'hidden',
                        id: 'contactsFileInput'
                    }),
                    React.createElement('button', {
                        onClick: (e) => {
                            e.preventDefault();
                            document.getElementById('contactsFileInput').click();
                        },
                        className: 'px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700'
                    }, 'Importar contactos desde Excel/CSV')
                ]),

                // Lista de números existentes
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('div', {
                        className: 'flex justify-between items-center mb-4'
                    }, [
                        React.createElement('h3', {
                            className: 'text-lg font-semibold'
                        }, 'Contactos Disponibles'),
                        React.createElement('button', {
                            onClick: () => {
                                const filteredNumbers = existingNumbers.filter(number => number.includes(searchTerm));
                                const allSelected = filteredNumbers.every(number => selectedNumbers.includes(number));

                                setSelectedNumbers(prev => {
                                    if (allSelected) {
                                        // Remove filtered numbers if all are currently selected
                                        return prev.filter(n => !filteredNumbers.includes(n));
                                    } else {
                                        // Add numbers that aren't already selected
                                        return [...new Set([...prev, ...filteredNumbers.filter(n => !prev.includes(n))])];
                                    }
                                });
                            },
                            className: 'text-blue-600 hover:text-blue-800'
                        }, 'Seleccionar todos')
                    ]),
                    React.createElement('div', {
                        className: 'max-h-64 overflow-y-auto space-y-2'
                    }, existingNumbers
                        .filter(number => number.includes(searchTerm))
                        .map(number =>
                            React.createElement('div', {
                                key: number,
                                className: `p-3 rounded-lg cursor-pointer flex items-center justify-between
                                ${selectedNumbers.includes(number) ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 hover:bg-gray-100'} 
                                border transition-colors duration-200`,
                                onClick: () => {
                                    setSelectedNumbers(prev =>
                                        prev.includes(number)
                                            ? prev.filter(n => n !== number)
                                            : [...prev, number]
                                    );
                                }
                            }, [
                                React.createElement('span', {}, number),
                                selectedNumbers.includes(number) && React.createElement('span', {
                                    className: 'text-blue-600'
                                }, '✓')
                            ])
                        )
                    )
                ]),

                // Números seleccionados
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('div', {
                        className: 'flex justify-between items-center mb-4'
                    }, [
                        React.createElement('h3', {
                            className: 'text-lg font-semibold'
                        }, `Números Seleccionados (${selectedNumbers.length})`),
                        React.createElement('button', {
                            onClick: () => setSelectedNumbers([]),
                            className: 'text-red-600 hover:text-red-800'
                        }, 'Limpiar todo')
                    ]),
                    React.createElement('div', {
                        className: 'flex flex-wrap gap-2'
                    }, selectedNumbers.map(number =>
                        React.createElement('div', {
                            key: number,
                            className: 'bg-blue-50 text-blue-700 px-3 py-1 rounded-full flex items-center gap-2'
                        }, [
                            React.createElement('span', {}, number),
                            React.createElement('button', {
                                onClick: (e) => {
                                    e.stopPropagation();
                                    setSelectedNumbers(prev => prev.filter(n => n !== number));
                                },
                                className: 'text-blue-400 hover:text-blue-600'
                            }, '×')
                        ])
                    ))
                ])
            ]);
        };

        const renderStep2 = () => {
            return React.createElement('div', {
                className: 'space-y-6'
            }, [
                // Área de mensaje
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('h3', {
                        className: 'text-lg font-semibold mb-4'
                    }, 'Mensaje'),
                    React.createElement('textarea', {
                        value: message,
                        onChange: (e) => setMessage(e.target.value),
                        placeholder: 'Escribe tu mensaje aquí...',
                        className: 'w-full p-4 border rounded-lg h-40 resize-none focus:ring-2 focus:ring-blue-500'
                    })
                ]),

                // Subida de archivo
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('h3', {
                        className: 'text-lg font-semibold mb-4'
                    }, 'Archivo Adjunto (Opcional)'),
                    React.createElement('input', {
                        type: 'file',
                        onChange: handleFileUpload,
                        accept: 'image/*,video/*,audio/*,application/pdf',
                        className: 'hidden',
                        id: 'bulk_file_input'
                    }),
                    React.createElement('label', {
                        htmlFor: 'bulk_file_input',
                        className: 'block w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-center cursor-pointer hover:border-blue-500'
                    }, 'Haz clic para seleccionar un archivo'),
                    preview && React.createElement('div', {
                        className: 'mt-4 relative'
                    }, [
                        file && file.type.startsWith('image/') ?
                            React.createElement('img', {
                                src: preview,
                                alt: 'Preview',
                                className: 'max-h-48 rounded-lg mx-auto'
                            }) :
                            React.createElement('div', {
                                className: 'bg-gray-100 p-4 rounded-lg text-center'
                            }, [
                                React.createElement('div', {
                                    className: 'text-3xl mb-2'
                                }, file && file.type.startsWith('video/') ? '🎬' : file && file.type.startsWith('audio/') ? '🔊' : '📄'),
                                React.createElement('div', {
                                    className: 'text-gray-700'
                                }, file ? file.name : 'Archivo seleccionado')
                            ]),
                        React.createElement('button', {
                            onClick: (e) => {
                                e.stopPropagation();
                                setFile(null);
                                setPreview('');
                            },
                            className: 'absolute top-2 right-2 bg-red-500 text-white w-6 h-6 rounded-full'
                        }, '×')
                    ])
                ])
            ]);
        };

        const renderStep3 = () => {
            return React.createElement('div', {
                className: 'space-y-6'
            }, [
                // Opciones de programación
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('div', {
                        className: 'flex items-center gap-2 mb-6'
                    }, [
                        React.createElement('input', {
                            type: 'checkbox',
                            checked: isScheduled,
                            onChange: (e) => setIsScheduled(e.target.checked),
                            className: 'w-5 h-5 text-blue-600'
                        }),
                        React.createElement('span', {
                            className: 'text-lg'
                        }, 'Programar envío')
                    ]),
                    isScheduled && React.createElement('div', {
                        className: 'grid grid-cols-2 gap-4'
                    }, [
                        React.createElement('div', {}, [
                            React.createElement('label', {
                                className: 'block text-sm font-medium text-gray-700 mb-1'
                            }, 'Fecha'),
                            React.createElement('input', {
                                type: 'date',
                                value: scheduleDate,
                                min: new Date().toISOString().split('T')[0],
                                onChange: (e) => setScheduleDate(e.target.value),
                                className: 'w-full px-3 py-2 border rounded-lg'
                            })
                        ]),
                        React.createElement('div', {}, [
                            React.createElement('label', {
                                className: 'block text-sm font-medium text-gray-700 mb-1'
                            }, 'Hora'),
                            React.createElement('input', {
                                type: 'time',
                                value: scheduleTime,
                                onChange: (e) => setScheduleTime(e.target.value),
                                className: 'w-full px-3 py-2 border rounded-lg'
                            })
                        ])
                    ])
                ]),

                // Resumen
                React.createElement('div', {
                    className: 'bg-white p-6 rounded-lg shadow-sm border'
                }, [
                    React.createElement('h3', {
                        className: 'text-lg font-semibold mb-4'
                    }, 'Resumen'),
                    React.createElement('div', {
                        className: 'space-y-4'
                    }, [
                        React.createElement('div', {}, [
                            React.createElement('span', {
                                className: 'font-medium'
                            }, 'Destinatarios: '),
                            React.createElement('span', {
                                className: 'text-blue-600'
                            }, `${selectedNumbers.length} números`)
                        ]),
                        React.createElement('div', {}, [
                            React.createElement('span', {
                                className: 'font-medium'
                            }, 'Mensaje: '),
                            React.createElement('span', {
                                className: 'text-gray-600'
                            }, message.substring(0, 50) + (message.length > 50 ? '...' : ''))
                        ]),
                        file && React.createElement('div', {}, [
                            React.createElement('span', {
                                className: 'font-medium'
                            }, 'Archivo adjunto: '),
                            React.createElement('span', {
                                className: 'text-gray-600'
                            }, file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)')
                        ]),
                        isScheduled && React.createElement('div', {}, [
                            React.createElement('span', {
                                className: 'font-medium'
                            }, 'Programado para: '),
                            React.createElement('span', {
                                className: 'text-gray-600'
                            }, `${scheduleDate} a las ${scheduleTime}`)
                        ])
                    ])
                ])
            ]);
        };

        const canProceed = () => {
            switch (step) {
                case 1:
                    return selectedNumbers.length > 0;
                case 2:
                    return message.trim().length > 0;
                case 3:
                    return true;
                default:
                    return false;
            }
        };

        const handleSend = async () => {
            if (!message || selectedNumbers.length === 0) {
                setError('Por favor completa todos los campos requeridos');
                return;
            }

            setIsProcessing(true);
            setError('');

            try {
                const formData = new FormData();
                formData.append('message', message);
                formData.append('phoneNumbers', JSON.stringify(selectedNumbers));

                if (file) {
                    formData.append('file', file);
                }

                if (isScheduled) {
                    formData.append('isScheduled', 'true');
                    formData.append('scheduleDateTime', `${scheduleDate}T${scheduleTime}`);
                }

                const token = sessionStorage.getItem('token');
                const response = await fetch('/send-bulk-messages', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                        // No incluir Content-Type para que FormData establezca el boundary correcto
                    },
                    body: formData
                });

                // Manejar respuesta no-JSON (como HTML de error 404)
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('application/json')) {
                    const text = await response.text();
                    console.error('Respuesta no-JSON recibida:', text);
                    throw new Error(`Error en el servidor (${response.status}): El endpoint no existe o no está configurado correctamente`);
                }

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result.message || 'Error al enviar mensajes');
                }

                setSuccess(`Mensajes ${isScheduled ? 'programados' : 'enviados'} correctamente: ${result.successful} de ${result.total}`);
                setMessage('');
                setFile(null);
                setPreview('');
                setSelectedNumbers([]);
                setStep(1);
            } catch (error) {
                console.error('Error en handleSend:', error);
                setError(error.message || 'Error al enviar mensajes');
            } finally {
                setIsProcessing(false);
            }
        };

        // Renderizar el componente principal
        return React.createElement('div', {
            className: 'max-w-4xl mx-auto bg-gray-50 p-6 rounded-xl'
        }, [
            // Encabezado
            React.createElement('div', {
                className: 'text-center mb-8'
            }, [
                React.createElement('h2', {
                    className: 'text-2xl font-bold text-gray-800'
                }, isScheduled ? 'Programar Mensajes Masivos' : 'Enviar Mensajes Masivos'),
                React.createElement('p', {
                    className: 'text-gray-600 mt-2'
                }, 'Complete los pasos para enviar sus mensajes')
            ]),

            // Indicador de pasos
            renderStepIndicator(),

            // Mensajes de error y éxito
            error && React.createElement('div', {
                className: 'mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700'
            }, error),

            success && React.createElement('div', {
                className: 'mb-6 p-4 bg-green-50 border-l-4 border-green-500 text-green-700'
            }, success),

            // Contenido del paso actual
            React.createElement('div', {
                className: 'mb-8'
            }, step === 1 ? renderStep1() : step === 2 ? renderStep2() : renderStep3()),

            // Botones de navegación
            React.createElement('div', {
                className: 'flex justify-between items-center'
            }, [
                step > 1 && React.createElement('button', {
                    onClick: () => setStep(step - 1),
                    className: 'px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300'
                }, 'Anterior'),

                step < 3 ? React.createElement('button', {
                    onClick: () => canProceed() && setStep(step + 1),
                    disabled: !canProceed(),
                    className: `px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 
                        disabled:opacity-50 disabled:cursor-not-allowed`
                }, 'Siguiente') : React.createElement('button', {
                    onClick: handleSend,
                    disabled: isProcessing || !canProceed(),
                    className: `px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 
                        disabled:opacity-50 disabled:cursor-not-allowed`
                }, isProcessing ? 'Procesando...' : isScheduled ? 'Programar Mensajes' : 'Enviar Mensajes')
            ])
        ]);
    };

    // Exponer el componente globalmente
    global.BulkMessageSender = BulkMessageSender;
})(window);