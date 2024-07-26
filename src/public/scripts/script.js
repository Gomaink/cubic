//=========================[VARIABLES]=========================//
const UserId = currentUserId;
const User = currentUsername;
const Avatar = avatarUrl;
const confirmationToast = new bootstrap.Toast(document.getElementById('confirmationToast'));

let currentFriendId = '';
let currentRoom = '';
let currentFriendAvatar = '';
let friendToRemove = null;

let currentRoomPeerIds = '';

const incommingCallToast = new bootstrap.Toast(document.getElementById('incommingCallToast'));
const callingToast = new bootstrap.Toast(document.getElementById('callingToast'));

const socket = io({ query: { currentUserId } });

//=========================[GENERAL FUNCTIONS]=========================//
function showErrorToast(messageError) {
    // Define the toast element and its body
    const toastElement = document.getElementById('errorToast');
    const toastBody = toastElement.querySelector('.toast-body');
    
    // Set the error message
    toastBody.textContent = messageError;
    
    // Create a Bootstrap toast instance
    const toast = new bootstrap.Toast(toastElement);
    
    // Show the toast
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
    hours = hours % 12 || 12; // Converte 0 horas para 12 e mantém o formato de 12 horas
    const time = `${hours.toString().padStart(2, '0')}:${minutes} ${period}`;

    if (isToday) {
        return `Hoje às ${time}`;
    } else if (isYesterday) {
        return `Ontem às ${time}`;
    } else {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Janeiro é 0!
        const year = date.getFullYear();
        return `${day}/${month}/${year} às ${time}`;
    }
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

//=========================[USER FUNCTIONS]=========================//

socket.on('userStatusChanged', (data) => {
    const { userId, online, nickname, avatar } = data;
    const color = online ? '#198754' : '#c93c3e';

    // Verificações opcionais
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

function updateUsername(userId, newUsername) {
    $.ajax({
        url: '/user/update-username',
        method: 'POST',
        data: JSON.stringify({ userId: userId, newUsername: newUsername }),
        contentType: 'application/json',
        success: function (data) {
            if (data.success) {
                $('#newName').val('');
                $('#user-username').text(newUsername);
                $('#error-message-modal-username').text('Nome de usuário atualizado com sucesso!');
            } else {
                $('#error-message-modal-username').text(data.error);
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao atualizar nome de usuário. Tente novamente.';
            $('#error-message-modal-username').text(errorMessage);
        }
    });
}

// Função para atualizar o nome de exibição (nickname)
function updateNickname(userId, newNickname) {
    $.ajax({
        url: '/user/update-nickname',
        method: 'POST',
        data: JSON.stringify({ userId: userId, newNickname: newNickname }),
        contentType: 'application/json',
        success: function (data) {
            if (data.success) {
                $('#newNick').val('');
                $('#user-nickname').text(newNickname);
                $('#error-message-modal-nickname').text('Nome de exibição atualizado com sucesso!');
                socket.emit('userChanges', userId, newNickname, null);
            } else {
                $('#error-message-modal-nickname').text(data.error);
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao atualizar nome de exibição. Tente novamente.';
            $('#error-message-modal-nickname').text(errorMessage);
        }
    });
}

$('#modalAlterarAvatar form').on('submit', function(e) {
    e.preventDefault();

    const fileInput = document.getElementById('newAvatar');
    const file = fileInput.files[0];

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

    $.ajax({
        url: '/user/upload-avatar',
        method: 'POST',
        data: formData,
        contentType: false,
        processData: false,
        success: function(data) {
            if (data.success) {
                $('#newAvatar').val('');
                $('#error-message-modal-avatar').text('Avatar atualizado com sucesso!');

                const newAvatarUrl = data.avatarUrl;
                $('#avatarImg').attr('src', newAvatarUrl);
                socket.emit('userChanges', currentUserId, null, newAvatarUrl);
            } else {
                console.error('Erro ao atualizar avatar:', data.error);
            }
        },
        error: function(jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao enviar requisição para atualizar avatar.';
            console.error('Erro AJAX:', errorMessage);
        }
    });
});

// Evento para submissão do formulário de alterar nome de usuário
$('#modalAlterarNome form').on('submit', function (e) {
    e.preventDefault();
    const newUsername = $('#newName').val().trim(); // Obtém o novo nome de usuário
    const userId = currentUserId; // Substitua pelo ID do usuário atual

    if (newUsername === '') {
        return;
    }
    
    updateUsername(userId, newUsername); // Chama a função para atualizar o nome de usuário
});

// Evento para submissão do formulário de alterar nickname
$('#modalAlterarNick form').on('submit', function (e) {
    e.preventDefault();
    const newNickname = $('#newNick').val().trim(); // Obtém o novo nickname
    const userId = currentUserId; // Substitua pelo ID do usuário atual

    if (newNickname === '') {
        return;
    }

    updateNickname(userId, newNickname); // Chama a função para atualizar o nickname
});

//=========================[MESSAGE FUNCTIONS]=========================//

function joinRoom(friendUsername, friendNickname, friendId, friendPeerId, friendAvatarUrl) {
    currentFriendId = friendId;
    currentFriendPeerId = friendPeerId;
    currentRoom = [UserId, currentFriendId].sort().join('_');
    socket.emit('joinRoom', currentRoom);
    $('#chatContent').empty(); 
    document.title = `Cubic | ${friendNickname}`;
    showChatTitle(friendUsername, friendAvatarUrl);
    loadMessages(friendId, friendUsername, friendNickname, friendAvatarUrl);
}

function loadMessages(friendId, friendUsername, friendNickname, friendAvatar) {
    $.ajax({
        url: `/messages/${currentUserId}/${friendId}`,
        method: 'GET',
        success: function (data) {
            const chatContent = $('#chatContent');
            const shouldScrollToBottom = isChatScrolledToBottom(); // Check if the chat is scrolled to bottom

            chatContent.empty();

            if (data.messages && data.messages.length > 0) {
                let previousSenderId = null;
                let consecutiveMessagesCount = 0;

                data.messages.forEach((message, index) => {
                    const senderAvatar = message.sender === currentUserId ? avatarUrl : friendAvatar.replace(/\\/g, '/');
                    const formattedTimestamp = formatTimestamp(message.timestamp);

                    // Check if the current message sender is the same as the previous message sender
                    let sameSenderAsPrevious = message.sender === previousSenderId;

                    // Check if we need to transition to a new message group
                    if (!sameSenderAsPrevious || consecutiveMessagesCount >= 15) {
                        // If we had a previous sender and reached max consecutive messages, end the previous group
                        if (previousSenderId !== null && consecutiveMessagesCount >= 15) {
                            chatContent.append('</div>'); // Close the previous group
                        }

                        // Start a new message group
                        chatContent.append('<div class="message-container">');
                        consecutiveMessagesCount = 0;
                        sameSenderAsPrevious = null;
                    }

                    // Prepare the message HTML
                    let messageHtml = `
                        <div class="${!sameSenderAsPrevious ? 'message' : 'message-conc'}">
                            ${!sameSenderAsPrevious ? `<img src="${senderAvatar}" alt="${message.sender === currentUserId ? currentUsername : friendUsername}">` : ''}
                            <div>
                                ${!sameSenderAsPrevious ? `<span class="user">${message.sender === currentUserId ? currentNickname : friendNickname}</span> <a class="message-time">${formattedTimestamp}</a>` : ''}
                                <span class="text">${message.message}</span>
                            </div>
                        </div>
                    `;

                    // Append the message HTML
                    chatContent.append(messageHtml);

                    // Increment consecutive messages count
                    consecutiveMessagesCount++;

                    // Update previousSenderId for the next iteration
                    previousSenderId = message.sender;
                });

                // Close the final message group if needed
                if (previousSenderId !== null && consecutiveMessagesCount >= 15) {
                    chatContent.append('</div>'); // Close the final group
                }
            } else {
                chatContent.append('<p class="text-center">Não há nada por aqui até o momento...</p>');
            }

            // Scroll to bottom if chat was scrolled to bottom before loading messages
            if (shouldScrollToBottom) {
                scrollToBottom();
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao carregar as mensagens. Tente novamente.';
            console.error('Erro AJAX:', errorMessage);
        }
    });
}

// Function to check if chat is scrolled to bottom
function isChatScrolledToBottom() {
    const chatContent = $('#chatContent');
    return chatContent.prop('scrollHeight') - chatContent.scrollTop() === chatContent.outerHeight();
}

// Function to scroll chat content to bottom
function scrollToBottom() {
    const chatContent = $('#chatContent');
    chatContent.scrollTop(chatContent.prop('scrollHeight'));
}

$('#messageInput').on('keypress', function (e) {
    if (e.which === 13 && $(this).val().trim() !== '') {
        const message = $(this).val().trim();
        if (message.length > 2000) {
            const toastElement = document.getElementById('characterLimitToast');
            const toast = new bootstrap.Toast(toastElement);
            toast.show();
            return;
        }

        socket.emit('sendMessage', { user: User, userAvatar: Avatar, room: currentRoom, message });
        $.ajax({
            url: '/messages/send-message',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ senderId: UserId, receiverId: currentFriendId, message }),
            success: function (data) {
                if (data.success) {
                    console.log('Mensagem enviada com sucesso!');
                    /*$('#chatContent').append(`
                        <div class="message">
                            <img src="${avatarUrl}" alt="${currentUsername}">
                            <div>
                                <span class="user">${currentUsername}</span>
                                <span class="text">${message}</span>
                            </div>
                        </div>
                    `);*/
                } else {
                    console.error('Erro ao enviar a mensagem:', data.error);
                }
            },
            error: function (jqXHR) {
                const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao enviar a mensagem. Tente novamente.';
                console.error('Erro AJAX:', errorMessage);
            }
        });

        $(this).val('');
    }
});

//Receber mensagem
socket.on('receiveMessage', function (data) {
    const { user, userAvatar, message } = data;
    const chatContent = $('#chatContent');
    const shouldScrollToBottom = isChatScrolledToBottom();
    let lastMessageContainer = chatContent.children('.message-container').last();

    // Check if there is already a message container
    if (lastMessageContainer.length > 0) {
        const lastMessage = lastMessageContainer.find('.message').last();
        const lastSender = lastMessage.find('.user').text();

        // Check if the last message sender is the same as the current message sender and it's not the initial load
        if (lastSender === user && !lastMessageContainer.hasClass('initial-load')) {
            // Append to the last message container
            lastMessageContainer.append(`
                <div class="message-conc">
                    <div>
                        <span class="text">${message}</span>
                    </div>
                </div>
            `);
        } else {
            // Start a new message container
            chatContent.append(`
                <div class="message-container">
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
    } else {
        // No existing message containers, create a new one
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

    // Scroll to bottom if chat was scrolled to bottom before receiving the message
    if (shouldScrollToBottom) {
        scrollToBottom();
    }
});

//=========================[FRIENDS FUNCTIONS]=========================//

function RemoveFriend(friendId) {
    friendToRemove = friendId;
    confirmationToast.show();
}

document.getElementById('confirmRemove').addEventListener('click', function() {
    if (friendToRemove) {
        // Faz uma solicitação AJAX para remover o amigo
        $.ajax({
            url: `/friends/remove/${friendToRemove}`,
            method: 'DELETE',
            success: function(data) {
                if (data.success) {
                    // Remove o amigo da lista
                    document.querySelector(`li[data-friend-id="${friendToRemove}"]`).remove();
                    // Esconde o toast
                    confirmationToast.hide();
                } else {
                    console.error('Erro ao remover amigo:', data.error);
                }
            },
            error: function(jqXHR) {
                const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao remover amigo. Tente novamente.';
                console.error('Erro AJAX:', errorMessage);
            }
        });
    }
});

$('#modalFriendAdd form').on('submit', function (e) {
    e.preventDefault();
    const friendName = $('#newFriend').val();
    if (friendName === '') {
        $('#error-message-modal-username').text('Usuário não encontrado.');
    } else {
        $('#error-message-modal-username').text('');

        $.ajax({
            url: '/friends/add-friend',
            method: 'POST',
            data: JSON.stringify({ friendName: friendName }),
            contentType: 'application/json',
            success: function (data) {
                if (data.success) {
                    $('#newFriend').val('');
                    $('#error-message-modal-addfriend').text('Pedido de amizade enviado.');
                } else {
                    $('#error-message-modal-username').text(data.error);
                }
            },
            error: function (jqXHR) {
                const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao adicionar amigo. Tente novamente.';
                $('#error-message-modal-username').text(errorMessage);
            }
        });
    }
});

function loadFriendRequests() {
    $.ajax({
        url: '/friends/friend-list',
        method: 'GET',
        success: function (data) {
            const friendRequestsList = $('#friendRequestsList');
            friendRequestsList.empty();

            if (data.friendRequests && data.friendRequests.length > 0) {
                data.friendRequests.forEach(request => {
                    friendRequestsList.append(`
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <span class="requester-name">${request.requester.username}</span>
                            <div class="friend-requests-buttons">
                                <button class="btn btn-success btn-sm accept-friend-request" data-request-id="${request._id}">Aceitar</button>
                                <button class="btn btn-danger btn-sm decline-friend-request" data-request-id="${request._id}">Recusar</button>
                            </div>
                        </li>
                    `);
                });
            } else {
                friendRequestsList.append('<li class="list-group-item text-center">Nenhum pedido de amizade.</li>');
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao carregar pedidos de amizade. Tente novamente.';
            console.error(errorMessage);
        }
    });
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

function respondToFriendRequest(requestId, action) {
    $.ajax({
        url: '/friends/respond-friend-request',
        method: 'POST',
        data: JSON.stringify({ requestId: requestId, action: action }),
        contentType: 'application/json',
        success: function (data) {
            if (data.success) {
                loadFriendRequests();
                loadFriends();
                $('#error-message-modal').text(`Pedido de amizade ${action === 'accept' ? 'aceito' : 'recusado'}!`);
            } else {
                $('#error-message-modal').text(`Erro ao processar o pedido de amizade.`);
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao processar o pedido de amizade. Tente novamente.';
            $('#error-message-modal').text(errorMessage);
        }
    });
}

function checkFriendRequests() {
    $.ajax({
        url: '/friends/friend-check-notification',
        method: 'GET',
        success: function (data) {
            const notificationIcon = $('#friendRequestsNotification');
            if (data.pendingRequests && data.pendingRequests > 0) {
                notificationIcon.show();
            } else {
                notificationIcon.hide();
            }
        },
        error: function (jqXHR) {
            console.error('Erro ao verificar solicitações de amizade:', jqXHR);
        }
    });
}

function loadFriends() {
    $.ajax({
        url: '/friends', // Rota para obter a lista de amigos
        method: 'GET',
        success: function (data) {
            const friendsList = $('#friendsList');
            const currentFriends = {};

            // Obter os amigos atualmente renderizados
            friendsList.children('li').each(function () {
                const friendName = $(this).find('a').data('friend-name');
                currentFriends[friendName] = $(this);
            });

            // Verificar e adicionar novos amigos
            if (data.friends && data.friends.length > 0) {
                const newFriends = {};
                data.friends.forEach(friend => {
                    newFriends[friend.username] = true;
                    if (!currentFriends[friend.username]) {
                        const formattedAvatarUrl = friend.avatarUrl.replace(/\\/g, '/');
                        const backgroundColor = friend.online ? "#198754" : "#c93c3e";
                        friendsList.append(`
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
                friendsList.empty();
                friendsList.append('<li class="list-group-item text-center">Nenhum amigo encontrado.</li>');
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao carregar a lista de amigos. Tente novamente.';
            console.error(errorMessage);
        }
    });
}

//=========================[VOICE CHAT FUNCTIONS]=========================//

var peer = new Peer();

peer.on('open', function(id) {
    console.log('My peer ID is: ' + id);

    $.ajax({
        url: '/user/update-peerid',
        method: 'POST',
        data: JSON.stringify({ userId: currentUserId, peerid: id }),
        contentType: 'application/json',
        success: function (data) {
            if (data.success) {
                console.log("PeerId atualizado!");
            } else {
                console.log("Ocorreu um erro ao atualizar o PeerId atualizado!" + data.error);
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao atualizar o PeerID. Tente novamente.';
            console.log(errorMessage);
        }
    });
});

if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
        let currentCall = null;
        let remoteAudioStream = null;

        // Atender a chamada e fornecer a MediaStream
        peer.on('call', function(call) {
            currentCall = call;
            
            incommingCallToast.show();
            document.getElementById('callerUsername').innerText = call.metadata.callerUsername;

            document.getElementById('acceptCallButton').onclick = function() {
                incommingCallToast.hide();
                call.answer(stream);
                call.on('stream', function(remoteStream) {
                    remoteAudioStream = remoteStream;
                    var audioElement = new Audio();
                    audioElement.srcObject = remoteStream;
                    audioElement.play();
                    document.getElementById('endCallButton').style.display = 'flex';
                });

                call.on('close', function(remoteStream) {
                    incommingCallToast.hide();
                    showErrorToast('Chamada encerrada.');
                    document.getElementById('endCallButton').style.display = 'none';
                });
            };

            document.getElementById('rejectCallButton').onclick = function() {
                incommingCallToast.hide();
                call.close();
            };
        });

        // Realizar a chamada ao clicar no botão
        document.getElementById('audioCallButton').addEventListener('click', function() {
            $.ajax({
                url: `/friends/${currentFriendId}`,
                method: 'GET',
                success: function (data) {
                    if (data.friend) {
                        const friend = data.friend;

                        if(!friend.online)
                            return showErrorToast("O seu amigo está offline, portanto não pode receber chamadas.");

                        document.getElementById('calleeUsername').innerText = friend.username;
                        callingToast.show();

                        console.log('Calling peer ID: ' + friend.peerid);

                        var call = peer.call(friend.peerid, stream, {
                            metadata: { callerUsername: currentUsername }
                        });

                        currentCall = call;

                        call.on('stream', function(remoteStream) {
                            remoteAudioStream = remoteStream;
                            var audioElement = new Audio();
                            audioElement.srcObject = remoteStream;
                            audioElement.play();
                            document.getElementById('endCallButton').style.display = 'flex';
                            callingToast.hide();
                        });


                        document.getElementById('rejectCallButton').onclick = function() {
                            callingToast.hide();
                            call.close();
                        };

                        call.on('close', function(remoteStream) {
                            callingToast.hide();
                            showErrorToast('Chamada encerrada.');
                            document.getElementById('endCallButton').style.display = 'none';
                        });

                    } else {
                        showErrorToast('Dados do amigo não encontrado.');
                    }
                },
                error: function (jqXHR) {
                    const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Dados do amigo não encontrados.';
                    showErrorToast(errorMessage);
                }
            });
        });

        document.getElementById('endCallButton').onclick = function() {
            callingToast.hide();

            if (currentCall) {
                currentCall.close();
                currentCall = null;
                document.getElementById('endCallButton').style.display = 'none';
                showErrorToast('Chamada encerrada.');
            } else {
                document.getElementById('endCallButton').style.display = 'none';
                showErrorToast('Nenhuma chamada ativa para encerrar.');
            }
        };

        // Controlar volume e mute
        var muteButton = document.getElementById('muteButton');
        var headphoneButton = document.getElementById('headphoneButton');
        var volumeSlider = document.getElementById('volumeSlider');
        var audioElement = new Audio();
        var userHeaphone = true;
        audioElement.muted = false;

        muteButton.addEventListener('click', function() {
            const icon = muteButton.querySelector('i');
            
            if (audioElement.muted) {
                audioElement.muted = false;
                icon.classList.remove('fa-microphone-slash');
                icon.classList.add('fa-microphone');
                icon.style.color = 'white'; // Define a cor para 'white' quando o microfone está desligado
            } else {
                audioElement.muted = true;
                icon.classList.remove('fa-microphone');
                icon.classList.add('fa-microphone-slash');
                icon.style.color = '#FF6347'; // Define a cor para '#FF6347' quando o microfone está ligado
            }
        });

        headphoneButton.addEventListener('click', function() {
            const icon = headphoneButton.querySelector('i');
            
            if (userHeaphone) {
                userHeaphone = false;
                audioElement.volume = 0;
                icon.style.color = '#FF6347'; // Define a cor para vermelho quando o microfone está desligado
            } else {
                userHeaphone = true;
                audioElement.volume = volumeSlider.value;
                icon.style.color = 'white'; // Define a cor para verde quando o microfone está ligado
            }
        });

        volumeSlider.addEventListener('input', function() {
            audioElement.volume = volumeSlider.value;
        });
    }).catch(function(err) {
        showErrorToast('Failed to get local stream', err);
    });
} 
else {
    showErrorToast('Seu navegador não suporta a API getUserMedia.');
}

$(document).ready(function () {

    // Verifica periodicamente se o usuário está logado
    setInterval(() => {
        $.ajax({
            url: '/auth/check-auth', // Endpoint para verificar autenticação
            method: 'GET',
            success: function(data) {
                if (!data.authenticated) {
                    // Se não estiver autenticado, redireciona para o loginaa
                    window.location.href = '/auth/login';
                    console.log("teste");
                }
            },
            error: function(jqXHR) {
                console.error('Erro ao verificar autenticação:', jqXHR.responseText);
            }
        });
        //checkFriendRequests();
        loadFriends();
    }, 1000); // Verifica a cada minuto (ajuste conforme necessário)a
});