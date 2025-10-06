/*******************************************************
 * tags.js – Código completo, corregido y funcional
 * (Se incluyen TODOS los elementos, sin quitar nada).
 *******************************************************/

/*******************************************************
 * Exponer las funciones globalmente
 *******************************************************/
window.setCurrentPhoneNumber = setCurrentPhoneNumber;
window.toggleTagModal = toggleTagModal;
window.initTagModal = initTagModal;
window.initTagForm = initTagForm;
window.loadTags = loadTags;
window.toggleTagAssignment = toggleTagAssignment;
window.createTagElement = createTagElement; // Por si lo necesitas fuera
window.updateTagsDisplay = updateTagsDisplay;
window.partialLoadChatTags = partialLoadChatTags; // Por si lo necesitas fuera
// NOTA: Renombramos una de las funciones repetidas “updateChatItemTags” a “updateChatItemTagsFromServer” (abajo)

/*******************************************************
 * Variable global para almacenar el phoneNumber actual
 *******************************************************/
window.currentPhoneNumber = null;

/*******************************************************
 * 1. Función para actualizar la visualización de etiquetas en el header
 *    (Mejorada para que no haya conflicto con tu "header-title".)
 *******************************************************/

function updateTagsDisplay(tags) {
  console.log('Actualizando etiquetas en header:', tags);

  const chatHeader = document.getElementById('chatHeader');
  if (!chatHeader) return;

  // Guardar el menú existente (si lo hubiera)
  const existingMenu = chatHeader.querySelector('.menu-container');

  // Buscar o crear el contenedor que agrupa el título y las etiquetas
  let headerContent = chatHeader.querySelector('.header-content');
  if (!headerContent) {
    headerContent = document.createElement('div');
    headerContent.className = 'header-content';

    // Crear y agregar el título (solo si no existe ya .header-title)
    let existingTitle = chatHeader.querySelector('.header-title');
    if (!existingTitle) {
      // Creamos un div de título
      const headerTitle = document.createElement('div');
      headerTitle.className = 'header-title';
      headerTitle.textContent = formatPhoneNumber(window.currentPhoneNumber);
      headerContent.appendChild(headerTitle);
    } else {
      // Si ya existía, lo movemos dentro
      headerContent.appendChild(existingTitle);
    }

    // Crear y agregar el contenedor de etiquetas
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'chat-tags';
    headerContent.appendChild(tagsContainer);

    // Insertar headerContent antes del menú si existe
    if (existingMenu) {
      chatHeader.insertBefore(headerContent, existingMenu);
    } else {
      chatHeader.appendChild(headerContent);
    }
  }

  // Actualizar solo el contenedor de etiquetas
  const tagsContainer = headerContent.querySelector('.chat-tags');
  if (tagsContainer) {
    tagsContainer.innerHTML = '';
    if (tags && tags.length > 0) {
      // Filtrar y ordenar etiquetas asignadas (usando la propiedad "activo")
      const assignedTags = tags
        .filter(tag => tag.activo)
        .sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));
      assignedTags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag';
        tagElement.style.backgroundColor = tag.color;
        tagElement.textContent = tag.nombre;
        tagsContainer.appendChild(tagElement);
      });
    }
  }

  // Asegurar que el menú se mantenga
  if (existingMenu && !chatHeader.contains(existingMenu)) {
    chatHeader.appendChild(existingMenu);
  }
}

/*******************************************************
 * 2. Función para cerrar el modal de etiquetas
 *******************************************************/
function closeTagModal() {
  const modal = document.getElementById('tagModal');
  if (modal) {
    modal.style.display = 'none';
    if (window.currentPhoneNumber) {
      loadTags(true)
        .then(() => {
          const header = document.getElementById('chatHeader');
          const existingMenu = header.querySelector('.menu-container');
          if (existingMenu) header.appendChild(existingMenu);
        })
        .catch(error => console.error('Error al recargar etiquetas:', error));
    }
  }
}

/*******************************************************
 * 3.1. Función para actualizar (al vuelo) etiquetas en un ítem de la lista (chat-list)
 *     Tomando 'assignedTags' directamente como argumento.
 *******************************************************/

