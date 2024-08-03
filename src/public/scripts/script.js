//=========================[VARIABLES]=========================//
const UserId = currentUserId;
const User = currentUsername;
const Avatar = avatarUrl;
const socket = io({ query: { currentUserId } });
let userNewPassword = '';

const confirmationToast = new bootstrap.Toast(document.getElementById('confirmationToast'));
const incommingCallToast = new bootstrap.Toast(document.getElementById('incommingCallToast'));
const callingToast = new bootstrap.Toast(document.getElementById('callingToast'));

let currentFriendId = '';
let currentRoom = '';
let currentFriendAvatar = '';
let friendToRemove = null;
let currentRoomPeerIds = '';


//=========================[USER FUNCTIONS]=========================//

socket.on('userStatusChanged', (data) => {
    const { userId, online, nickname, avatar } = data;
    const color = online ? '#198754' : '#c93c3e';

    if (userId) {
        $(`#friend-${userId}`).css('background', color);
    }

    if (nickname) {
        $(`#friend-nickname-${userId}`).text(nickname);
    }

    if (avatar) {
        $(`#friend-avatar-${userId}`).attr('src', avatar);
    }
});

document.addEventListener('DOMContentLoaded', function() {
    hideEmail();
    
});

function hideEmail() {
    const emailElement = document.getElementById('user-email');
    const email = emailElement.textContent;
    const [localPart, domain] = email.split('@');
    emailElement.textContent = '*'.repeat(localPart.length) + '@' + domain;
}

function toggleEdit(field) {
    const span = document.querySelector(`span.editable[data-field="${field}"]`);
    const input = document.querySelector(`input.editable-input[data-field="${field}"]`);
    const editButton = document.querySelector(`button.btn-edit[onclick="toggleEdit('${field}')"]`);
    const saveButton = document.querySelector(`button.btn-save[data-field="${field}"]`);

    // Verificar se os elementos foram encontrados
    if (span && input && editButton && saveButton) {
        if (input.style.display === 'none') {
            input.style.display = 'inline';
            span.style.display = 'none';
            editButton.style.display = 'none';
            saveButton.style.display = 'inline';
            input.focus();
        }
    } else {
        console.error(`Não foi possível encontrar os elementos para o campo "${field}".`);
    }
}

function openConfirmPasswordToast() {
    var toastEl = document.getElementById('confirmPasswordToast');
    var toast = new bootstrap.Toast(toastEl, {
        autohide: false // O toast não desaparecerá automaticamente
    });
    toast.show();
}

function openConfirmDeleteAccountToast() {
    var toastEl = document.getElementById('confirmDeleteAccountToast');
    var toast = new bootstrap.Toast(toastEl, {
        autohide: false // O toast não desaparecerá automaticamente
    });
    toast.show();
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        uploadAvatar(file);
    }
}

async function saveEdit(field) {
    if(field == 'delete')
        return openConfirmDeleteAccountToast();

    const span = document.querySelector(`span.editable[data-field="${field}"]`);
    const input = document.querySelector(`input.editable-input[data-field="${field}"]`);
    const editButton = document.querySelector(`button.btn-edit[onclick="toggleEdit('${field}')"]`);
    const saveButton = document.querySelector(`button.btn-save[data-field="${field}"]`);

    const newValue = input.value;

    // Atualizar o campo de acordo com o tipo
    switch (field) {
        case 'username':
            await updateUsername(currentUserId, newValue);
            break;
        case 'nickname':
            await updateNickname(currentUserId, newValue);
            break;
        case 'email':
            // Para email, você pode adicionar uma função semelhante se necessário
            await updateEmail(currentUserId, newValue);
            break;
        case 'password':
            if(newValue){
                userNewPassword = newValue;
                openConfirmPasswordToast();
            }
            break;
    }

    input.style.display = 'none';
    span.style.display = 'inline';
    editButton.style.display = 'inline';
    saveButton.style.display = 'none';
}

