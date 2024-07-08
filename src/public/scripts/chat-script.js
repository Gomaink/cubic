const socket = io();

const UserId = currentUserId;
const User = currentUsername;
const Avatar = avatarUrl;

let currentFriendId = '';
let currentRoom = '';

// Função para entrar em uma sala específica
function joinRoom(friendUsername, friendId) {
    currentFriendId = friendId;
    currentRoom = [UserId, currentFriendId].sort().join('_');
    socket.emit('joinRoom', currentRoom);
    $('#chatContent').empty(); 
    document.title = `Cubic | ${friendUsername}`;
    const chatTitle = document.getElementById('chatTitle');
    chatTitle.innerText = friendUsername;
}

$(document).ready(function () {

    // Enviar mensagem
    $('#messageInput').on('keypress', function (e) {
        if (e.which === 13 && $(this).val().trim() !== '') {
            const message = $(this).val().trim();
            socket.emit('sendMessage', { user: User, userAvatar: Avatar, room: currentRoom, message });
            $(this).val('');
        }
    });

    // Receber mensagem
    socket.on('receiveMessage', function (data) {
        const { user, userAvatar, message } = data;
        $('#chatContent').append(`
            <div class="message">
                <img src="${userAvatar}" alt="${user}">
                <div>
                    <span class="user">${user}</span>
                    <span class="text">${message}</span>
                </div>
            </div>
        `);
    });

    // Resto do código para adicionar amigos, aceitar/rejeitar pedidos de amizade, etc.
    $('#addFriendForm').on('submit', function (e) {
        e.preventDefault();
        const friendName = $('#friendName').val();
        if (friendName === '') {
            $('#error-message').text('Usuário não encontrado.');
        } else {
            $('#error-message').text('');

            $.ajax({
                url: '/chats/add-friend',
                method: 'POST',
                data: JSON.stringify({ friendName: friendName }),
                contentType: 'application/json',
                success: function (data) {
                    if (data.success) {
                        $('#friendName').val('');
                        $('#error-message').text('Pedido de amizade enviado.');
                    } else {
                        $('#error-message').text(data.error);
                    }
                },
                error: function (jqXHR) {
                    const errorMessage = jqXHR.responseJSON ? jqXHR.responseJSON.error : 'Erro ao adicionar amigo. Tente novamente.';
                    $('#error-message').text(errorMessage);
                }
            });
        }
    });

    function loadFriendRequests() {
        $.ajax({
            url: '/chats/list',
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
                alert(errorMessage);
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
            url: '/chats/respond-friend-request',
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
            url: '/chats/check',
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

    function updateUsername(userId, newUsername) {
        $.ajax({
            url: '/chats/update-username',
            method: 'POST',
            data: JSON.stringify({ userId: userId, newUsername: newUsername }),
            contentType: 'application/json',
            success: function (data) {
                if (data.success) {
                    $('#modalAlterarNome').modal('hide'); // Esconde o modal após sucesso
                    // Aqui você pode atualizar o nome de usuário exibido na página, se necessário
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
            url: '/chats/update-nickname',
            method: 'POST',
            data: JSON.stringify({ userId: userId, newNickname: newNickname }),
            contentType: 'application/json',
            success: function (data) {
                if (data.success) {
                    $('#modalAlterarNick').modal('hide'); // Esconde o modal após sucesso
                    // Aqui você pode atualizar o nickname exibido na página, se necessário
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
            url: '/chats/upload-avatar',
            method: 'POST',
            data: formData,
            contentType: false,
            processData: false,
            success: function(data) {
                if (data.success) {
                    $('#modalAlterarAvatar').modal('hide');
                    // Atualizar a visualização do avatar na página, se necessário
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

    function loadFriends() {
        $.ajax({
            url: '/chats/friends', // Rota para obter a lista de amigos
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
                            friendsList.append(`
                                <li class="list-group-item">
                                    <a onclick="joinRoom('${friend.username}', '${friend._id}');" class="d-flex align-items-center friend-item" data-friend-name="${friend.username}">
                                        <img src="${friend.avatarUrl}" alt="${friend.username}" class="friend-avatar me-2">
                                        ${friend.username}
                                    </a>
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
                alert(errorMessage);
            }
        });
    }

    loadFriends();

    setInterval(checkFriendRequests, 500);
    setInterval(loadFriends, 500);
});