async function updateChatItemTags(phoneNumber, assignedTags) {
  console.log('🔄 Actualizando etiquetas en chat-list para:', phoneNumber);

  // 1) Encontrar el .chat-list-item correspondiente:
  const chatItem = document.querySelector(`.chat-list-item[data-phone-number="${phoneNumber}"]`);
  if (!chatItem) {
    console.log(`❌ No se encontró chat-list-item para: ${phoneNumber}`);
    return;
  }

  // 2) Buscar o crear un contenedor para las etiquetas
  let tagsContainer = chatItem.querySelector('.chat-list-tag-container');
  if (!tagsContainer) {
    console.log('Creando contenedor de etiquetas para el chat item');
    tagsContainer = document.createElement('div');
    tagsContainer.className = 'chat-list-tag-container';
    chatItem.appendChild(tagsContainer);
  }

  // 3) Limpiar y re-pintar
  tagsContainer.innerHTML = '';

  // Si assignedTags es un array, proceder
  if (Array.isArray(assignedTags)) {
    // Filtrar solo las activas
    const activeTags = assignedTags.filter(tag => tag.activo);
    console.log(`Renderizando ${activeTags.length} etiquetas activas`);

    activeTags.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'chat-list-tag';
      badge.style.backgroundColor = tag.color;
      badge.textContent = tag.nombre;
      tagsContainer.appendChild(badge);
      console.log(`Añadida etiqueta: ${tag.nombre}`);
    });
  } else {
    console.error('assignedTags no es un array:', assignedTags);
  }
}

// Asegurar que sea global
window.updateChatItemTags = updateChatItemTags;

/*******************************************************
 * 3.2. Esta función era tu "segunda versión" de updateChatItemTags
 *     La renombramos a "updateChatItemTagsFromServer" para no chocar con la otra.
 *     (Así NO quitamos líneas; solo cambiamos el nombre para que compile).
 *******************************************************/
async function updateChatItemTagsFromServer(phoneNumber, payload) {
  // 1) Encontrar el .chat-list-item correspondiente
  const item = document.querySelector(`.chat-list-item[data-phone-number="${phoneNumber}"]`);
  if (!item) return; // Ese chat no está en pantalla

  // 2) Si en el payload tienes assignedTags, puedes usarlas directamente:
  //    const assignedTags = payload.assignedTags || [];
  //    O si no, vuelves a hacer fetch:
  try {
    const resp = await fetchWithAuth(`/api/chat/etiquetas/${phoneNumber}`);
    if (!resp.ok) throw new Error('Error al cargar etiquetas del chat');
    const chatTags = await resp.json();
    const assigned = chatTags.filter(t => t.activo);

    // 3) Buscar o crear un contenedor donde mostrar las mini-etiquetas
    let tagsContainer = item.querySelector('.some-tags-container');
    if (!tagsContainer) {
      // Crea un div con la clase .some-tags-container
      // si en tu HTML actual no existe un contenedor
      tagsContainer = document.createElement('div');
      tagsContainer.className = 'some-tags-container';
      item.appendChild(tagsContainer);
    }

    // 4) Limpiar y re-pintar
    tagsContainer.innerHTML = '';
    assigned.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'chat-list-tag';
      badge.textContent = tag.nombre;
      badge.style.backgroundColor = tag.color;
      tagsContainer.appendChild(badge);
    });

  } catch (err) {
    console.error('Error actualizando chat-list item con tags:', err);
  }
}

/*******************************************************
 * 4. Función auxiliar para actualizar la lista de chats
 *******************************************************/