async function updateUsername(userId, newUsername) {
    try {
        const response = await fetch('/user/update-username', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId: userId, newUsername: newUsername })
        });

        const data = await response.json();

        if (response.ok) {
            if (data.success) {
                $('#user-username').text(newUsername);
                console.log("Nome de usuário atualizado com sucesso.");
            } else {
                console.error('Erro ao atualizar o nome de usuário:', data.error);
            }
        } else {
            $('#error-message-modal-username').text(data.error || 'Erro ao atualizar nome de usuário. Tente novamente.');
        }
    } catch (error) {
        $('#error-message-modal-username').text('Erro ao atualizar nome de usuário. Tente novamente.');
        console.error('Erro:', error);
    }
}

async function updateNickname(userId, newNickname) {
    try {
        const response = await fetch('/user/update-nickname', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId: userId, newNickname: newNickname }),
        });

        const data = await response.json();

        if (response.ok && data.success) {

            $('#user-nickname').text(newNickname);
            $('#avatar-user-nickname').text(newNickname);
            console.log("Nome de exibição atualizado com sucesso.");
            socket.emit('userChanges', userId, newNickname, null);
        } else {
            console.error('Erro ao atualizar o nome de exibição:', data.error);
        }
    } catch (error) {
        const errorMessage = error.message || 'Erro ao atualizar nome de exibição. Tente novamente.';
        document.getElementById('error-message-modal-nickname').textContent = errorMessage;
    }
}

async function uploadAvatar(file) {
    if (!file) {
        console.error('Nenhum arquivo selecionado.');
        return;
    }

    if (file.size > 8 * 1024 * 1024) {
        console.error('A imagem deve ter no máximo 8MB.');
        return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
        const response = await fetch('/user/upload-avatar', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log("Avatar atualizado com sucesso.");

            const newAvatarUrl = data.avatarUrl;
            $('#avatarImg').attr('src', newAvatarUrl);
            socket.emit('userChanges', currentUserId, null, newAvatarUrl);
        } else {
            console.error('Erro ao atualizar avatar:', data.error);
        }
    } catch (error) {
        console.error('Erro ao enviar requisição para atualizar avatar:', error);
    }
}

async function updateEmail(userId, newEmail) {
    try {
        const response = await fetch('/user/update-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId: userId, newEmail: newEmail }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
            $('#user-email').text(newEmail);
            console.log("E-mail atualizado com sucesso.");
            
        } else {
            console.error('Erro ao atualizar o e-mail:', data.error);
        }
    } catch (error) {
        const errorMessage = error.message || 'Erro ao atualizar o e-mail. Tente novamente.';
        document.getElementById('error-message-modal-email').textContent = errorMessage;
    }
}

async function deleteAccount(currentPassword) {
    try {
        const response = await fetch('/user/delete-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ currentPassword: currentPassword })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log("Conta deletada com sucesso.");
            // Redirecionar para a página de logout ou página inicial
            window.location.href = '/auth/logout';
        } else {
            console.error('Erro ao deletar a conta: ' + data.error);
        }
    } catch (error) {
        console.error('Erro ao deletar a conta:', error);
    }
}

async function updatePassword(newPassword) {
    try {
        const response = await fetch('/user/update-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ newPassword: newPassword })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log("Senha atualizada com sucesso.");
            document.getElementById('user-password').textContent = '********';
        } else {
            console.error('Erro ao atualizar a senha: ' + data.error);
        }
    } catch (error) {
        console.error('Erro ao atualizar senha:', error);
    }
}


async function verifyCurrentPassword(isDeleteAccount) {
    const currentPassword = isDeleteAccount 
        ? document.getElementById('currentDeletePassword').value 
        : document.getElementById('currentPassword').value;

    try {
        const response = await fetch('/user/verify-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ currentPassword: currentPassword })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            const toastEl = isDeleteAccount 
                ? document.getElementById('confirmDeleteAccountToast')
                : document.getElementById('confirmPasswordToast');
            const toast = bootstrap.Toast.getInstance(toastEl);
            toast.hide();

            if (isDeleteAccount) {
                await deleteAccount(currentPassword);
            } else {
                await updatePassword(userNewPassword);
            }
        } else {
            alert('Senha atual incorreta.');
        }
    } catch (error) {
        alert('Erro ao verificar a senha atual. Tente novamente.');
        console.error('Erro:', error);
    }
}

