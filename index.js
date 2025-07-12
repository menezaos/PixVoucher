// Carrega as variáveis de ambiente do arquivo .env
require("dotenv").config();

const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { RouterOSAPI } = require("node-routeros");
const WebSocket = require("ws");

// --- Configurações Iniciais ---
const app = express();
const port = process.env.PORT || 3000;

console.info("[DB] Configurando pool de conexão com MariaDB...");
const db = mysql.createPool(process.env.DATABASE_URL);

console.info("[MERCADOPAGO] Configurando cliente da API...");
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});
const mpPayment = new Payment(mpClient);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Lógica de Planos ---
// ATENÇÃO: Estes planos devem ser a fonte da verdade para o frontend e backend.
// Adicionado 'durationHours' para a lógica de expiração do plano.
const plans = {
  1: {
    id: "1",
    name: "2MB",
    price: 1.0,
    profile: "plano_1hora_2mega",
    durationHours: 1,
  }, // Plano de 1 hora
  2: {
    id: "2",
    name: "5MB",
    price: 2.0,
    profile: "plano_1hora_5mega",
    durationHours: 1,
  }, // Plano de 24 horas (1 dia)
  // Adicione outros planos conforme necessário, com IDs e durações correspondentes
};

// --- Servidor WebSocket ---
const wss = new WebSocket.Server({ noServer: true });
const clients = new Map(); // Mapeia MAC Address para WebSocket
wss.on("connection", (ws, req) => {
  const mac = new URL(req.url, `http://${req.headers.host}`).searchParams.get(
    "mac"
  );
  if (mac) {
    clients.set(mac, ws);
    console.info(`[WEBSOCKET] Cliente conectado: ${mac}`);
    ws.on("close", () => {
      clients.delete(mac);
      console.info(`[WEBSOCKET] Cliente desconectado: ${mac}`);
    });
    ws.on("error", (error) => {
      console.error(`[WEBSOCKET] Erro no cliente ${mac}:`, error);
    });
  } else {
    console.warn("[WEBSOCKET] Conexão recusada: MAC Address não fornecido.");
    ws.close();
  }
});