async function updateChatList() {
  const chatList = document.getElementById('chatList');
  if (!chatList) return;

  const searchBox = chatList.querySelector('.search-box');
  chatList.innerHTML = '';
  if (searchBox) chatList.appendChild(searchBox);

  try {
    const response = await fetch('/chat-list', {
      headers: {
        'Authorization': `Bearer ${sessionStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error('Error al cargar la lista de chats');
    const chats = await response.json();
    for (const chat of chats) {
      const chatItem = await createChatListItem(chat); // asumes que la tienes en otro archivo
      if (chatItem) chatList.appendChild(chatItem);
    }
  } catch (error) {
    console.error('Error al actualizar lista de chats:', error);
    showError('Error al cargar la lista de chats');
  }
}

/*******************************************************
 * 5. Función para establecer el número de teléfono actual
 *******************************************************/
function setCurrentPhoneNumber(phoneNumber) {
  window.currentPhoneNumber = phoneNumber;
  console.log('Número de teléfono actualizado en tags.js:', window.currentPhoneNumber);
  if (!window.currentPhoneNumber) {
    console.error('Error: No se pudo establecer el número de teléfono');
    return;
  }
  // Deshabilitar/bloquear botones si no hay phoneNumber
  const buttons = ['messageInput', 'sendButton', 'scheduleButton', 'noteButton', 'uploadButton'];
  buttons.forEach(id => {
    const element = document.getElementById(id);
    if (element) element.disabled = !phoneNumber;
  });
}

/*******************************************************
 * 6. Función para cargar etiquetas (actualiza header y modal)
 *******************************************************/
async function loadTags(skipChatListUpdate = false) {
  try {
    if (!window.currentPhoneNumber) return;
    const token = sessionStorage.getItem('token');
    if (!token) throw new Error('No se encontró token de autenticación');

    const [availableTagsResponse, assignedTagsResponse] = await Promise.all([
      fetch('/api/etiquetas', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }),
      fetch(`/api/chat/etiquetas/${window.currentPhoneNumber}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
    ]);
    if (!availableTagsResponse.ok || !assignedTagsResponse.ok) {
      throw new Error('Error al obtener etiquetas');
    }
    const [allTags, chatTags] = await Promise.all([
      availableTagsResponse.json(),
      assignedTagsResponse.json()
    ]);

    // Actualizar etiquetas en el header
    const header = document.getElementById('chatHeader');
    if (header) {
      let headerContent = header.querySelector('.header-content');
      let tagsContainer = headerContent ? headerContent.querySelector('.chat-tags') : null;
      if (!headerContent) {
        headerContent = document.createElement('div');
        headerContent.className = 'header-content';
        header.appendChild(headerContent);
      }
      if (!tagsContainer) {
        tagsContainer = document.createElement('div');
        tagsContainer.className = 'chat-tags';
        headerContent.appendChild(tagsContainer);
      }
      tagsContainer.innerHTML = '';
      const assignedTagsForHeader = chatTags.filter(tag => tag.activo)
        .sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));
      assignedTagsForHeader.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'tag';
        tagElement.style.backgroundColor = tag.color;
        tagElement.textContent = tag.nombre;
        tagsContainer.appendChild(tagElement);
      });
    }

    // Actualizar el modal si está visible
    const modal = document.getElementById('tagModal');
    if (modal && modal.style.display === 'block') {
      const availableList = document.getElementById('availableTagsList');
      const assignedList = document.getElementById('assignedTagsList');
      if (availableList && assignedList) {
        availableList.innerHTML = '';
        assignedList.innerHTML = '';
        const sortedTags = allTags.sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));
        sortedTags.forEach(tag => {
          // Usar "activo" para saber si la etiqueta está asignada al chat
          const isAssigned = chatTags.some(chatTag => chatTag.id === tag.id && chatTag.activo);
          const tagElement = createTagElement(tag, isAssigned);
          if (isAssigned) {
            assignedList.appendChild(tagElement);
          } else {
            availableList.appendChild(tagElement);
          }
        });
      }
    }

    if (!skipChatListUpdate) {
      // await updateChatList(); // si deseas actualizar la lista de chats
    }

    const existingMenu = header ? header.querySelector('.menu-container') : null;
    if (existingMenu && header && !header.contains(existingMenu)) {
      header.appendChild(existingMenu);
    }
  } catch (error) {
    console.error('Error en loadTags:', error);
    showError('Error al cargar las etiquetas');
  }
}

/*******************************************************
 * 7. Función para alternar la visibilidad del modal de etiquetas
 *******************************************************/
