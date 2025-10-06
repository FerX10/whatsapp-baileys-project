// socket.js
async function initializeSocket() {
  if (!window.io) {
    console.error("❌ Error: Socket.IO no ha sido cargado.");
    return null;
  }
  if (window.socket) {
    console.log("Socket ya inicializado");
    return window.socket;
  }
  try {
    window.socket = io({
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 60000
    });
    window.socket.on('connect', () => {
      console.log('Socket conectado');
    });
    window.socket.on('disconnect', () => {
      console.log('Socket desconectado');
    });
    window.socket.on('connect_error', (error) => {
      console.error('Error de conexión:', error);
    });
    window.socket.on('newMessage', async (msg) => {
      console.log('🔔 Nuevo mensaje recibido:', msg);
      const chatItem = document.querySelector(`[data-phone-number="${msg.phoneNumber}"]`);
      if (msg.phoneNumber !== window.currentPhoneNumber) {
        if (chatItem) {
          const newTimestamp = msg.timestamp || Date.now();
          chatItem.dataset.lastMessageTime = String(newTimestamp);
          const preview = chatItem.querySelector('.chat-preview');
          if (preview) preview.textContent = msg.message || msg.mensaje || 'Nuevo mensaje';
          animateMoveToTop(chatItem);
        } else {
          await window.loadChatList(true);
        }
      } else {
        if (typeof window.renderMessage === 'function') {
          window.renderMessage(msg);
          const container = document.getElementById('messagesContainer');
          if (container) container.scrollTop = container.scrollHeight;
          try {
            await fetchWithAuth(`/mark-as-read/${msg.phoneNumber}`, { method: 'POST' });
          } catch (e) {
            console.error('Error al marcar mensajes como leídos:', e);
          }
        }
      }
      if (chatItem) {
        const preview = chatItem.querySelector('.chat-preview');
        if (preview) preview.textContent = msg.message || msg.mensaje;
        const time = chatItem.querySelector('.chat-time');
        if (time && window.formatToSpecificTimeZone) {
          time.textContent = window.formatToSpecificTimeZone(msg.timestamp || new Date());
        }
      }
      if (!chatItem && typeof window.loadChatList === 'function') {
        await window.loadChatList(true);
      }
    });
    window.socket.on('typing', data => {
      if (typeof window.handleUserTyping === 'function') {
        window.handleUserTyping(data);
      }
    });
    window.socket.on('stopTyping', data => {
      if (typeof window.handleUserStoppedTyping === 'function') {
        window.handleUserStoppedTyping(data);
      }
    });
    window.socket.on('chatListUpdated', async () => {
      console.log('🔄 Evento chatListUpdated recibido');
      if (typeof window.loadChatList === 'function') {
        await window.loadChatList(true);
      } else {
        console.error('loadChatList no está definida');
      }
    });

    window.socket.on('tagsUpdated', (payload) => {
      console.log('🏷️ Evento tagsUpdated recibido en cliente:', payload);

      // Actualizar el chat activo si corresponde
      if (window.currentPhoneNumber === payload.phoneNumber) {
        // 1. Actualizar el header
        if (payload.assignedTags) {
          updateTagsDisplay(payload.assignedTags);
        }

        // 2. Actualizar el modal de etiquetas si está abierto
        const tagModal = document.getElementById('tagModal');
        if (tagModal && tagModal.style.display === 'block' && typeof window.updateTagModal === 'function') {
          window.updateTagModal(payload.assignedTags);
        }
      }

      // 3. Actualizar el elemento en la lista de chats
      if (payload.phoneNumber && payload.assignedTags) {
        updateChatItemTags(payload.phoneNumber, payload.assignedTags);
      }

      // 4. Actualizar la vista de tabla si existe
      if (typeof updateTableViewTags === 'function' && payload.phoneNumber && payload.assignedTags) {
        updateTableViewTags(payload.phoneNumber, payload.assignedTags);
      }
    });


    window.socket.on('contactUpdated', (data) => {
      if (!data.success) return;
      const updatedPhone = data.phoneNumber;
      const newName = data.nombre;
      if (window.currentPhoneNumber === updatedPhone) {
        const headerTitleEl = document.querySelector('.header-title');
        if (headerTitleEl) headerTitleEl.textContent = newName;
      }
      const chatItemEl = document.querySelector(`.chat-list-item[data-phone-number="${updatedPhone}"] .chat-phone`);
      if (chatItemEl) {
        chatItemEl.textContent = truncateName(newName, 2) + ` (${formatPhoneNumber(updatedPhone)})`;
      }
    });
    return window.socket;
  } catch (error) {
    console.error('Error inicializando socket:', error);
    return null;
  }
}

function animateMoveToTop(chatItem) {
  const container = document.querySelector('.chat-items');
  if (!container || !chatItem) return;
  const originalRect = chatItem.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const clone = chatItem.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.top = (originalRect.top - containerRect.top) + 'px';
  clone.style.left = (originalRect.left - containerRect.left) + 'px';
  clone.style.width = originalRect.width + 'px';
  clone.style.transition = 'transform 0.3s ease';
  container.appendChild(clone);
  chatItem.style.visibility = 'hidden';
  container.prepend(chatItem);
  const newRect = chatItem.getBoundingClientRect();
  const deltaY = newRect.top - originalRect.top;
  clone.style.transform = `translateY(${deltaY}px)`;
  clone.addEventListener('transitionend', () => {
    clone.remove();
    chatItem.style.visibility = 'visible';
  });
}

document.addEventListener('DOMContentLoaded', initializeSocket);
