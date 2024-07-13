const socket = io();
const UserId = currentUserId;
const User = currentUsername;
const Avatar = avatarUrl;
const confirmationToast = new bootstrap.Toast(document.getElementById('confirmationToast'));

let currentFriendId = '';
let currentRoom = '';
let currentFriendAvatar = '';
let friendToRemove = null;


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

// Função para entrar em uma sala específica
function joinRoom(friendUsername, friendNickname, friendId, friendAvatarUrl) {
    currentFriendId = friendId;
    currentRoom = [UserId, currentFriendId].sort().join('_');
    socket.emit('joinRoom', currentRoom);
    $('#chatContent').empty(); 
    document.title = `Cubic | ${friendNickname}`;
    const chatLink = document.querySelector('.chatTitle');
    const chatAvatar = chatLink.querySelector('#chatAvatar');
    const chatTitle = chatLink.querySelector('#chatTitle');
    chatTitle.innerText = `${friendUsername} AKA ${friendNickname}`;
    chatAvatar.src = friendAvatarUrl;
    document.getElementById('chatTitle').style.display = 'flex';
    loadMessages(friendId, friendUsername, friendNickname, friendAvatarUrl);
}

function loadMessages(friendId, friendUsername, friendNickname, friendAvatar) {
    $.ajax({
        url: `/messages/${currentUserId}/${friendId}`,
        method: 'GET',
        success: function (data) {
            const chatContent = $('#chatContent');
            chatContent.empty();
            

            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(message => {
                    const senderAvatar = message.sender === currentUserId ? avatarUrl : friendAvatar.replace(/\\/g, '/');
                    const formattedTimestamp = formatTimestamp(message.timestamp);
                    chatContent.append(`
                    <div class="message-container">
                        <div class="message">
                            <img src="${senderAvatar}" alt="${message.sender === currentUserId ? currentUsername : friendUsername}">
                            <div>
                                <span class="user">${message.sender === currentUserId ? currentNickname : friendNickname}</span> <a class="message-time">${formattedTimestamp}</a>
                                <span class="text">${message.message}</span>
                            </div>
                        </div>
                    </div>
                    `);
                });
            } else {
                chatContent.append('<p class="text-center">Não há nada por aqui até o momento...</p>');
            }
        },
        error: function (jqXHR) {
            const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao carregar as mensagens. Tente novamente.';
            console.error('Erro AJAX:', errorMessage);
        }
    });
}

//Remover amigo
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

$(document).ready(function () {

    // Enviar mensagem
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
        $('#chatContent').append(`
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
                    $('#error-message-modal-nickname').text('Nome de exibição atualizado com sucesso!');
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

    // Resto do código para adicionar amigos, aceitar/rejeitar pedidos de amizade, etc.
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
                            friendsList.append(`
                                <li class="list-group-item d-flex justify-content-between align-items-center" data-friend-id="${friend._id}">
                                    <a onclick="joinRoom('${friend.username}', '${friend.nickname}', '${friend._id}', '${formattedAvatarUrl}');" class="d-flex align-items-center friend-item" data-friend-name="${friend.username}">
                                        <img src="${friend.avatarUrl}" alt="${friend.username}" class="friend-avatar me-2">
                                        ${friend.nickname}
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

    loadFriends();

    setInterval(checkFriendRequests, 500);
    setInterval(loadFriends, 500);
});