//=========================[MESSAGE FUNCTIONS]=========================//

async function joinRoom(friendUsername, friendNickname, friendId, friendPeerId, friendAvatarUrl) {
    try {
        currentFriendId = friendId;
        currentFriendPeerId = friendPeerId;
        currentRoom = [UserId, currentFriendId].sort().join('_');

        socket.emit('joinRoom', currentRoom);

        $('#chatContent').empty(); 

        document.title = `Cubic | ${friendNickname}`;

        showChatTitle(friendUsername, friendAvatarUrl);

        await loadMessages(friendId, friendUsername, friendNickname, friendAvatarUrl);
    } catch (error) {
        console.error('Erro ao entrar na sala:', error);
    }
}

async function loadMessages(friendId, friendUsername, friendNickname, friendAvatar) {
    try {
        // Enviar requisição para obter mensagens
        const response = await fetch(`/messages/${currentUserId}/${friendId}`, {
            method: 'GET'
        });

        // Verificar se a resposta foi bem-sucedida
        if (!response.ok) {
            throw new Error('Erro ao carregar as mensagens.');
        }

        // Processar a resposta como JSON
        const data = await response.json();
        const chatContent = document.getElementById('chatContent');
        const shouldScrollToBottom = isChatScrolledToBottom(); // Verificar se o chat está rolado para baixo

        // Limpar o conteúdo do chat
        chatContent.innerHTML = '';

        if (data.messages && data.messages.length > 0) {
            let previousSenderId = null;
            let consecutiveMessagesCount = 0;

            data.messages.forEach((message) => {
                const senderAvatar = message.sender === currentUserId ? avatarUrl : friendAvatar.replace(/\\/g, '/');
                const formattedTimestamp = formatTimestamp(message.timestamp);

                // Verificar se o remetente da mensagem atual é o mesmo do anterior
                const sameSenderAsPrevious = message.sender === previousSenderId;

                // Verificar se precisamos iniciar um novo grupo de mensagens
                if (!sameSenderAsPrevious || consecutiveMessagesCount >= 15) {
                    // Se tivemos um remetente anterior e atingimos o limite de mensagens consecutivas, fechar o grupo anterior
                    if (previousSenderId !== null && consecutiveMessagesCount >= 15) {
                        chatContent.innerHTML += '</div>'; // Fechar o grupo anterior
                    }

                    // Iniciar um novo grupo de mensagens
                    chatContent.innerHTML += '<div class="message-container">';
                    consecutiveMessagesCount = 0;
                }

                // Preparar o HTML da mensagem
                const messageHtml = `
                    <div class="${!sameSenderAsPrevious ? 'message' : 'message-conc'}">
                        ${!sameSenderAsPrevious ? `<img src="${senderAvatar}" alt="${message.sender === currentUserId ? currentUsername : friendUsername}">` : ''}
                        <div>
                            ${!sameSenderAsPrevious ? `<span class="user">${message.sender === currentUserId ? currentNickname : friendNickname}</span> <a class="message-time">${formattedTimestamp}</a>` : ''}
                            <span class="text">${message.message}</span>
                        </div>
                    </div>
                `;

                // Adicionar o HTML da mensagem ao chat
                chatContent.innerHTML += messageHtml;

                // Incrementar o contador de mensagens consecutivas
                consecutiveMessagesCount++;

                // Atualizar previousSenderId para a próxima iteração
                previousSenderId = message.sender;
            });

            // Fechar o grupo final de mensagens, se necessário
            if (previousSenderId !== null && consecutiveMessagesCount >= 15) {
                chatContent.innerHTML += '</div>'; // Fechar o grupo final
            }
        } else {
            chatContent.innerHTML += '<p class="text-center">Não há nada por aqui até o momento...</p>';
        }

        // Rolar para o fundo se o chat estava rolado para baixo antes de carregar mensagens
        if (shouldScrollToBottom) {
            scrollToBottom();
        }
    } catch (error) {
        console.error('Erro ao carregar as mensagens:', error.message);
    }
}

