// Lógica para a página de voucher
document.addEventListener("DOMContentLoaded", () => {
  const voucherForm = document.getElementById("voucher-form");
  const voucherCodeInput = document.getElementById("voucher-code");
  const statusMessageDiv = document.getElementById("status-message");
  const params = new URLSearchParams(window.location.search);
  const mikrotikLoginUrl = params.get("link-login-only");

  document.getElementById("back-link").href += window.location.search;

  if (!mikrotikLoginUrl) {
    statusMessageDiv.innerHTML = `<div class="alert alert-danger">Erro de configuração: URL de login do hotspot não encontrada.</div>`;
    voucherForm.style.display = "none";
  }

  voucherForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = voucherCodeInput.value.trim();
    if (!code) return;

    statusMessageDiv.innerHTML = `<div class="alert alert-info">Conectando...</div>`;

    const form = document.createElement("form");
    form.method = "POST";
    form.action = mikrotikLoginUrl;
    form.target = "loginFrame";

    const userInput = document.createElement("input");
    userInput.type = "hidden";
    userInput.name = "username";
    userInput.value = code;
    form.appendChild(userInput);

    const passInput = document.createElement("input");
    passInput.type = "hidden";
    passInput.name = "password";
    passInput.value = code;
    form.appendChild(passInput);

    document.body.appendChild(form);
    form.submit();
    form.remove();

    setTimeout(() => {
      statusMessageDiv.innerHTML = `<div class="alert alert-success"><strong>Login enviado!</strong> Tente abrir um novo site para verificar sua conexão.</div>`;
    }, 2000);
  });
});
