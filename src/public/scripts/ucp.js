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