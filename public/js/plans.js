document.addEventListener("DOMContentLoaded", () => {
  // --- Variáveis e Seletores Globais ---
  const paymentModalElement = document.getElementById("paymentModal");
  const paymentModal = new bootstrap.Modal(paymentModalElement);
  const params = new URLSearchParams(window.location.search);
  const macAddress = params.get("mac");
  const loginUrl = params.get("link-login-only");
  let currentPlan = {}; // Armazena os dados do plano selecionado

  // --- Seletores do Modal ---
  const pixStep1 = document.getElementById("pix-step-1");
  const pixStep2 = document.getElementById("pix-step-2");
  const generatePixButton = document.getElementById("generate-pix-button");
  const qrCodeImg = document.getElementById("qr-code-img");
  const qrCodeText = document.getElementById("qr-code-text");
  const paymentStatusPixDiv = document.getElementById("payment-status-pix");
  const copyQrTextButton = document.getElementById("copy-qr-text");

  // Inicializa o processo principal da página
  initializePage();

  function initializePage() {
    document.getElementById("back-link").href += window.location.search;
    fetchPlans();
    document
      .getElementById("plans-container")
      .addEventListener("click", handlePlanSelection);
    generatePixButton.addEventListener("click", generatePix);
    copyQrTextButton.addEventListener("click", copyPixCode);

    // Reseta o modal para o passo 1 quando ele for fechado
    paymentModalElement.addEventListener("hidden.bs.modal", () => {
      pixStep1.classList.remove("d-none");
      pixStep2.classList.add("d-none");
      generatePixButton.disabled = false;
      generatePixButton.innerHTML = "Gerar PIX para Pagamento";
    });
  }

  async function fetchPlans() {
    try {
      const response = await fetch("/api/plans");
      const plans = await response.json();
      displayPlans(plans);
    } catch (error) {
      console.error("Erro ao buscar planos:", error);
      document.getElementById("plans-container").innerHTML =
        '<p class="text-danger text-center">Não foi possível carregar os planos.</p>';
    }
  }

  function displayPlans(plans) {
    const container = document.getElementById("plans-container");
    container.innerHTML = "";
    if (!plans || plans.length === 0) {
      container.innerHTML =
        '<p class="text-center">Nenhum plano disponível.</p>';
      return;
    }
    plans.forEach((plan) => {
      const card = document.createElement("div");
      card.className = "col-lg-4 col-md-6 mb-4";
      card.innerHTML = `
                <div class="card h-100 text-center selection-card p-3">
                    <div class="card-body d-flex flex-column">
                        <h5 class="card-title fw-bold">${plan.name}</h5>
                        <h3 class="fw-bolder my-3">R$ ${plan.price.toFixed(
                          2
                        )}</h3>
                        <button class="btn btn-primary mt-auto" data-plan-id="${
                          plan.id
                        }" data-plan-price="${plan.price}" data-plan-name="${
        plan.name
      }">Pagar Agora</button>
                    </div>
                </div>
            `;
      container.appendChild(card);
    });
  }

  function handlePlanSelection(event) {
    const button = event.target.closest("button[data-plan-id]");
    if (!button) return;

    currentPlan = {
      id: button.dataset.planId,
      price: button.dataset.planPrice,
      name: button.dataset.planName,
    };

    // Preenche as informações do plano no modal
    document.getElementById("selected-plan-name").textContent =
      currentPlan.name;
    document.getElementById("selected-plan-price").textContent = parseFloat(
      currentPlan.price
    ).toFixed(2);

    // Abre o modal na etapa 1
    paymentModal.show();
  }

  async function generatePix() {
    console.log("Botão 'Gerar PIX' clicado. Criando pagamento...");
    generatePixButton.disabled = true;
    generatePixButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Gerando...`;

    try {
      const response = await fetch("/api/generate-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: currentPlan.id, macAddress, loginUrl }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Falha ao gerar o PIX.");
      }

      const paymentData = await response.json();

      qrCodeImg.src = `data:image/jpeg;base64,${paymentData.qrCodeBase64}`;
      qrCodeText.value = paymentData.qrCodeText;
      paymentStatusPixDiv.innerHTML = `<p class="text-muted">Aguardando confirmação do pagamento...</p>`;

      pixStep1.classList.add("d-none");
      pixStep2.classList.remove("d-none");

      connectWebSocket();
    } catch (error) {
      console.error("Erro ao gerar PIX:", error);
      generatePixButton.disabled = false;
      generatePixButton.innerHTML = "Gerar PIX para Pagamento";
      alert(`Erro: ${error.message}`);
    }
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${protocol}://${window.location.host}?mac=${macAddress}`;
    const webSocket = new WebSocket(wsUrl);

    webSocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.status === "APPROVED") {
        window.location.href = `/post-payment.html?loginUrl=${encodeURIComponent(
          message.loginUrl
        )}`;
      }
    };
  }

  function copyPixCode() {
    qrCodeText.select();
    document.execCommand("copy");
    copyQrTextButton.textContent = "Copiado!";
    setTimeout(() => {
      copyQrTextButton.textContent = "Copiar Código";
    }, 2000);
  }
});
