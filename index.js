// index.js (Backend Principal)

require("dotenv").config();
const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const mysql = require("mysql2/promise");
const db = mysql.createPool(process.env.DATABASE_URL);

const paymentService = require("./services/paymentService");
const authenticateAdmin = require("./middleware/authMiddleware");
const publicRoutesModule = require("./routes/publicRoutes");
const adminApiRoutes = require("./routes/adminRoutes");
const mikrotikService = require("./services/mikrotikService");

const app = express();
const port = process.env.PORT || 3000;

const { MercadoPagoConfig } = require("mercadopago");
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});
paymentService.initializePaymentService(mpClient);

app.use(express.json());

// Servir todos os arquivos estáticos a partir da raiz de 'public'
app.use(express.static(path.join(__dirname, "public")));

// Configuração do Servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });
const clients = new Map();
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
publicRoutesModule.initializePublicRoutes(wss, clients);

// Rotas de API Públicas
app.use("/api", publicRoutesModule.router);

// Rotas de API do Admin (Protegidas)
app.use("/admin", authenticateAdmin, adminApiRoutes);

// Inicialização do Servidor
const server = app.listen(port, "0.0.0.0", () => {
  console.info(`===================================================`);
  console.info(`🚀 Servidor de Voucher Wi-Fi rodando na porta ${port}`);
  console.info(`===================================================`);
  console.info(`Acesse o portal do cliente em: http://localhost:${port}`);
  console.info(
    `Acesse o painel de admin em: http://localhost:${port}/admin/login`
  );
});

// Worker de Polling de Pagamentos Pendentes
setInterval(pollPendingPayments, 30 * 1000);
console.info(
  "[POLLING WORKER] Agendamento iniciado para verificar pagamentos pendentes a cada 30 segundos."
);

// Função do Worker de Polling
async function pollPendingPayments() {
  console.info(
    "[POLLING WORKER] Iniciando verificação de pagamentos pendentes no Mercado Pago..."
  );
  try {
    const [pendingPayments] = await db.execute(
      "SELECT p.id, p.mercadopago_id, p.plan_name, p.user_mac_address, p.mikrotik_login_url, pl.mikrotik_profile_name, pl.duration_hours FROM payments p JOIN plans pl ON p.plan_name = pl.name WHERE p.status = 'PENDING' AND p.mercadopago_id IS NOT NULL AND p.created_at <= NOW() - INTERVAL 1 MINUTE"
    );

    if (pendingPayments.length === 0) {
      console.info(
        "[POLLING WORKER] Nenhum pagamento pendente para verificar ou ainda muito recente."
      );
      return;
    }

    console.info(
      `[POLLING WORKER] Encontrados ${pendingPayments.length} pagamentos pendentes para verificação.`
    );

    for (const payment of pendingPayments) {
      try {
        const mpStatus = await paymentService.getPaymentStatus(
          payment.mercadopago_id
        );

        if (mpStatus === "approved") {
          console.info(
            `[POLLING WORKER] Pagamento MP ID ${payment.mercadopago_id} (interno ID ${payment.id}) APROVADO via polling.`
          );
          await db.execute(
            "UPDATE payments SET status = ?, paid_at = NOW() WHERE id = ?",
            ["PAID", payment.id]
          );
          const userData = {
            user_mac_address: payment.user_mac_address,
            profile: payment.mikrotik_profile_name,
            mikrotik_login_url: payment.mikrotik_login_url,
            duration_hours: payment.duration_hours,
          };
          const mikrotikLoginUrl = await mikrotikService.releaseUserOnMikrotik(
            userData
          );

          const clientWs = wss.clients.get(payment.user_mac_address);
          if (clientWs?.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({ status: "APPROVED", loginUrl: mikrotikLoginUrl })
            );
            console.info(
              `[POLLING WORKER] Notificação WebSocket enviada para ${payment.user_mac_address}.`
            );
          } else {
            console.warn(
              `[POLLING WORKER] Cliente WebSocket ${payment.user_mac_address} não conectado para notificação.`
            );
          }
        } else if (["rejected", "cancelled", "refunded"].includes(mpStatus)) {
          console.warn(
            `[POLLING WORKER] Pagamento MP ID ${payment.mercadopago_id} (interno ID ${payment.id}) com status ${mpStatus}. Marcando no DB.`
          );
          await db.execute("UPDATE payments SET status = ? WHERE id = ?", [
            mpStatus.toUpperCase(),
            payment.id,
          ]);
        } else {
          console.info(
            `[POLLING WORKER] Pagamento MP ID ${payment.mercadopago_id} (interno ID ${payment.id}) ainda em ${mpStatus}.`
          );
        }
      } catch (mpError) {
        console.error(
          `[POLLING WORKER] Erro ao consultar status do MP para ID ${payment.mercadopago_id}:`,
          mpError
        );
      }
    }
  } catch (error) {
    console.error(
      "[POLLING WORKER] Erro geral na função pollPendingPayments:",
      error
    );
  }
}

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, request.socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
