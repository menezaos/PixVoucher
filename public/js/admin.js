// Lógica para o painel de administração
document.addEventListener("DOMContentLoaded", () => {
  // Verifica qual página (login ou dashboard) está ativa e chama a função correspondente
  if (window.location.pathname.includes("/admin/dashboard.html")) {
    initializeDashboard();
  } else if (window.location.pathname.includes("/admin/")) {
    initializeLogin();
  }
});

/**
 * Lógica para a página de login (/admin/index.html)
 */
function initializeLogin() {
  const loginForm = document.getElementById("login-form");
  if (!loginForm) return;

  // Se já tiver token, redireciona para o dashboard
  if (localStorage.getItem("jwt_token")) {
    window.location.href = "/admin/dashboard.html";
    return;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const errorMessageDiv = document.getElementById("error-message");

    try {
      const response = await fetch("/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (data.success && data.token) {
        localStorage.setItem("jwt_token", data.token);
        window.location.href = "/admin/dashboard.html";
      } else {
        throw new Error(data.error || "Credenciais inválidas");
      }
    } catch (error) {
      errorMessageDiv.textContent = error.message;
      errorMessageDiv.classList.remove("d-none");
    }
  });
}

/**
 * Lógica para o painel principal (/admin/dashboard.html)
 */
function initializeDashboard() {
  const token = localStorage.getItem("jwt_token");
  // Se não houver token, volta para a página de login
  if (!token) {
    window.location.href = "/admin/";
    return;
  }

  const planModal = new bootstrap.Modal(document.getElementById("planModal"));
  const planForm = document.getElementById("plan-form");

  // Função para fazer logout
  const logout = () => {
    localStorage.removeItem("jwt_token");
    window.location.href = "/admin/";
  };
  document.getElementById("logout-button").addEventListener("click", logout);

  // Função genérica para fazer requisições à API com o token de autorização
  const fetchWithAuth = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401 || response.status === 403) {
      logout(); // Se o token for inválido ou expirar, faz logout
    }
    return response;
  };

  // Carrega os planos e preenche a tabela
  const loadPlans = async () => {
    const response = await fetchWithAuth("/admin/api/plans");
    const plans = await response.json();
    const tableBody = document.getElementById("plans-table-body");
    const voucherSelect = document.getElementById("voucher-plan-select");
    tableBody.innerHTML = "";
    voucherSelect.innerHTML = '<option value="">Selecione um plano...</option>';

    plans.forEach((plan) => {
      tableBody.innerHTML += `
                <tr>
                    <td>${plan.name}</td>
                    <td>R$ ${parseFloat(plan.price).toFixed(2)}</td>
                    <td>${plan.mikrotik_profile_name}</td>
                    <td>${plan.duration_hours}h</td>
                    <td>${plan.rate_limit_upload}/${
        plan.rate_limit_download
      }</td>
                    <td><span class="badge bg-${
                      plan.is_active ? "success" : "secondary"
                    }">${plan.is_active ? "Ativo" : "Inativo"}</span></td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-warning edit-plan" data-id="${
                          plan.id
                        }">Editar</button>
                        <button class="btn btn-sm btn-danger delete-plan" data-id="${
                          plan.id
                        }">Excluir</button>
                    </td>
                </tr>
            `;
      if (plan.is_active) {
        voucherSelect.innerHTML += `<option value="${plan.mikrotik_profile_name}">${plan.name}</option>`;
      }
    });
  };

  // Salva (cria ou edita) um plano
  planForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const planData = {
      id: document.getElementById("plan-id").value || null,
      name: document.getElementById("plan-name").value,
      price: parseFloat(document.getElementById("plan-price").value),
      mikrotik_profile_name: document.getElementById("plan-profile").value,
      duration_hours: parseInt(document.getElementById("plan-duration").value),
      rate_limit_upload: document.getElementById("plan-upload").value,
      rate_limit_download: document.getElementById("plan-download").value,
      is_active: document.getElementById("plan-active").checked,
    };

    await fetchWithAuth("/admin/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planData),
    });
    planModal.hide();
    loadPlans();
  });

  // Abre o modal para criar um novo plano
  document.getElementById("add-plan-button").addEventListener("click", () => {
    document.getElementById("planModalTitle").textContent =
      "Adicionar Novo Plano";
    planForm.reset();
    document.getElementById("plan-id").value = "";
  });

  // Lida com cliques na tabela (editar e excluir)
  document
    .getElementById("plans-table-body")
    .addEventListener("click", async (e) => {
      const planId = e.target.dataset.id;
      if (e.target.classList.contains("edit-plan")) {
        const response = await fetchWithAuth(`/admin/api/plans?id=${planId}`);
        const [plan] = await response.json();

        document.getElementById("planModalTitle").textContent = "Editar Plano";
        document.getElementById("plan-id").value = plan.id;
        document.getElementById("plan-name").value = plan.name;
        document.getElementById("plan-price").value = plan.price;
        document.getElementById("plan-profile").value =
          plan.mikrotik_profile_name;
        document.getElementById("plan-duration").value = plan.duration_hours;
        document.getElementById("plan-upload").value = plan.rate_limit_upload;
        document.getElementById("plan-download").value =
          plan.rate_limit_download;
        document.getElementById("plan-active").checked = plan.is_active;
        planModal.show();
      }

      if (e.target.classList.contains("delete-plan")) {
        if (
          confirm(
            "Tem certeza que deseja excluir este plano? Esta ação também removerá o perfil correspondente no Mikrotik."
          )
        ) {
          await fetchWithAuth(`/admin/api/plans/${planId}`, {
            method: "DELETE",
          });
          loadPlans();
        }
      }
    });

  // Gera os vouchers
  document
    .getElementById("voucher-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const profileName = document.getElementById("voucher-plan-select").value;
      const quantity = document.getElementById("voucher-quantity").value;
      if (!profileName) {
        alert("Por favor, selecione um plano.");
        return;
      }

      const response = await fetchWithAuth("/admin/api/generate-vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileName, quantity }),
      });
      const { vouchers } = await response.json();
      showPrintableVouchers(vouchers, profileName);
    });

  // Abre uma nova janela para impressão de vouchers
  function showPrintableVouchers(vouchers, planName) {
    const printWindow = window.open("", "_blank");
    const voucherHtml = vouchers
      .map(
        (v) => `
            <div class="voucher-ticket">
                <div class="voucher-header">Acesso Wi-Fi</div>
                <div class="voucher-body">
                    <strong>Plano:</strong> ${planName}<br>
                    <strong>Usuário:</strong> ${v.password}<br>
                    <strong>Senha:</strong> ${v.password}
                </div>
            </div>
        `
      )
      .join("");

    printWindow.document.write(`
            <html><head><title>Imprimir Vouchers</title>
            <style>
                body { font-family: sans-serif; margin: 20px; }
                .voucher-container { display: flex; flex-wrap: wrap; gap: 15px; }
                .voucher-ticket { border: 2px dashed #999; padding: 15px; text-align: center; width: 250px; border-radius: 10px;}
                .voucher-header { font-weight: bold; font-size: 1.2em; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px;}
                .voucher-body { font-size: 1.1em; line-height: 1.6; }
                .print-button { display: block; width: 100%; padding: 10px; margin-bottom: 20px; background: #007bff; color: white; border: none; cursor: pointer; }
                @media print { .print-button { display: none; } }
            </style>
            </head><body>
            <button class="print-button" onclick="window.print()">Imprimir</button>
            <div class="voucher-container">${voucherHtml}</div>
            </body></html>
        `);
    printWindow.document.close();
  }

  // Carrega os dados iniciais ao entrar no dashboard
  loadPlans();
}
