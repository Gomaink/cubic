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