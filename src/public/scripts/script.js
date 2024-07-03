document.addEventListener("DOMContentLoaded", function() {
    var daySelect = document.getElementById("daySelect");
    for (var day = 1; day <= 31; day++) {
        var option = document.createElement("option");
        option.text = day;
        option.value = day;
        daySelect.appendChild(option);
    }

    var monthSelect = document.getElementById("monthSelect");
    var months = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];
    months.forEach(function(month, index) {
        var option = document.createElement("option");
        option.text = month;
        option.value = index + 1;
        monthSelect.appendChild(option);
    });

    var yearSelect = document.getElementById("yearSelect");
    var currentYear = new Date().getFullYear();

    for (var year = currentYear; year >= 1900; year--) {
        var option = document.createElement("option");
        option.text = year;
        option.value = year;
        yearSelect.appendChild(option);
    }
});

$(document).ready(function () {
    $('#addFriendForm').on('submit', function (e) {
        e.preventDefault();
        const friendName = $('#friendName').val();
        if (friendName === '') {
            $('#error-message').text('Usuário não encontrado.');
        } else {
            $('#error-message').text('');

            // Enviar requisição AJAX para adicionar amigo
            $.ajax({
                url: '/chats/add-friend',
                method: 'POST',
                data: JSON.stringify({ friendName: friendName }), // Enviar dados como JSON
                contentType: 'application/json', // Definir tipo de conteúdo como JSON
                success: function (data) {
                    if (data.success) {
                        const avatarUrl = `/path/to/avatars/${friendName}.png`; // Atualizar este caminho conforme necessário
                        $('#friendsList').append(`
                            <li class="list-group-item">
                                <a href="#" class="d-flex align-items-center friend-item" data-friend-name="${friendName}">
                                    <img src="/images/cubic-w-nobg.png" alt="${friendName}" class="friend-avatar me-2">
                                    ${friendName}
                                </a>
                            </li>
                        `);
                        $('#friendName').val('');
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
});