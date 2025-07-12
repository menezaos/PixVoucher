document.addEventListener("DOMContentLoaded", () => {
  // ... (código para extrair parâmetros e elementos permanece o mesmo) ...
  const urlParams = new URLSearchParams(window.location.search);
  const macAddress = urlParams.get("mac");
  const plansContainer = document.getElementById("plans-container");
  const successSection = document.getElementById("success-section");

  connectWebSocket(macAddress);

  // O listener de clique no plano inteiro (para pagamento real) continua o mesmo
  document.querySelectorAll(".plan").forEach((planElement) => {
    planElement.addEventListener("click", async (event) => {
      // Impede que o clique no botão de debug acione o pagamento
      if (event.target.classList.contains("debug-plan-button")) {
        return;
      }
      // ... (lógica de pagamento real)
    });
  });

  // --- NOVA LÓGICA PARA OS BOTÕES DE DEBUG DE CADA PLANO ---
  document.querySelectorAll(".debug-plan-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation(); // Impede que o clique se propague para o card do plano

      const planCard = event.target.closest(".plan");
      const planId = planCard.dataset.id; // Pega o ID do plano pai

      if (!macAddress) {
        alert("Erro: MAC Address não encontrado na URL.");
        return;
      }

      plansContainer.classList.add("hidden");
      successSection.classList.remove("hidden");

      try {
        // Envia o MAC e o planId para a rota de debug
        await fetch("/debug-release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ macAddress, planId }), // Enviando o ID do plano!
        });
      } catch (error) {
        console.error("Erro ao chamar o debug:", error);
        alert("Ocorreu um erro ao tentar liberar o acesso de debug.");
      }
    });
  });

  function connectWebSocket(mac) {
    // ... (função WebSocket permanece a mesma) ...
  }
});
