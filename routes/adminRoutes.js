// routes/adminRoutes.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const mikrotikService = require("../services/mikrotikService");

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const JWT_SECRET = process.env.JWT_SECRET;

// Rota de login do admin (POST) - Gera o token JWT.
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  console.info(`[AUTH ADMIN] Tentativa de login para usuário: ${username}`);

  if (username === ADMIN_USERNAME) {
    const isPasswordValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (isPasswordValid) {
      const token = jwt.sign({ username: ADMIN_USERNAME }, JWT_SECRET, {
        expiresIn: "1h",
      });
      console.info(
        `[AUTH ADMIN] Login bem-sucedido para: ${username}. Token gerado.`
      );
      return res.json({ success: true, token });
    }
  }
  console.warn(
    `[AUTH ADMIN] Falha de login para: ${username}. Credenciais inválidas.`
  );
  res.status(401).json({ error: "Credenciais inválidas." });
});

// Rotas de API para Planos (GET, POST, DELETE)
router.post("/api/plans", async (req, res) => {
  const {
    id,
    name,
    price,
    mikrotik_profile_name,
    duration_hours,
    rate_limit_upload,
    rate_limit_download,
    is_active = true,
  } = req.body;
  console.info(
    `[ADMIN API] Requisição para ${id ? "atualizar" : "criar"} plano: ${name}`
  );

  if (
    !name ||
    !mikrotik_profile_name ||
    price === undefined ||
    price < 0 ||
    !duration_hours ||
    duration_hours <= 0 ||
    !rate_limit_upload ||
    !rate_limit_download
  ) {
    console.warn(
      "[ADMIN API] Dados incompletos ou inválidos para plano/perfil."
    );
    return res.status(400).json({
      error: "Todos os campos do plano são obrigatórios e devem ser válidos.",
    });
  }

  const rateLimitString = `${rate_limit_upload}/${rate_limit_download}`;
  const sessionTimeoutString = `${duration_hours}h`;

  const profileComment = `Gerenciado pelo Portal Wi-Fi - Plano: ${name}`;

  try {
    await mikrotikService.manageHotspotProfile(
      {
        name: mikrotik_profile_name,
        rateLimit: rateLimitString,
        sessionTimeout: sessionTimeoutString,
        comment: profileComment, // Comment será ignorado por manageHotspotProfile, mas é passado aqui para consistência.
      },
      !!id
    );

    if (id) {
      await db.execute(
        `UPDATE plans SET name = ?, price = ?, mikrotik_profile_name = ?, duration_hours = ?, rate_limit_upload = ?, rate_limit_download = ?, is_active = ?, updated_at = NOW() WHERE id = ?`,
        [
          name,
          price,
          mikrotik_profile_name,
          duration_hours,
          rate_limit_upload,
          rate_limit_download,
          is_active,
          id,
        ]
      );
      console.info(`[DB] Plano ID ${id} atualizado.`);
    } else {
      const [result] = await db.execute(
        `INSERT INTO plans (name, price, mikrotik_profile_name, duration_hours, rate_limit_upload, rate_limit_download, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          name,
          price,
          mikrotik_profile_name,
          duration_hours,
          rate_limit_upload,
          rate_limit_download,
          is_active,
        ]
      );
      req.body.id = result.insertId;
      console.info(`[DB] Plano ID ${req.body.id} criado.`);
    }

    res.json({
      success: true,
      message: `Plano '${name}' ${id ? "atualizado" : "criado"} com sucesso.`,
      planId: id || req.body.id,
    });
  } catch (error) {
    console.error("[ERRO][ADMIN API] Falha ao gerenciar plano/perfil:", error);
    res.status(500).json({ error: "Erro interno ao gerenciar plano/perfil." });
  }
});

router.get("/api/plans", async (req, res) => {
  console.info("[ADMIN API] Requisição para listar planos para o admin.");
  const planId = req.query.id;

  try {
    let query = `SELECT id, name, price, mikrotik_profile_name, duration_hours, rate_limit_upload, rate_limit_download, is_active FROM plans ORDER BY name ASC`;
    let params = [];

    if (planId) {
      query = `SELECT id, name, price, mikrotik_profile_name, duration_hours, rate_limit_upload, rate_limit_download, is_active FROM plans WHERE id = ?`;
      params = [planId];
    }
    const [rows] = await db.execute(query, params);
    res.json(rows);
  } catch (error) {
    console.error("[ERRO][ADMIN API] Falha ao listar planos:", error);
    res.status(500).json({ error: "Erro interno ao listar planos." });
  }
});

router.delete("/api/plans/:id", async (req, res) => {
  const { id } = req.params;
  console.info(`[ADMIN API] Requisição para remover plano ID: ${id}`);

  try {
    const [planRows] = await db.execute(
      `SELECT mikrotik_profile_name FROM plans WHERE id = ?`,
      [id]
    );
    if (planRows.length === 0) {
      console.warn(`[ADMIN API] Plano ID ${id} não encontrado para remoção.`);
      return res.status(404).json({ error: "Plano não encontrado." });
    }
    const mikrotikProfileName = planRows[0].mikrotik_profile_name;

    await mikrotikService.removeHotspotProfile(mikrotikProfileName);

    await db.execute(`DELETE FROM plans WHERE id = ?`, [id]);
    console.info(`[DB] Plano ID ${id} removido.`);

    res.json({ success: true, message: "Plano removido com sucesso." });
  } catch (error) {
    console.error("[ERRO][ADMIN API] Falha ao remover plano:", error);
    res.status(500).json({ error: "Erro interno ao remover plano." });
  }
});

router.post("/api/generate-vouchers", async (req, res) => {
  const { profileName, quantity } = req.body;
  console.info(
    `[ADMIN API] Requisição para gerar ${quantity} vouchers para o perfil '${profileName}'.`
  );

  if (!profileName || !quantity || quantity <= 0) {
    return res
      .status(400)
      .json({ error: "Nome do perfil e quantidade são obrigatórios." });
  }

  try {
    // --- MUDANÇA AQUI ---
    // Buscamos o plano no nosso DB para encontrar a duração em horas
    const [planRows] = await db.execute(
      `SELECT duration_hours FROM plans WHERE mikrotik_profile_name = ? AND is_active = TRUE`,
      [profileName]
    );

    if (planRows.length === 0) {
      return res
        .status(400)
        .json({ error: "Perfil selecionado não existe ou não está ativo." });
    }
    const { duration_hours } = planRows[0];
    // --- FIM DA MUDANÇA ---

    // Passamos a duração para a função que gera os vouchers
    const vouchers = await mikrotikService.generateVouchersOnMikrotik(
      profileName,
      quantity,
      duration_hours // Novo parâmetro
    );
    res.json({ success: true, vouchers });
  } catch (error) {
    console.error("[ERRO][ADMIN API] Falha na geração de vouchers:", error);
    res
      .status(500)
      .json({ error: "Erro interno ao gerar vouchers no Mikrotik." });
  }
});

module.exports = router;
