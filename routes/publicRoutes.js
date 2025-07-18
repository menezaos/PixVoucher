// routes/publicRoutes.js (VERSÃO COMPLETA E FINAL)
const express = require("express");
const db = require("../db");
const mikrotikService = require("../services/mikrotikService");
const paymentService = require("../services/paymentService");
const WebSocket = require("ws");

const router = express.Router();

let wssInstance;
let clientsMap;

// Função que recebe as instâncias do wss e do mapa de clientes do index.js
const initializePublicRoutes = (wss, clients) => {
  wssInstance = wss;
  clientsMap = clients;
  console.info("[PUBLIC ROUTES] Rotas prontas para usar WebSockets.");
};

// ROTA PARA BUSCAR OS PLANOS
router.get("/plans", async (req, res) => {
  console.info("[API][PUBLIC] Requisição para /plans recebida.");
  try {
    const [rows] = await db.execute(
      "SELECT id, name, price, mikrotik_profile_name FROM plans WHERE is_active = TRUE ORDER BY price ASC"
    );
    const formattedPlans = rows.map((plan) => ({
      id: plan.id,
      name: plan.name,
      price: parseFloat(plan.price),
      profile: plan.mikrotik_profile_name,
    }));
    res.json(formattedPlans);
  } catch (error) {
    console.error("[ERRO][API][PUBLIC] Falha ao buscar planos do DB:", error);
    res.status(500).json({ error: "Erro interno ao buscar planos." });
  }
});

// ROTA PARA VERIFICAR PAGAMENTO EXISTENTE
router.get("/check-payment-status", async (req, res) => {
  const { mac, loginUrl } = req.query;
  if (!mac || !loginUrl) {
    return res
      .status(400)
      .json({ message: "MAC address and login URL are required." });
  }
  console.info(`[API][CHECK-STATUS] Iniciando verificação para o MAC: ${mac}`);
  try {
    console.log("[API][CHECK-STATUS] Passo 1: Consultando o banco de dados...");
    const [payments] = await db.execute(
      "SELECT p.id, p.plan_name, pl.mikrotik_profile_name, pl.duration_hours FROM payments p JOIN plans pl ON p.plan_name = pl.name WHERE p.user_mac_address = ? AND p.status = 'PAID' AND p.paid_at >= NOW() - INTERVAL pl.duration_hours HOUR",
      [mac]
    );
    console.log(
      `[API][CHECK-STATUS] Passo 2: Consulta ao DB finalizada. Encontrados ${payments.length} pagamentos ativos.`
    );

    if (payments.length > 0) {
      const payment = payments[0];
      const userData = {
        user_mac_address: mac,
        profile: payment.mikrotik_profile_name,
        mikrotik_login_url: loginUrl,
        duration_hours: payment.duration_hours,
      };
      console.log(
        "[API][CHECK-STATUS] Passo 3: Pagamento encontrado. Comunicando com o MikroTik para liberar o acesso..."
      );
      const mikrotikLoginUrl = await mikrotikService.releaseUserOnMikrotik(
        userData
      );
      console.log(
        "[API][CHECK-STATUS] Passo 4: MikroTik respondeu. Enviando URL de login para o cliente."
      );
      res.json({ status: "PAID", loginUrl: mikrotikLoginUrl });
    } else {
      console.log(
        "[API][CHECK-STATUS] Nenhum pagamento ativo encontrado. Respondendo 404."
      );
      res.status(404).json({ message: "No active payment found." });
    }
  } catch (error) {
    console.error(
      "[ERRO GRAVE][API][CHECK-STATUS] A rota de verificação falhou:",
      error
    );
    res.status(500).json({ message: "Internal server error." });
  }
});