async function sendMessage(senderId, receiverId, message) {
    try {
        const response = await fetch('/messages/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ senderId, receiverId, message })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Erro ao enviar a mensagem.');
        }

        return data;
    } catch (error) {
        console.error('Erro AJAX:', error.message);
        throw error;
    }
}

socket.on('receiveMessage', function (data) {
    const { user, userAvatar, message, room } = data;
    const chatContent = $('#chatContent');
    const shouldScrollToBottom = isChatScrolledToBottom();

    // Verificar se a mensagem é para a sala atual
    if (room !== currentRoom) {
        return; // Não exibir mensagem se não estiver na sala correta
    }

    let lastMessageContainer = chatContent.children('.message-container').last();

    if (lastMessageContainer.length > 0) {
        const lastMessage = lastMessageContainer.find('.message').last();
        const lastSender = lastMessage.find('.user').text();

        if (lastSender === user && !lastMessageContainer.hasClass('initial-load')) {
            lastMessageContainer.append(`
                <div class="message-conc">
                    <div>
                        <span class="text">${message}</span>
                    </div>
                </div>
            `);
        } else {
            const senderAvatar = message.sender === currentUserId ? avatarUrl : userAvatar.replace(/\\/g, '/');
            chatContent.append(`
                <div class="message-container">
                    <div class="message">
                        <img src="${senderAvatar}" alt="${user}">
                        <div>
                            <span class="user">${user}</span>
                            <span class="text">${message}</span>
                        </div>
                    </div>
                </div>
            `);
        }
    } else {
        chatContent.append(`
            <div class="message-container initial-load">
                <div class="message">
                    <img src="${userAvatar}" alt="${user}">
                    <div>
                        <span class="user">${user}</span>
                        <span class="text">${message}</span>
                    </div>
                </div>
            </div>
        `);
    }

    if (shouldScrollToBottom) {
        scrollToBottom();
    }
});


document.getElementById('messageInput').addEventListener('keypress', async function (e) {
    if (e.key === 'Enter' && this.value.trim() !== '') {
        const message = this.value.trim();

        if (message.length > 2000) {
            showToast('characterLimitToast');
            return;
        }

        socket.emit('sendMessage', { user: User, userAvatar: Avatar, room: currentRoom, message });

        try {
            const data = await sendMessage(UserId, currentFriendId, message);

            if (data.success) {
                console.log('Mensagem enviada com sucesso!');
            }
        } catch (error) {
            // Error handling is already done in sendMessage function
        }

        this.value = '';
    }
});

function showToast(messageId) {
    const toastElement = document.getElementById(messageId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();
}

function formatTimestamp(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);

    const isToday = now.toDateString() === date.toDateString();
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; 
    const time = `${hours.toString().padStart(2, '0')}:${minutes} ${period}`;

    if (isToday) {
        return `Hoje às ${time}`;
    } else if (isYesterday) {
        return `Ontem às ${time}`;
    } else {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); 
        const year = date.getFullYear();
        return `${day}/${month}/${year} às ${time}`;
    }
}

function isChatScrolledToBottom() {
    const chatContent = $('#chatContent');
    return chatContent.prop('scrollHeight') - chatContent.scrollTop() === chatContent.outerHeight();
}

function scrollToBottom() {
    const chatContent = $('#chatContent');
    chatContent.scrollTop(chatContent.prop('scrollHeight'));
}

function showChatTitle(friendUsername, friendAvatar) {
    const chatTitle = document.getElementById('chatTitle');
    const chatAvatar = document.getElementById('chatAvatar');
    const chatUsername = document.getElementById('chatUsername');
    const callButtons = document.getElementById('callButtons');

    chatAvatar.src = friendAvatar;

    chatUsername.textContent = friendUsername;

    chatTitle.style.display = 'flex';
    callButtons.style.display = 'flex';
}
//=========================[FRIENDS FUNCTIONS]=========================//

const friendsDropdown = document.getElementById('friendsDropdown');

    if (friendsDropdown) {
        friendsDropdown.addEventListener('click', () => {
            loadFriendsDropup();
            loadRequests();
            loadReceivedRequests();
        });
    }

