document.addEventListener("DOMContentLoaded", async () => {
  // Extrai parâmetros da URL (enviados pelo Mikrotik)
  const urlParams = new URLSearchParams(window.location.search);
  const macAddress = urlParams.get("mac");
  const ipAddress = urlParams.get("ip");
  const loginUrlBase = urlParams.get("link-login-only");

  // Elementos do DOM
  const plansContainer = document.getElementById("plans-container");
  const paymentSection = document.getElementById("payment-section");
  const successSection = document.getElementById("success-section");
  const qrCodeContainer = document.getElementById("qrcode-container");
  const pixCodeTextarea = document.getElementById("pix-code");
  const waitingMessage = document.getElementById("waiting-message");
  const spinner = document.getElementById("spinner");
  const statusMessage = document.getElementById("status-message");
  const copyPixButton = document.getElementById("copy-pix-button");

  let mikrotikAutoLoginUrl = "";

  // Função para exibir mensagens de erro personalizadas
  function showErrorMessage(message) {
    paymentSection.innerHTML = `
      <h2 class="text-red-600 text-2xl font-bold mb-4">Ocorreu um erro</h2>
      <p class="text-gray-700">${message}</p>
      <button id="back-to-plans" class="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg shadow-md">
        Voltar aos Planos
      </button>
    `;
    document.getElementById("back-to-plans").addEventListener("click", () => {
      paymentSection.classList.add("hidden");
      plansContainer.classList.remove("hidden");
      loadAndRenderPlans(); // Recarrega os planos
    });
    console.error("[FRONTEND] Erro exibido ao usuário:", message);
  }

  // Função para exibir a tela de sucesso e o botão de redirecionamento
  function showSuccessScreen(loginUrl) {
    paymentSection.classList.add("hidden");
    plansContainer.classList.add("hidden"); // Garante que os planos estejam escondidos
    successSection.classList.remove("hidden");

    mikrotikAutoLoginUrl = loginUrl;

    const redirectToInternetButton = document.createElement("button");
    redirectToInternetButton.id = "redirect-to-internet";
    redirectToInternetButton.textContent = "Acessar Internet";
    redirectToInternetButton.classList.add(
      "mt-6",
      "bg-green-500",
      "hover:bg-green-600",
      "text-white",
      "font-bold",
      "py-3",
      "px-6",
      "rounded-lg",
      "shadow-lg",
      "transition-colors",
      "duration-200",
      "text-base",
      "sm:text-lg"
    ); // Adicionei classes Tailwind de responsividade

    successSection.innerHTML = `
      <h2 class="text-green-700 text-3xl font-bold mb-4">Pagamento Aprovado!</h2>
      <p class="text-gray-700 text-lg mb-4">Seu acesso à internet foi liberado.</p>
      <p class="text-gray-600 mb-6">Clique no botão abaixo para continuar sua navegação.</p>
    `;
    successSection.appendChild(redirectToInternetButton);

    redirectToInternetButton.addEventListener("click", () => {
      if (mikrotikAutoLoginUrl) {
        console.info(
          "[FRONTEND] Redirecionando para URL de auto-login do Mikrotik:",
          mikrotikAutoLoginUrl
        );
        setTimeout(() => {
          window.location.href = mikrotikAutoLoginUrl;
        }, 100);
      } else {
        console.error(
          "[ERRO][FRONTEND] URL de auto-login do Mikrotik não disponível."
        );
        window.location.href = "http://www.google.com";
      }
    });
    console.info("[FRONTEND] Tela de sucesso exibida.");
  }

  // Função para carregar e renderizar planos dinamicamente
  async function loadAndRenderPlans() {
    console.info("[FRONTEND] Carregando planos do backend...");
    plansContainer.innerHTML = `
      <div class="flex flex-col justify-center items-center h-32">
        <div class="spinner"></div>
        <p class="mt-4 text-gray-600 text-lg">Carregando planos...</p>
      </div>
    `; // Mostra spinner enquanto carrega
    plansContainer.classList.remove("hidden"); // Garante que o container de planos esteja visível

    try {
      const response = await fetch("/api/plans");
      if (!response.ok) {
        console.error(
          "[ERRO][FRONTEND] Falha ao carregar planos: Status " + response.status
        );
        throw new Error("Não foi possível carregar os planos de internet.");
      }
      const plans = await response.json();

      plansContainer.innerHTML = ""; // Limpa o spinner/mensagem de carregamento

      plans.forEach((plan) => {
        const planDiv = document.createElement("div");
        // Classes Tailwind para responsividade e estilo consistente
        planDiv.classList.add(
          "plan",
          "bg-blue-100",
          "p-5",
          "sm:p-6",
          "rounded-lg",
          "shadow-md",
          "cursor-pointer",
          "hover:bg-blue-200",
          "transition-colors",
          "duration-200",
          "flex",
          "flex-col",
          "items-center",
          "justify-center"
        );
        planDiv.dataset.id = plan.id;
        planDiv.innerHTML = `
          <h2 class="text-lg sm:text-xl font-semibold text-blue-800 mb-1">${plan.name.toUpperCase()}</h2>
          <p class="price text-xl sm:text-2xl font-bold text-blue-900 mt-1 sm:mt-2">R$ ${plan.price
            .toFixed(2)
            .replace(".", ",")}</p>
        `;

        planDiv.addEventListener("click", async () => {
          console.info(
            `[FRONTEND] Plano ${plan.name} (ID: ${plan.id}) clicado.`
          );
          plansContainer.classList.add("hidden");
          paymentSection.classList.remove("hidden");
          spinner.classList.remove("hidden");
          waitingMessage.classList.remove("hidden");
          statusMessage.textContent = "Gerando QR Code...";
          qrCodeContainer.innerHTML = "";
          pixCodeTextarea.value = "";

          try {
            const paymentResponse = await fetch("/generate-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planId: plan.id,
                macAddress,
                ipAddress,
                loginUrl: loginUrlBase,
              }),
            });

            if (!paymentResponse.ok) {
              const errorData = await paymentResponse.json();
              throw new Error(errorData.error || "Falha ao gerar o pagamento.");
            }

            const data = await paymentResponse.json();
            spinner.classList.add("hidden");
            // Adicionei classes Tailwind para a imagem do QR Code
            qrCodeContainer.innerHTML = `<img src="data:image/jpeg;base64,${data.qrCodeBase64}" alt="PIX QR Code" class="w-48 h-48 mx-auto rounded-lg shadow-md block">`;
            pixCodeTextarea.value = data.qrCodeText;
            waitingMessage.classList.add("hidden");
            statusMessage.textContent =
              "Escaneie o QR Code abaixo com o app do seu banco:";
            console.info("[FRONTEND] QR Code e código Pix exibidos.");
          } catch (error) {
            console.error("[ERRO][FRONTEND] Erro ao gerar pagamento:", error);
            showErrorMessage(error.message);
          }
        });
        plansContainer.appendChild(planDiv);
      });
      console.info("[FRONTEND] Planos carregados e renderizados com sucesso.");
    } catch (error) {
      console.error("[ERRO][FRONTEND] Erro fatal ao carregar planos:", error);
      plansContainer.innerHTML = `
        <p class="text-red-600 text-center text-lg mt-8">
          Não foi possível carregar os planos de internet. Por favor, tente novamente mais tarde.
        </p>
      `;
    }
  }

  // Lógica para copiar o código PIX
  if (copyPixButton) {
    copyPixButton.addEventListener("click", () => {
      pixCodeTextarea.select();
      try {
        document.execCommand("copy");
        console.info(
          "[FRONTEND] Código PIX copiado para a área de transferência."
        );
      } catch (err) {
        console.error("[ERRO][FRONTEND] Falha ao copiar o texto:", err);
      }
    });
  }

  // Conecta ao WebSocket
  function connectWebSocket(mac) {
    if (!mac) {
      console.warn(
        "[WEBSOCKET] MAC Address não fornecido para conexão WebSocket."
      );
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}?mac=${mac}`
    );

    ws.onopen = () => console.log("WebSocket conectado!");

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === "APPROVED") {
        console.log(
          "Pagamento aprovado via WebSocket! Preparando redirecionamento..."
        );
        showSuccessScreen(data.loginUrl);
      }
    };

    ws.onclose = () => {
      console.log(
        "WebSocket desconectado. Tentando reconectar em 5 segundos..."
      );
      setTimeout(() => connectWebSocket(mac), 5000);
    };

    ws.onerror = (error) => {
      console.error("[WEBSOCKET] Erro no WebSocket:", error);
    };
  }

  // --- Lógica de inicialização da página ---
  // 1. Conecta o WebSocket
  connectWebSocket(macAddress);

  // 2. Verifica se já há um pagamento aprovado
  if (macAddress && loginUrlBase) {
    console.info(
      "[FRONTEND] Verificando pagamento anterior para MAC:",
      macAddress
    );
    plansContainer.classList.add("hidden");
    paymentSection.classList.add("hidden");
    successSection.classList.add("hidden");
    spinner.classList.remove("hidden");
    statusMessage.textContent = "Verificando status do seu acesso...";

    try {
      const response = await fetch(
        `/check-payment-status?mac=${macAddress}&loginUrl=${encodeURIComponent(
          loginUrlBase
        )}`
      );
      spinner.classList.add("hidden");

      if (response.ok) {
        const data = await response.json();
        if (data.status === "APPROVED" && data.loginUrl) {
          console.info(
            "[FRONTEND] Pagamento anterior APROVADO encontrado. Redirecionando..."
          );
          showSuccessScreen(data.loginUrl);
        } else {
          console.info(
            "[FRONTEND] Nenhum pagamento APROVADO encontrado ou URL inválida. Carregando planos."
          );
          loadAndRenderPlans();
        }
      } else if (response.status === 404) {
        console.info(
          "[FRONTEND] Nenhum pagamento APROVADO encontrado. Carregando planos."
        );
        loadAndRenderPlans();
      } else {
        const errorData = await response.json();
        console.error(
          "[ERRO][FRONTEND] Erro ao verificar pagamento anterior:",
          errorData.error || response.statusText
        );
        showErrorMessage(
          "Erro ao verificar seu status de pagamento anterior. Tente novamente."
        );
      }
    } catch (error) {
      spinner.classList.add("hidden");
      console.error(
        "[ERRO][FRONTEND] Erro de rede ao verificar pagamento anterior:",
        error
      );
      showErrorMessage(
        "Problema de conexão ao verificar seu status. Tente novamente."
      );
    }
  } else {
    console.warn(
      "[FRONTEND] MAC Address ou Login URL ausente na URL. Carregando planos diretamente."
    );
    loadAndRenderPlans();
  }
});
