const socket = io({ query: { currentUserId } });
let userNewPassword = '';

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

    if (input.style.display === 'none') {
        input.style.display = 'inline';
        span.style.display = 'none';
        editButton.style.display = 'none';
        saveButton.style.display = 'inline';
        input.focus();
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

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        uploadAvatar(file);
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

//FRIENDS
document.addEventListener("DOMContentLoaded", function() {
    loadFriends();
    loadRequests();
    loadReceivedRequests();
});

async function loadFriends() {
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
        removeButton.onclick = () => removeFriend(friend._id);

        friendItem.appendChild(friendInfo);
        friendItem.appendChild(removeButton);

        friendList.appendChild(friendItem);
    });
}

async function removeFriend(friendId) {
    if (confirm('Tem certeza de que deseja remover este amigo?')) {
        try {
            const response = await fetch(`/friends/remove/${friendId}`, { method: 'DELETE' });
            const data = await response.json();

            if (response.ok) {
                loadFriends();
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