async function loadFriendsDropup() {
    try {
        const response = await fetch('/friends/load-friends');
        const data = await response.json();

        if (response.ok) {
            displayFriends(data.friends);
        } else {
            console.error('Erro ao carregar amigos:', data.error);
        }
    } catch (error) {
        console.error('Erro ao carregar amigos:', error);
    }
}

function displayFriends(friends) {
    const friendList = document.getElementById('friend-list');
    friendList.innerHTML = '';

    friends.forEach(friend => {
        const friendItem = document.createElement('div');
        friendItem.className = 'friend-item';

        const friendInfo = document.createElement('div');
        friendInfo.className = 'friend-info';

        const avatar = document.createElement('img');
        avatar.className = 'friend-avatar';
        avatar.src = friend.avatarUrl;
        avatar.alt = 'Avatar';

        const nickname = document.createElement('span');
        nickname.className = 'friend-nickname';
        nickname.innerText = friend.nickname;

        const username = document.createElement('span');
        username.className = 'friend-username';
        username.innerText = ` • ${friend.username}`;

        friendInfo.appendChild(avatar);
        friendInfo.appendChild(nickname);
        friendInfo.appendChild(username);

        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-delete';
        removeButton.innerText = 'Remover';
        removeButton.onclick = () => removeFriendDropup(friend._id);

        friendItem.appendChild(friendInfo);
        friendItem.appendChild(removeButton);

        friendList.appendChild(friendItem);
    });
}

async function removeFriendDropup(friendId) {
    if (confirm('Tem certeza de que deseja remover este amigo?')) {
        try {
            const response = await fetch(`/friends/remove/${friendId}`, { method: 'DELETE' });
            const data = await response.json();

            if (response.ok) {
                loadFriendsDropup();
            } else {
                console.error('Erro ao remover amigo:', data.error);
            }
        } catch (error) {
            console.error('Erro ao remover amigo:', error);
        }
    }
}


//REQUESTS
async function addFriend() {
    const username = document.getElementById('friend-username').value;
    const errorMessageElement = document.getElementById('error-message');
    errorMessageElement.textContent = '';

    if (!username) {
        errorMessageElement.textContent = 'Por favor, insira um nome de usuário.';
        return;
    }

    try {
        const response = await fetch('/friends/add-friend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendName: username })
        });
        const data = await response.json();

        if (response.ok) {
            loadRequests();
            alert('Solicitação de amizade enviada.');
        } else {
            errorMessageElement.textContent = data.error || 'Erro ao adicionar amigo.';
            console.error('Erro ao adicionar amigo:', data.error);
        }
    } catch (error) {
        errorMessageElement.textContent = 'Erro ao adicionar amigo. Tente novamente mais tarde.';
        console.error('Erro ao adicionar amigo:', error);
    }
}

async function loadRequests() {
    try {
        const response = await fetch('/friends/load-requests');
        const data = await response.json();

        if (response.ok) {
            displayRequests(data.requests);
        } else {
            console.error('Erro ao carregar solicitações:', data.error);
        }
    } catch (error) {
        console.error('Erro ao carregar solicitações:', error);
    }
}

async function loadReceivedRequests() {
    try {
        const response = await fetch('/friends/friend-list');
        const data = await response.json();

        if (response.ok) {
            displayReceivedRequests(data.friendRequests);
        } else {
            console.error('Erro ao carregar solicitações recebidas:', data.error);
        }
    } catch (error) {
        console.error('Erro ao carregar solicitações recebidas:', error);
    }
}

function displayRequests(requests) {
    const requestList = document.getElementById('request-list');
    requestList.innerHTML = '';

    requests.forEach(request => {
        const requestItem = document.createElement('div');
        requestItem.className = 'request-item';

        const requestInfo = document.createElement('div');
        let statusClass;
        let statusText;
        if (request.status === 'accepted') {
            statusClass = 'status-accepted';
            statusText = 'Aceito';
        } else if (request.status === 'pending') {
            statusClass = 'status-pending';
            statusText = 'Pendente';
        } else if (request.status === 'declined') {
            statusClass = 'status-declined';
            statusText = 'Negado';
        }
        requestInfo.innerHTML = `Usuário: ${request.recipient.username} • Status: <span class="${statusClass}">${statusText}</span>`;

        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-delete';
        removeButton.innerText = 'Remover';
        removeButton.onclick = () => removeRequest(request._id);

        requestItem.appendChild(requestInfo);
        requestItem.appendChild(removeButton);

        requestList.appendChild(requestItem);
    });
}

