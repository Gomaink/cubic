$(document).ready(function() {
    $('.friend-list-container').on('scroll', function() {
        var scrollPercentage = $(this).scrollTop() / ($(this).prop('scrollHeight') - $(this).height());
        var thumbTop = scrollPercentage * ($(this).height() - $('.custom-scrollbar-thumb').height());
        $('.custom-scrollbar-thumb').css('top', thumbTop);
    });
});

$(document).ready(function () {
    const socket = io();

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

    $('#messageInput').on('keypress', function(e) {
        if (e.which === 13 && $(this).val().trim() !== '') {
            const message = $(this).val().trim();
            socket.emit('sendMessage', { user: 'currentUser.username', message });
            $(this).val('');
        }
    });

    socket.on('receiveMessage', function(data) {
        const { user, message } = data;
        $('#chatContent').append(`
            <div class="message">
                <img src="/images/cubic-w-nobg.png" alt="${user}">
                <div>
                    <span class="user">${user}:</span>
                    <span class="text">${message}</span>
                </div>
            </div>
        `);
    });
    
    function loadFriendRequests() {
        $.ajax({
            url: '/chats/list', // Ajuste esta URL para corresponder à rota que retorna a lista de pedidos de amizade
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

    // Adicione event listeners aos botões de aceitar e recusar
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
            url: '/chats/check', // Ajuste esta URL para corresponder à rota que verifica as solicitações de amizade pendentes
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
                                    <a href="#" class="d-flex align-items-center friend-item" data-friend-name="${friend.username}">
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
