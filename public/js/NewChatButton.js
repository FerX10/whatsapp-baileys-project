// /public/js/NewChatButton.js
/* global React */
window.NewChatButton = (() => {
    'use strict';

    function NewChatButton() {
        const [showModal, setShowModal] = React.useState(false);
        const [phoneNumber, setPhoneNumber] = React.useState('');
        const [message, setMessage] = React.useState('');
        const [error, setError] = React.useState('');
        const [isSending, setIsSending] = React.useState(false);

        const formatPhoneNumber = (number) => {
            const clean = (number || '').replace(/\D/g, '');
            if (clean.length === 10) return `521${clean}`;
            if (clean.startsWith('521') && clean.length === 13) return clean;
            if (clean.startsWith('52') && clean.length === 12) return `521${clean.slice(2)}`;
            return clean;
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            setError('');
            setIsSending(true);
            try {
                const formatted = formatPhoneNumber(phoneNumber);
                if (formatted.length !== 13 || !formatted.startsWith('521')) {
                    throw new Error('El número debe tener 10 dígitos (se agrega 521 automáticamente)');
                }

                const token = sessionStorage.getItem('token') || localStorage.getItem('token');
                const res = await fetch('/send-message', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        phoneNumber: formatted,
                        message,
                        userId: sessionStorage.getItem('userId'),
                        username: sessionStorage.getItem('username')
                    })
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.message || 'Error al enviar mensaje');
                }

                if (typeof window.loadChatList === 'function') {
                    await window.loadChatList();
                }
                if (typeof window.loadChat === 'function') {
                    await window.loadChat(formatted);
                }

                setShowModal(false);
                setPhoneNumber('');
                setMessage('');
            } catch (err) {
                setError(err.message);
            } finally {
                setIsSending(false);
            }
        };

        // UI: dos botones lado a lado
        return React.createElement(
            'div',
            { className: 'mb-4 flex gap-2' },
            // Botón: Nuevo chat
            React.createElement(
                'button',
                {
                    onClick: () => setShowModal(true),
                    className:
                        'flex-1 p-3 text-left bg-green-50 hover:bg-green-100 transition-colors duration-200 flex items-center gap-2 rounded-lg border border-green-200'
                },
                React.createElement('span', { className: 'text-xl' }, '➕'),
                React.createElement('span', null, 'Nuevo chat')
            ),
            // Botón: Promos
            React.createElement(
                'a',
                {
                    href: '/promos',
                    className:
                        'flex-1 p-3 text-left bg-yellow-50 hover:bg-yellow-100 transition-colors duration-200 flex items-center gap-2 rounded-lg border border-yellow-200'
                },
                React.createElement('span', { className: 'text-xl' }, '⭐'),
                React.createElement('span', null, 'Promos')
            ),
            // Modal nuevo chat
            showModal &&
            React.createElement(
                'div',
                { className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50' },
                React.createElement(
                    'div',
                    { className: 'bg-white rounded-lg p-6 max-w-md w-full shadow-xl' },
                    React.createElement('h2', { className: 'text-xl font-bold mb-4' }, 'Nuevo Chat'),
                    React.createElement(
                        'form',
                        { onSubmit: handleSubmit },
                        React.createElement(
                            'div',
                            { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium mb-2' }, 'Número de Teléfono'),
                            React.createElement('input', {
                                type: 'tel',
                                value: phoneNumber,
                                onChange: (e) => setPhoneNumber(e.target.value),
                                placeholder: '4771234567 (10 dígitos)',
                                className: 'w-full p-2 border rounded',
                                required: true,
                                maxLength: 10,
                                pattern: '[0-9]{10}'
                            }),
                            React.createElement(
                                'p',
                                { className: 'text-xs text-gray-500 mt-1' },
                                'Escribe sólo 10 dígitos; el prefijo 521 se agrega automático.'
                            )
                        ),
                        React.createElement(
                            'div',
                            { className: 'mb-4' },
                            React.createElement('label', { className: 'block text-sm font-medium mb-2' }, 'Mensaje'),
                            React.createElement('textarea', {
                                value: message,
                                onChange: (e) => setMessage(e.target.value),
                                placeholder: 'Escribe tu mensaje…',
                                className: 'w-full p-2 border rounded h-24',
                                required: true
                            })
                        ),
                        error &&
                        React.createElement(
                            'div',
                            { className: 'mb-4 p-2 bg-red-100 text-red-700 rounded' },
                            error
                        ),
                        React.createElement(
                            'div',
                            { className: 'flex justify-end gap-2' },
                            React.createElement(
                                'button',
                                {
                                    type: 'button',
                                    onClick: () => setShowModal(false),
                                    className: 'px-4 py-2 text-gray-600 hover:bg-gray-100 rounded'
                                },
                                'Cancelar'
                            ),
                            React.createElement(
                                'button',
                                {
                                    type: 'submit',
                                    disabled: isSending,
                                    className: 'px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50'
                                },
                                isSending ? 'Enviando…' : 'Enviar'
                            )
                        )
                    )
                )
            )
        );
    }

    return NewChatButton;
})();