function displayReceivedRequests(friendRequests) {
    const receivedRequestList = document.getElementById('received-request-list');
    receivedRequestList.innerHTML = '';

    friendRequests.forEach(request => {
        const requestItem = document.createElement('div');
        requestItem.className = 'request-item';

        const requestInfo = document.createElement('div');
        requestInfo.innerHTML = `De: ${request.requester.username}`;

        const requestButtons = document.createElement('div');
        requestButtons.className = 'request-buttons';

        const acceptButton = document.createElement('button');
        acceptButton.className = 'btn btn-save';
        acceptButton.innerText = 'Aceitar';
        acceptButton.onclick = () => respondRequest(request._id, 'accept');

        const rejectButton = document.createElement('button');
        rejectButton.className = 'btn btn-delete';
        rejectButton.innerText = 'Recusar';
        rejectButton.onclick = () => respondRequest(request._id, 'reject');

        requestButtons.appendChild(acceptButton);
        requestButtons.appendChild(rejectButton);

        requestItem.appendChild(requestInfo);
        requestItem.appendChild(requestButtons);

        receivedRequestList.appendChild(requestItem);
    });
}

async function respondRequest(requestId, action) {
    try {
        const response = await fetch('/friends/respond-friend-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requestId, action })
        });
        const data = await response.json();

        if (response.ok) {
            loadReceivedRequests();
            alert(`Solicitação de amizade ${action === 'accept' ? 'aceita' : 'recusada'}.`);
        } else {
            console.error('Erro ao responder solicitação:', data.error);
        }
    } catch (error) {
        console.error('Erro ao responder solicitação:', error);
    }
}

async function removeRequest(requestId) {
    if (confirm('Tem certeza de que deseja remover esta solicitação de amizade?')) {
        try {
            const response = await fetch(`/friends/remove-request/${requestId}`, { method: 'DELETE' });
            const data = await response.json();

            if (response.ok) {
                loadRequests();
            } else {
                console.error('Erro ao remover solicitação:', data.error);
            }
        } catch (error) {
            console.error('Erro ao remover solicitação:', error);
        }
    }
}

function RemoveFriend(friendId) {
    friendToRemove = friendId;
    confirmationToast.show();
}