function toggleTagModal() {
  const modal = document.getElementById('tagModal');
  if (!modal) {
    console.error('Modal de etiquetas no encontrado');
    return;
  }
  if (!window.currentPhoneNumber) {
    showError('Primero selecciona un chat');
    return;
  }
  if (modal.style.display === 'block') {
    modal.style.display = 'none';
  } else {
    modal.style.display = 'block';
    initTagForm(); // Inicializa el formulario cada vez que se abre
    loadTags().catch(error => {
      console.error('Error al cargar etiquetas:', error);
      showError('Error al cargar las etiquetas');
    });
  }
}

/*******************************************************
 * 7 (opcional). Función para renderizar etiquetas asignadas en un contenedor
 *******************************************************/
function renderTags(tags, container) {
  container.innerHTML = '';
  if (tags && tags.length > 0) {
    const assignedTags = tags.filter(tag => tag.activo);
    assignedTags.forEach(tag => {
      const tagElement = document.createElement('span');
      tagElement.className = 'tag';
      tagElement.style.backgroundColor = tag.color;
      tagElement.textContent = tag.nombre;
      container.appendChild(tagElement);
    });
  }
}

/*******************************************************
 * 8. Función para manejar la creación de una nueva etiqueta (botón Agregar Etiqueta)
 *******************************************************/
async function handleNewTag(e) {
  if (e) e.preventDefault();

  const nameInput = document.getElementById('newTagName');
  const colorInput = document.getElementById('newTagColor');
  if (!nameInput || !colorInput) {
    console.error('Elementos del formulario no encontrados');
    return;
  }

  const name = nameInput.value.trim();
  const color = colorInput.value;
  if (!name) {
    showError('El nombre de la etiqueta es requerido');
    return;
  }

  try {
    const token = sessionStorage.getItem('token');
    const response = await fetch('/api/etiquetas', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        nombre: name,
        color: color,
        descripcion: '',
        prioridad: 0
      })
    });

    if (!response.ok) {
      // intenta leer detalle de error del backend
      let msg = 'Respuesta no OK';
      try {
        const err = await response.json();
        if (err && err.message) msg = err.message;
      } catch (_) { }
      throw new Error('Error al crear la etiqueta: ' + msg);
    }

    // 1) Limpiar formulario
    nameInput.value = '';
    colorInput.value = '#FFD700';

    // 2) Mostrar mensaje de éxito (y limpiar anteriores)
    const modal = document.getElementById('tagModal') || document.body;
    modal.querySelectorAll('.success-message').forEach(el => el.remove());
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = 'Etiqueta creada correctamente';
    modal.appendChild(successDiv);
    setTimeout(() => successDiv.remove(), 3000);

    // 3) Intentar refrescar el catálogo del modal (si hay funciones de UI)
    try {
      const resAll = await fetch('/api/etiquetas', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resAll.ok) {
        const allTags = await resAll.json();
        // Si tu modal tiene una función para re-renderizar el catálogo, úsala:
        if (typeof updateTagModalCatalog === 'function') {
          updateTagModalCatalog(allTags);
        } else if (typeof updateTagModal === 'function') {
          // Si solo tienes updateTagModal(assignedTags), pásale arreglo vacío
          updateTagModal([]); // mantiene disponibles = allTags internamente si lo usas así
        }
      }
    } catch (e2) {
      console.warn('No se pudo refrescar catálogo local de etiquetas:', e2);
    }

    // 4) Notificar globalmente que el catálogo de etiquetas cambió
    window.dispatchEvent(new CustomEvent('tagCatalogUpdated', { detail: {} }));
    // (Opcional) Si quieres que se recargue la lista completa de chats/tablas:
    window.dispatchEvent(new CustomEvent('tagsUpdated', { detail: { phoneNumber: null } }));

  } catch (error) {
    console.error('Error:', error);
    showError('Error al crear la etiqueta: ' + error.message);
  }
}

/*******************************************************
 * 9. Función para alternar la asignación (o desasignación) de una etiqueta a un chat
 *******************************************************/

