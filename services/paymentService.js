// services/paymentService.js
const { Payment } = require("mercadopago");

let client; // A instância do cliente MercadoPago será armazenada aqui

// Função para inicializar o serviço com as credenciais
function initializePaymentService(mpClient) {
  client = mpClient;
  console.info(
    "[PAYMENT SERVICE] Serviço de pagamento inicializado com sucesso."
  );
}

// Função para criar um pagamento com PIX (você já tinha algo similar)
async function createPixPayment(paymentData) {
  const payment = new Payment(client);
  try {
    console.log("[PAYMENT SERVICE] Criando pagamento PIX...");
    const result = await payment.create({ body: paymentData });
    console.log("[PAYMENT SERVICE] Resposta da criação de PIX recebida.");
    return {
      mpPaymentId: result.id,
      qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      qrCodeText: result.point_of_interaction.transaction_data.qr_code,
    };
  } catch (error) {
    console.error(
      "[ERRO][PAYMENT SERVICE] Falha ao criar pagamento PIX:",
      error.cause || error.message
    );
    throw error;
  }
}

// Função para criar um pagamento com Cartão
async function createCardPayment(paymentData) {
  const payment = new Payment(client);
  try {
    console.log(
      "[PAYMENT SERVICE] Enviando dados do cartão para o Mercado Pago..."
    );
    console.log("[PAYMENT SERVICE] Dados enviados (sem o token):", {
      ...paymentData,
      token: "OMITIDO_POR_SEGURANÇA",
    });

    const result = await payment.create({ body: paymentData });

    // LOG DETALHADO DA RESPOSTA DO MERCADO PAGO
    console.log(
      "[PAYMENT SERVICE] Resposta completa do processamento do cartão recebida:",
      result
    );
    return result;
  } catch (error) {
    console.error(
      "[ERRO GRAVE][PAYMENT SERVICE] Falha ao criar pagamento com cartão:",
      error.cause || error.message
    );
    throw error;
  }
}

// Função para consultar o status de um pagamento
async function getPaymentStatus(paymentId) {
  const payment = new Payment(client);
  try {
    const result = await payment.get({ id: paymentId });
    return result.status;
  } catch (error) {
    console.error(
      `[ERRO][PAYMENT SERVICE] Falha ao consultar status do pagamento ID ${paymentId}:`,
      error.cause || error.message
    );
    throw error;
  }
}

module.exports = {
  initializePaymentService,
  createPixPayment,
  createCardPayment,
  getPaymentStatus,
};