// ROTA PARA GERAR UM PAGAMENTO PIX
router.post("/generate-payment", async (req, res) => {
  const { planId, macAddress, loginUrl } = req.body;
  console.info(
    `[PAGAMENTO] Tentativa de gerar PIX para MAC: ${macAddress} com Plano ID: ${planId}`
  );
  if (!planId || !macAddress || !loginUrl) {
    return res
      .status(400)
      .json({ error: "Dados insuficientes para gerar pagamento." });
  }
  try {
    const [planRows] = await db.execute(
      "SELECT name, price, mikrotik_profile_name FROM plans WHERE id = ? AND is_active = TRUE",
      [planId]
    );
    if (planRows.length === 0) {
      return res
        .status(400)
        .json({ error: "Plano selecionado inválido ou não disponível." });
    }
    const plan = planRows[0];
    const [dbResult] = await db.execute(
      "INSERT INTO payments (plan_name, price, user_mac_address, mikrotik_login_url, status, payment_method) VALUES (?, ?, ?, ?, ?, ?)",
      [plan.name, plan.price, macAddress, loginUrl, "PENDING", "PIX"]
    );
    const internalPaymentId = dbResult.insertId;
    const mpPaymentData = {
      transaction_amount: parseFloat(plan.price),
      description: `Voucher Wi-Fi: ${plan.name}`,
      payment_method_id: "pix",
      payer: { email: `cliente_${internalPaymentId}@seudominio.com` },
      notification_url: `${process.env.APP_PUBLIC_URL}/api/webhook/mercadopago`,
      external_reference: internalPaymentId.toString(),
    };
    const mpResult = await paymentService.createPixPayment(mpPaymentData);
    await db.execute("UPDATE payments SET mercadopago_id = ? WHERE id = ?", [
      mpResult.mpPaymentId,
      internalPaymentId,
    ]);
    res.json({
      qrCodeBase64: mpResult.qrCodeBase64,
      qrCodeText: mpResult.qrCodeText,
      internalPaymentId: internalPaymentId,
    });
  } catch (error) {
    console.error("[ERRO][PAGAMENTO] Falha ao gerar PIX:", error);
    res
      .status(500)
      .json({ error: "Erro ao se comunicar com o sistema de pagamentos." });
  }
});

// ROTA PARA RECEBER NOTIFICAÇÕES DE WEBHOOK
router.post("/webhook/mercadopago", async (req, res) => {
  const paymentNotification = req.body;
  console.info(
    `[WEBHOOK] Notificação recebida. Tipo: ${paymentNotification.type}`
  );

  if (paymentNotification.type === "payment") {
    const paymentId = paymentNotification.data.id;
    try {
      console.log(
        `[WEBHOOK] Verificando status do pagamento MP ID: ${paymentId}`
      );
      const status = await paymentService.getPaymentStatus(paymentId);

      if (status === "approved") {
        console.log(`[WEBHOOK] Pagamento APROVADO. Buscando registro no DB...`);
        const [rows] = await db.execute(
          `SELECT p.id, p.user_mac_address, p.mikrotik_login_url, pl.mikrotik_profile_name, pl.duration_hours FROM payments p JOIN plans pl ON p.plan_name = pl.name WHERE p.mercadopago_id = ? AND p.status = 'PENDING'`,
          [paymentId.toString()]
        );

        if (rows.length > 0) {
          const payment = rows[0];
          console.log(
            `[WEBHOOK] Registro encontrado para o MAC: ${payment.user_mac_address}`
          );

          await db.execute(
            "UPDATE payments SET status = 'PAID', paid_at = NOW() WHERE id = ?",
            [payment.id]
          );

          const finalLoginUrl = await mikrotikService.releaseUserOnMikrotik({
            user_mac_address: payment.user_mac_address,
            profile: payment.mikrotik_profile_name,
            mikrotik_login_url: payment.mikrotik_login_url,
            duration_hours: payment.duration_hours,
          });

          const clientWs = clientsMap.get(payment.user_mac_address);

          if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({
              status: "APPROVED",
              loginUrl: finalLoginUrl,
            });
            clientWs.send(message);
            console.info(
              `✅ [WEBHOOK] Notificação enviada para ${payment.user_mac_address}.`
            );
          } else {
            console.warn(
              `[WEBHOOK] Cliente ${payment.user_mac_address} não encontrado ou desconectado.`
            );
          }
        } else {
          console.warn(
            `[WEBHOOK] Pagamento MP ID ${paymentId} aprovado, mas não encontrado ou já processado no DB.`
          );
        }
      }
    } catch (error) {
      console.error("[ERRO][WEBHOOK] Falha ao processar notificação:", error);
    }
  }
  res.sendStatus(200);
});

module.exports = { router, initializePublicRoutes };
