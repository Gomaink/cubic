//=========================[VARIABLES]=========================//
const UserId = currentUserId;
const User = currentUsername;
const Avatar = avatarUrl;
const socket = io({ query: { currentUserId } });

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


async function addFriend(friendName) {
    try {
        console.log(friendName);
        const response = await fetch('/friends/add-friend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ friendName })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            $('#newFriend').val('');
            $('#error-message-modal-addfriend').text('Pedido de amizade enviado.');
        } else {
            $('#error-message-modal-username').text(data.error);
        }
    } catch (error) {
        const errorMessage = error.message || 'Erro ao adicionar amigo. Tente novamente.';
        $('#error-message-modal-username').text(errorMessage);
    }
}

async function loadFriendRequests() {
    try {
        const response = await fetch('/friends/friend-list', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (response.ok && data.friendRequests) {
            const friendRequestsList = document.getElementById('friendRequestsList');
            friendRequestsList.innerHTML = '';

            if (data.friendRequests.length > 0) {
                data.friendRequests.forEach(request => {
                    const listItem = document.createElement('li');
                    listItem.className = 'list-group-item d-flex justify-content-between align-items-center';

                    listItem.innerHTML = `
                        <span class="requester-name">${request.requester.username}</span>
                        <div class="friend-requests-buttons">
                            <button class="btn btn-success btn-sm accept-friend-request" data-request-id="${request._id}">Aceitar</button>
                            <button class="btn btn-danger btn-sm decline-friend-request" data-request-id="${request._id}">Recusar</button>
                        </div>
                    `;

                    friendRequestsList.appendChild(listItem);
                });
            } else {
                friendRequestsList.innerHTML = '<li class="list-group-item text-center">Nenhum pedido de amizade.</li>';
            }
        } else {
            $('#error-message-modal-username').text(data.error || 'Erro na resposta da rede');
        }
    } catch (error) {
        const errorMessage = error.message || 'Erro ao carregar pedidos de amizade. Tente novamente.';
        $('#error-message-modal-username').text(errorMessage);
    }
}


async function respondToFriendRequest(requestId, action) {
    try {
        const response = await fetch('/friends/respond-friend-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ requestId: requestId, action: action })
        });

        if (!response.ok) {
            throw new Error('Erro na resposta da rede');
        }

        const data = await response.json();

        if (data.success) {
            await Promise.all([loadFriendRequests(), loadFriends()]); // Aguarda ambas as funções serem concluídas
            document.getElementById('error-message-modal').textContent = `Pedido de amizade ${action === 'accept' ? 'aceito' : 'recusado'}!`;
        } else {
            document.getElementById('error-message-modal').textContent = 'Erro ao processar o pedido de amizade.';
        }
    } catch (error) {
        document.getElementById('error-message-modal').textContent = `Erro ao processar o pedido de amizade. Tente novamente.`;
        console.error('Erro ao processar pedido de amizade:', error.message);
    }
}


async function checkFriendRequests() {
    try {
        const response = await fetch('/friends/friend-check-notification', {
            method: 'GET'
        });

        if (!response.ok) {
            throw new Error('Erro na resposta da rede');
        }

        const data = await response.json();
        const notificationIcon = document.getElementById('friendRequestsNotification');

        if (data.pendingRequests && data.pendingRequests > 0) {
            notificationIcon.style.display = 'block';
        } else {
            notificationIcon.style.display = 'none';
        }
    } catch (error) {
        console.error('Erro ao verificar solicitações de amizade:', error.message);
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
                            <a onclick="joinRoom('${friend.username}', '${friend.nickname}', '${friend._id}', '${friend.peerid}', '${formattedAvatarUrl}');" class="d-flex align-items-center friend-item" data-friend-name="${friend.username}">
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