async function removeFriend(friendId) {
    try {
        const response = await fetch(`/friends/remove/${friendId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.success) {
            const friendItem = document.querySelector(`li[data-friend-id="${friendId}"]`);
            if (friendItem) {
                friendItem.remove();
            }

            if (confirmationToast) {
                confirmationToast.hide();
            }
        } else {
            console.error('Erro ao remover amigo:', data.error);
        }
    } catch (error) {
        console.error('Erro ao remover amigo:', error);
    }
}


async function loadFriends() {
    try {
        const response = await fetch('/friends/load-friends', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error('Erro na resposta da rede');
        }

        const data = await response.json();
        const friendsList = document.getElementById('friendsList');
        const currentFriends = {};

        // Obter os amigos atualmente renderizados
        Array.from(friendsList.children).forEach((li) => {
            const friendName = li.querySelector('a').dataset.friendName;
            currentFriends[friendName] = li;
        });

        // Verificar e adicionar novos amigos
        if (data.friends && data.friends.length > 0) {
            const newFriends = {};
            data.friends.forEach(friend => {
                newFriends[friend.username] = true;
                if (!currentFriends[friend.username]) {
                    const formattedAvatarUrl = friend.avatarUrl.replace(/\\/g, '/');
                    const backgroundColor = friend.online ? "#198754" : "#c93c3e";
                    friendsList.insertAdjacentHTML('beforeend', `
                        <li class="list-group-item d-flex justify-content-between align-items-center" data-friend-id="${friend._id}" data-friend-peerid="${friend.peerid}">
                            <a onclick="joinRoom('${friend.username}', '${friend.nickname}', '${friend._id}', '${friend.peerid}', '${formattedAvatarUrl}');" class="d-flex align-items-center" data-friend-name="${friend.username}">
                                <div class='c-avatar'>
                                    <img id="friend-avatar-${friend._id}" src="${friend.avatarUrl}" alt="${friend.username}" class="c-friend_avatar_image me-2">
                                    <span id="friend-${friend._id}" class='c-friend_avatar_status' style='background: ${backgroundColor};'></span>
                                </div>
                                <span id="friend-nickname-${friend._id}">${friend.nickname}</span>
                            </a>
                            <a onclick="RemoveFriend('${friend._id}');" class="remove-friend"><i class="fa-solid fa-xmark"></i></a>
                        </li>
                    `);
                }
            });

            // Remover amigos que não estão mais na lista
            for (const friendName in currentFriends) {
                if (!newFriends[friendName]) {
                    currentFriends[friendName].remove();
                }
            }
        } else {
            // Se não há amigos, limpar a lista e mostrar mensagem
            friendsList.innerHTML = '<li class="list-group-item text-center">Nenhum amigo encontrado.</li>';
        }
    } catch (error) {
        console.error('Erro ao carregar a lista de amigos:', error.message);
    }
}

$('#modalFriendRequests').on('show.bs.modal', function () {
    loadFriendRequests();
});

$(document).on('click', '.accept-friend-request', function () {
    const requestId = $(this).data('request-id');
    respondToFriendRequest(requestId, 'accept');
});

$(document).on('click', '.decline-friend-request', function () {
    const requestId = $(this).data('request-id');
    respondToFriendRequest(requestId, 'decline');
});

$('#modalFriendAdd form').on('submit', function (e) {
    e.preventDefault();
    const friendName = $('#newFriend').val();

    if (friendName === '') {
        $('#error-message-modal-username').text('Usuário não encontrado.');
    } else {
        $('#error-message-modal-username').text('');
        addFriend(friendName);
    }
});

document.getElementById('confirmRemove').addEventListener('click', function() {
    if (friendToRemove) {
        removeFriend(friendToRemove);
    }
});

//=========================[VOICE CHAT FUNCTIONS]=========================//

var peer = new Peer();

async function updatePeerId(userId, peerId) {
    try {
        const response = await fetch('/user/update-peerid', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId, peerid: peerId })
        });

        if (!response.ok) {
            throw new Error('Erro na resposta da rede');
        }

        const data = await response.json();

        if (data.success) {
            console.log("PeerId atualizado!");
        } else {
            console.log("Ocorreu um erro ao atualizar o PeerId: " + data.error);
        }
    } catch (error) {
        console.error('Erro ao atualizar o PeerID:', error.message);
    }
}

peer.on('open', function(id) {
    console.log('My peer ID is: ' + id);
    updatePeerId(currentUserId, id);
});


async function initializeCall() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        let currentCall = null;
        let remoteAudioElement = null;
        const localStream = stream;
        let isMuted = false;
        let isDeafened = false;

        peer.on('call', handleIncomingCall);
        document.getElementById('audioCallButton').addEventListener('click', initiateCall);
        document.getElementById('endCallButton').onclick = endCall;
        document.getElementById('muteButton').addEventListener('click', toggleMute);
        document.getElementById('headphoneButton').addEventListener('click', toggleDeafen);

        function handleIncomingCall(call) {
            currentCall = call;
            incommingCallToast.show();
            document.getElementById('callerUsername').innerText = call.metadata.callerUsername;

            document.getElementById('acceptCallButton').onclick = () => {
                incommingCallToast.hide();
                call.answer(localStream);
                setupCallEventHandlers(call);
            };

            document.getElementById('rejectCallButton').onclick = () => {
                incommingCallToast.hide();
                call.close();
            };
        }

        function initiateCall() {
            $.ajax({
                url: `/friends/friend-data/${currentFriendId}`,
                method: 'GET',
                success: (data) => {
                    if (data.friend) {
                        const friend = data.friend;

                        if (!friend.online) {
                            return showErrorToast("O seu amigo está offline, portanto não pode receber chamadas.");
                        }

                        document.getElementById('calleeUsername').innerText = friend.username;
                        callingToast.show();

                        console.log('Calling peer ID: ' + friend.peerid);

                        const call = peer.call(friend.peerid, localStream, {
                            metadata: { callerUsername: currentUsername }
                        });

                        currentCall = call;
                        setupCallEventHandlers(call);
                    } else {
                        showErrorToast('Dados do amigo não encontrado.');
                    }
                },
                error: (jqXHR) => {
                    const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Dados do amigo não encontrados.';
                    showErrorToast(errorMessage);
                }
            });
        }

        function setupCallEventHandlers(call) {
            call.on('stream', (remoteStream) => {
                remoteAudioElement = new Audio();
                remoteAudioElement.srcObject = remoteStream;
                remoteAudioElement.play();

                if (isDeafened) {
                    remoteAudioElement.muted = true;
                }

                toggleCallButtons(true);
                callingToast.hide();
            });

            call.on('close', () => {
                callingToast.hide();
                showErrorToast('Chamada encerrada.');
                toggleCallButtons(false);
            });

            document.getElementById('rejectCallButton').onclick = () => {
                callingToast.hide();
                call.close();
            };
        }

        socket.on('disconnect', function() {
            endCall();
        });

        function endCall() {
            callingToast.hide();

            if (currentCall) {
                currentCall.close();
                currentCall = null;

                toggleCallButtons(false);
                showErrorToast('Chamada encerrada.');
            } else {
                toggleCallButtons(false);
                showErrorToast('Nenhuma chamada ativa para encerrar.');
            }
        }

        function toggleCallButtons(show) 
        {
            if(!show) 
            {
                document.getElementById('headphoneButton').style.display = 'none';
                document.getElementById('muteButton').style.display = 'none';
                document.getElementById('endCallButton').style.display = 'none';
            } else {
                document.getElementById('headphoneButton').style.display = 'flex';
                document.getElementById('muteButton').style.display = 'flex';
                document.getElementById('endCallButton').style.display = 'flex';
            }
        }

        function toggleMute() {
            const icon = document.getElementById('muteButton').querySelector('i');
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                isMuted = !isMuted;
                audioTrack.enabled = !isMuted;

                if (isMuted) {
                    icon.classList.remove('fa-microphone');
                    icon.classList.add('fa-microphone-slash');
                    icon.style.color = '#FF6347';
                } else {
                    icon.classList.remove('fa-microphone-slash');
                    icon.classList.add('fa-microphone');
                    icon.style.color = 'white';
                }
            }
        }

        function toggleDeafen() {
            const icon = document.getElementById('headphoneButton').querySelector('i');
            isDeafened = !isDeafened;
        
            if (remoteAudioElement) {
                remoteAudioElement.muted = isDeafened;
            }
        
            if (isDeafened) {
                icon.style.color = '#FF6347';
            } else {
                icon.style.color = 'white';
            }
        }        

    } catch (err) {
        showErrorToast('Failed to get local stream', err);
    }
}

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    initializeCall();
} else {
    showErrorToast('Seu navegador não suporta a API getUserMedia.');
}

function showErrorToast(messageError) {
    const toastElement = document.getElementById('errorToast');
    const toastBody = toastElement.querySelector('.toast-body');
    
    toastBody.textContent = messageError;
    
    const toast = new bootstrap.Toast(toastElement);
    
    toast.show();
}

//=========================[TIMERS]=========================//
$(document).ready(function () {
    const CHECK_INTERVAL = 60000; 

    function checkAuthentication() {
        $.ajax({
            url: '/auth/check-auth', 
            method: 'GET',
            success: function(data) {
                if (!data.authenticated) {
                    window.location.href = '/auth/login';
                }
            },
            error: function(jqXHR) {
                console.error('Erro ao verificar autenticação:', jqXHR.responseText);
            }
        });
    }

    function updateFriends() {
        loadFriends();
    }

    function startPeriodicChecks() {
        checkAuthentication(); 
        updateFriends(); 

        setInterval(() => {
            checkAuthentication();
            updateFriends();
        }, CHECK_INTERVAL);
    }

    startPeriodicChecks();
});