async function toggleTagAssignment(tagId) {
  if (!window.currentPhoneNumber) {
    console.error('No hay número de teléfono seleccionado');
    return;
  }

  console.log(`Modificando etiqueta ${tagId} para ${window.currentPhoneNumber}`);

  try {
    // Dar feedback visual inmediato
    const tagElement = document.querySelector(`.tag-item[data-tag-id="${tagId}"]`);
    if (tagElement) {
      tagElement.style.opacity = '0.5'; // Indicación visual
    }

    const token = sessionStorage.getItem('token');
    if (!token) throw new Error('No hay token de autenticación');

    const response = await fetch('/api/chat/etiqueta', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        numeroTelefono: window.currentPhoneNumber,
        etiquetaId: tagId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Error al modificar etiqueta');
    }

    // No necesitamos recargar los datos aquí, el socket se encargará
    console.log('Solicitud de modificación enviada correctamente');

  } catch (error) {
    console.error('Error al modificar etiqueta:', error);
    showError('Error al modificar etiqueta: ' + error.message);

    // Restaurar apariencia si hubo error
    const tagElement = document.querySelector(`.tag-item[data-tag-id="${tagId}"]`);
    if (tagElement) {
      tagElement.style.opacity = '1';
    }
  }
}

/*******************************************************
 * 10. Función para crear un elemento HTML de etiqueta (para el modal)
 *******************************************************/
const defaultTagIds = [1, 2, 3, 4, 5, 6];
function createTagElement(tag, isAssigned) {
  // Verificación mínima
  if (!tag || !tag.id || !tag.nombre || !tag.color) {
    console.error('Datos de etiqueta inválidos:', tag);
    const emptyDiv = document.createElement('div');
    emptyDiv.textContent = 'Etiqueta inválida';
    return emptyDiv;
  }

  // Contenedor principal
  const tagItem = document.createElement('div');
  tagItem.className = 'tag-item';
  tagItem.dataset.tagId = tag.id;

  // Insertamos color y nombre
  tagItem.innerHTML = `
    <span class="tag-color" style="background-color: ${tag.color};"></span>
    <span class="tag-name">${tag.nombre}</span>
  `;

  // Botón de Asignar/Quitar
  if (isAssigned) {
    // Está asignada al chat => botón "Quitar"
    const removeButton = document.createElement('button');
    removeButton.className = 'tag-action remove';
    removeButton.textContent = 'Quitar';
    removeButton.onclick = (e) => {
      e.stopPropagation();
      toggleTagAssignment(tag.id)
        .catch(err => {
          console.error('Error al quitar etiqueta:', err);
          showError('Error al quitar la etiqueta');
        });
    };
    tagItem.appendChild(removeButton);
  } else {
    // No está asignada => click en todo el tag para asignar
    tagItem.style.cursor = 'pointer';
    tagItem.onclick = () => {
      toggleTagAssignment(tag.id)
        .catch(err => {
          console.error('Error al asignar etiqueta:', err);
          showError('Error al asignar la etiqueta');
        });
    };
  }

  // Botón "X" de Borrar (solo si NO es predefinida)
  if (!defaultTagIds.includes(tag.id)) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tag-action delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Eliminar etiqueta';
    deleteBtn.style.marginLeft = '8px';
    deleteBtn.onclick = (e) => {
      e.stopPropagation(); // para que no dispare la asignación
      deleteTag(tag.id).catch(err => {
        console.error('Error al eliminar etiqueta:', err);
        showError('Error al eliminar etiqueta');
      });
    };
    tagItem.appendChild(deleteBtn);
  }

  return tagItem;
}

/*******************************************************
 * 11. Función opcional para crear una nueva etiqueta (otro flujo)
 *******************************************************/
async function createNewTag(tagData) {
  try {
    const token = sessionStorage.getItem('token');
    const response = await fetch('/api/etiquetas', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tagData)
    });
    if (!response.ok) {
      throw new Error('Error al crear etiqueta');
    }
    //await loadTags();
    return true;
  } catch (error) {
    console.error('Error al crear etiqueta:', error);
    showError('Error al crear la etiqueta');
    return false;
  }
}

/*******************************************************
 * 12. Función para inicializar el formulario del modal de etiquetas
 *******************************************************/