// --- ROTAS DA API ---
app.get("/", (req, res) => {
  console.info(
    `[ROTA /] Requisição recebida. MAC: ${req.query.mac || "N/A"}, IP: ${
      req.query.ip || "N/A"
    }`
  );
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Rota para retornar os planos para o frontend
app.get("/api/plans", (req, res) => {
  console.info("[API] Requisição para /api/plans recebida.");
  // Retorna apenas os dados relevantes para o frontend
  const formattedPlans = Object.values(plans).map((plan) => ({
    id: plan.id,
    name: plan.name,
    price: plan.price,
  }));
  res.json(formattedPlans);
});

// NOVA ROTA: Verifica o status do pagamento e tenta autenticar, considerando a duração do plano
app.get("/check-payment-status", async (req, res) => {
  const macAddress = req.query.mac;
  const loginUrl = req.query.loginUrl;

  console.info(`[CHECK PAYMENT] Verificando status para MAC: ${macAddress}`);

  if (!macAddress || !loginUrl) {
    console.warn("[CHECK PAYMENT] MAC Address ou Login URL ausente.");
    return res
      .status(400)
      .json({ error: "MAC Address e Login URL são obrigatórios." });
  }

  try {
    // Busca o pagamento mais recente APROVADO para este MAC
    // CORREÇÃO: Adicionado 'user_mac_address' na seleção da query SQL
    const [rows] = await db.execute(
      "SELECT id, plan_name, paid_at, mikrotik_login_url, user_mac_address FROM payments WHERE user_mac_address = ? AND status = 'PAID' ORDER BY paid_at DESC LIMIT 1",
      [macAddress]
    );

    if (rows.length > 0) {
      const paymentRecord = rows[0];
      const plan = Object.values(plans).find(
        (p) => p.name === paymentRecord.plan_name
      );

      if (!plan) {
        console.warn(
          `[CHECK PAYMENT] Plano '${paymentRecord.plan_name}' não encontrado para o pagamento ID: ${paymentRecord.id}.`
        );
        return res.status(404).json({
          status: "NOT_PAID",
          message: "Plano associado ao pagamento não encontrado.",
        });
      }

      const paidAt = new Date(paymentRecord.paid_at);
      // Calcula o tempo de expiração: paid_at + durationHours em milissegundos
      const expirationTime = new Date(
        paidAt.getTime() + plan.durationHours * 60 * 60 * 1000
      );
      const currentTime = new Date();

      console.info(
        `[CHECK PAYMENT] Pagamento ID: ${paymentRecord.id}, Plano: ${
          plan.name
        }, Pago em: ${paidAt.toISOString()}, Expira em: ${expirationTime.toISOString()}, Agora: ${currentTime.toISOString()}`
      );

      if (currentTime < expirationTime) {
        console.info(
          `[CHECK PAYMENT] Pagamento APROVADO e ainda VÁLIDO para MAC: ${macAddress}, ID: ${paymentRecord.id}`
        );

        // Usa a URL de login original salva no DB, ou a da query se for mais recente/confiável
        paymentRecord.mikrotik_login_url =
          paymentRecord.mikrotik_login_url || loginUrl;

        const mikrotikLoginUrl = await releaseUserOnMikrotik(paymentRecord);
        console.info(
          `[CHECK PAYMENT] URL de auto-login gerada: ${mikrotikLoginUrl}`
        );
        return res.json({ status: "APPROVED", loginUrl: mikrotikLoginUrl });
      } else {
        console.info(
          `[CHECK PAYMENT] Pagamento ID: ${paymentRecord.id} EXPIRADO para MAC: ${macAddress}.`
        );
        return res.status(404).json({
          status: "EXPIRED",
          message: "Seu plano expirou. Por favor, selecione um novo plano.",
        });
      }
    } else {
      console.info(
        `[CHECK PAYMENT] Nenhum pagamento APROVADO encontrado para MAC: ${macAddress}`
      );
      return res.status(404).json({ status: "NOT_PAID" });
    }
  } catch (error) {
    console.error(
      "[ERRO][CHECK PAYMENT] Falha ao verificar status de pagamento:",
      error
    );
    return res
      .status(500)
      .json({ error: "Erro interno ao verificar pagamento." });
  }
});

app.post("/generate-payment", async (req, res) => {
  const { planId, macAddress, ipAddress, loginUrl } = req.body;
  const plan = plans[planId];
  console.info(
    `[PAGAMENTO] Tentativa de gerar PIX para MAC: ${macAddress} com Plano: ${plan?.name}`
  );

  if (!plan || !macAddress || !loginUrl) {
    console.warn(`[PAGAMENTO] Requisição inválida: dados ausentes.`, req.body);
    return res.status(400).json({ error: "Dados insuficientes." });
  }

  let internalPaymentId;
  try {
    const [dbResult] = await db.execute(
      "INSERT INTO payments (plan_name, price, user_mac_address, mikrotik_login_url, status) VALUES (?, ?, ?, ?, ?)",
      [plan.name, plan.price, macAddress, loginUrl, "PENDING"]
    );
    internalPaymentId = dbResult.insertId;
    console.info(`[DB] Pagamento interno ID ${internalPaymentId} registrado.`);
  } catch (dbError) {
    console.error(
      "[ERRO][DB] Falha ao inserir pagamento no banco de dados:",
      dbError
    );
    return res.status(500).json({ error: "Erro interno ao registrar pedido." });
  }

  try {
    const paymentData = {
      body: {
        transaction_amount: plan.price,
        description: `Voucher Wi-Fi: ${plan.name}`,
        payment_method_id: "pix",
        payer: { email: `cliente_${internalPaymentId}@seudominio.com` },
        notification_url: `${process.env.APP_PUBLIC_URL}/webhook/mercadopago`,
        external_reference: internalPaymentId.toString(),
      },
    };
    const result = await mpPayment.create(paymentData);
    console.info(`[MERCADOPAGO] Pagamento MP ID ${result.id} gerado.`);

    await db.execute("UPDATE payments SET mercadopago_id = ? WHERE id = ?", [
      result.id,
      internalPaymentId,
    ]);
    console.info(`[DB] Pagamento MP ID ${result.id} atualizado no DB.`);

    res.json({
      qrCodeBase64: result.point_of_interaction.transaction_data.qr_code_base64,
      qrCodeText: result.point_of_interaction.transaction_data.qr_code,
    });
  } catch (mpError) {
    console.error(
      "[ERRO][MERCADOPAGO] Falha ao gerar PIX:",
      mpError?.cause ?? mpError
    );
    res
      .status(500)
      .json({ error: "Erro ao se comunicar com o sistema de pagamentos." });
  }
});

app.post("/webhook/mercadopago", async (req, res) => {
  console.info(
    `[WEBHOOK] Notificação recebida do MercadoPago. Tipo: ${req.body.type}, ID: ${req.body.data?.id}`
  );
  if (req.body.type === "payment") {
    const paymentId = req.body.data.id;
    try {
      const paymentInfo = await mpPayment.get({ id: paymentId });
      console.info(
        `[WEBHOOK] Status do pagamento MP ${paymentId}: ${paymentInfo.status}`
      );

      if (paymentInfo.status === "approved") {
        const internalPaymentId = paymentInfo.external_reference;
        const [rows] = await db.execute(
          "SELECT * FROM payments WHERE id = ? AND status = ?",
          [internalPaymentId, "PENDING"]
        );

        if (rows.length > 0) {
          const paymentRecord = rows[0];
          await db.execute(
            "UPDATE payments SET status = ?, paid_at = NOW() WHERE id = ?",
            ["PAID", internalPaymentId]
          );
          console.info(
            `[DB] Pagamento interno ID ${internalPaymentId} marcado como PAGO.`
          );

          const mikrotikLoginUrl = await releaseUserOnMikrotik(paymentRecord);
          console.info(
            `[MIKROTIK API] URL de login gerada: ${mikrotikLoginUrl}`
          );

          const clientWs = clients.get(paymentRecord.user_mac_address);
          if (clientWs?.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({ status: "APPROVED", loginUrl: mikrotikLoginUrl })
            );
            console.info(
              `[WEBSOCKET] Notificação de APROVADO com URL de login enviada para ${paymentRecord.user_mac_address}.`
            );
          } else {
            console.warn(
              `[WEBSOCKET] Cliente ${paymentRecord.user_mac_address} não encontrado ou WebSocket não está aberto.`
            );
          }
        } else {
          console.warn(
            `[WEBHOOK] Pagamento interno ID ${internalPaymentId} não encontrado ou já processado.`
          );
        }
      } else {
        console.info(
          `[WEBHOOK] Pagamento MP ${paymentId} não está APROVADO (status: ${paymentInfo.status}).`
        );
      }
    } catch (error) {
      console.error("[ERRO][WEBHOOK] Falha ao processar notificação:", error);
    }
  }
  res.sendStatus(200);
});

// ================================================================
// VERSÃO FINAL DA FUNÇÃO USANDO 'node-routeros-api'
// Retorna a URL de login para o frontend
// ================================================================
async function releaseUserOnMikrotik(paymentRecord) {
  const { user_mac_address, plan_name, mikrotik_login_url } = paymentRecord;
  const plan = Object.values(plans).find((p) => p.name === plan_name);

  if (!plan) {
    console.error(
      `[ERRO][MIKROTIK API] Plano '${plan_name}' não encontrado para o registro de pagamento.`
    );
    throw new Error(`Plano '${plan_name}' não encontrado.`);
  }

  const username = user_mac_address;
  const password = Math.random().toString(36).substring(2, 8);

  const mikrotikConfig = {
    host: process.env.MIKROTIK_HOST,
    user: process.env.MIKROTIK_API_USER,
    password: process.env.MIKROTIK_API_PASSWORD,
  };
  let client;

  console.log(`[MIKROTIK API] Tentando conectar em ${mikrotikConfig.host}...`);

  try {
    client = new RouterOSAPI(mikrotikConfig);
    await client.connect();
    console.info(`[MIKROTIK API] Conectado!`);

    const activeUsers = await client.write("/ip/hotspot/active/print", [
      `?mac-address=${user_mac_address}`,
    ]);

    if (activeUsers.length > 0) {
      console.log(
        `[MIKROTIK API] Usuário ${user_mac_address} encontrado na lista 'active'. Removendo...`
      );
      for (const user of activeUsers) {
        await client.write("/ip/hotspot/active/remove", [
          `=.id=${user[".id"]}`,
        ]);
      }
      console.info(
        `[MIKROTIK API] Usuário ${user_mac_address} removido da lista 'active'.`
      );
    }

    const existingUsers = await client.write("/ip/hotspot/user/print", [
      `?name=${username}`,
    ]);

    if (existingUsers.length > 0) {
      console.log(
        `[MIKROTIK API] Usuário ${username} já existe. Atualizando...`
      );
      await client.write("/ip/hotspot/user/set", [
        `=.id=${existingUsers[0][".id"]}`,
        `=password=${password}`,
        `=profile=${plan.profile}`,
        `=comment=Pagamento ID: ${paymentRecord.id} - Atualizado`,
      ]);
      console.info(`[MIKROTIK API] Usuário ${username} atualizado.`);
    } else {
      console.log(`[MIKROTIK API] Usuário ${username} não existe. Criando...`);
      await client.write("/ip/hotspot/user/add", [
        `=name=${username}`,
        `=password=${password}`,
        `=mac-address=${user_mac_address}`,
        `=profile=${plan.profile}`,
        `=comment=Pagamento ID: ${paymentRecord.id}`,
      ]);
      console.info(`[MIKROTIK API] Usuário ${username} criado.`);
    }

    const autoLoginUrl = `${mikrotik_login_url}?username=${encodeURIComponent(
      username
    )}&password=${encodeURIComponent(password)}`;
    console.info(
      `[MIKROTIK API] URL de auto-login construída: ${autoLoginUrl}`
    );

    return autoLoginUrl;
  } catch (err) {
    console.error(
      "[ERRO][MIKROTIK API] Falha na comunicação ou operação:",
      err
    );
    throw err;
  } finally {
    if (client && client.connected) {
      await client.close();
      console.log("[MIKROTIK API] Conexão fechada.");
    }
  }
}

// --- Inicialização do Servidor ---
const server = app.listen(port, () => {
  console.info(`===================================================`);
  console.info(`🚀 Servidor de Voucher Wi-Fi rodando na porta ${port}`);
  console.info(`===================================================`);
});

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