function initTagForm() {
  // Seleccionamos el formulario (un <form> con clase .tag-form)
  const form = document.querySelector('.tag-form');
  if (!form) {
    console.error('No se encontró el formulario de etiquetas');
    return;
  }
  // (Opcional) Reinicializar HTML interno
  form.innerHTML = `
    <div class="form-group">
      <input type="text" id="newTagName" class="modal-input" placeholder="Nombre de la etiqueta" required>
    </div>
    <div class="form-group">
      <input type="color" id="newTagColor" class="modal-input" value="#FFD700">
    </div>
    <button type="submit" class="modal-submit">Agregar Etiqueta</button>
  `;
  // Asignar evento submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleNewTag(e);
  });
}

/*******************************************************
 * 13. Función para inicializar el modal de etiquetas
 *******************************************************/
function initTagModal() {
  const modal = document.getElementById('tagModal');
  if (!modal) return;

  const closeBtn = modal.querySelector('.close');
  if (closeBtn) {
    closeBtn.onclick = closeTagModal;
  }

  window.onclick = (event) => {
    if (event.target === modal) {
      closeTagModal();
    }
  };
  initTagForm();
}

/*******************************************************
 * 14. Función "partialLoadChatTags" (Por si la llamas tras togglear)
 *******************************************************/
async function partialLoadChatTags(phoneNumber) {
  try {
    const resp = await fetchWithAuth(`/api/chat/etiquetas/${phoneNumber}`);
    if (!resp.ok) throw new Error('Error al obtener etiquetas actualizadas');
    const updatedTags = await resp.json();

    // Usa tu función updateTagsDisplay() para actualizar
    // solo la parte de etiquetas en el header:
    updateTagsDisplay(updatedTags);
  } catch (error) {
    console.error('Error en partialLoadChatTags:', error);
  }
}

/*******************************************************
 * 15. Función deleteTag (que se invoca al presionar "X")
 *******************************************************/
async function deleteTag(tagId) {
  try {
    const token = sessionStorage.getItem('token');
    const response = await fetch(`/api/etiquetas/${tagId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Error al eliminar etiqueta');
    }
    showSuccess('Etiqueta eliminada correctamente');
  } catch (error) {
    console.error('Error al eliminar etiqueta:', error);
    showError('Error al eliminar la etiqueta');
  }
}

/*******************************************************
 * 16. Función para actualizar el modal de etiquetas (NUEVA)
 *******************************************************/
function updateTagModal(assignedTags) {
  console.log('Actualizando modal de etiquetas con:', assignedTags);

  // Verificar si el modal está abierto
  const modal = document.getElementById('tagModal');
  if (!modal || modal.style.display !== 'block') return;

  // Obtener las listas de etiquetas
  const availableList = document.getElementById('availableTagsList');
  const assignedList = document.getElementById('assignedTagsList');
  if (!availableList || !assignedList) {
    console.error('No se encontraron las listas en el modal');
    return;
  }

  // Obtener todas las etiquetas disponibles
  const token = sessionStorage.getItem('token');
  if (!token) return;

  fetch('/api/etiquetas', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
    .then(response => response.json())
    .then(allTags => {
      // Limpiar las listas
      availableList.innerHTML = '';
      assignedList.innerHTML = '';

      // Ordenar las etiquetas
      const sortedTags = allTags.sort((a, b) => (a.prioridad || 0) - (b.prioridad || 0));

      // Para cada etiqueta, determinar si está asignada
      sortedTags.forEach(tag => {
        // Verificar si la etiqueta está en la lista de asignadas
        const isAssigned = assignedTags.some(t => t.id === tag.id && t.activo);

        // Crear el elemento de etiqueta
        const tagElement = createTagElement(tag, isAssigned);

        // Colocar en la lista correspondiente
        if (isAssigned) {
          assignedList.appendChild(tagElement);
        } else {
          availableList.appendChild(tagElement);
        }
      });
    })
    .catch(error => {
      console.error('Error al actualizar el modal de etiquetas:', error);
    });
}

// Exponer la función globalmente
window.updateTagModal = updateTagModal;

/* FIN DEL CÓDIGO COMPLETO */

