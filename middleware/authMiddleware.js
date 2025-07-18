// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");

// O segredo JWT é carregado do .env. Use um fallback APENAS para desenvolvimento.
// É CRÍTICO que este segredo seja o MESMO usado em routes/adminRoutes.js para assinar o token.
const JWT_SECRET =
  process.env.JWT_SECRET || "segredo_jwt_padrao_para_depuracao_local";

const authenticateAdmin = (req, res, next) => {
  // Log do caminho completo da requisição no middleware de autenticação
  console.log(
    `[AUTH MIDDLEWARE] Recebida requisição para: ${req.method} ${req.originalUrl} (path: ${req.path})`
  );

  // Permite que a rota POST /admin/login passe sem autenticação para gerar o token.
  if (req.path === "/login") {
    return next();
  }

  const authHeader = req.headers["authorization"];
  console.log(
    "DEBUG AUTH: Authorization Header recebido:",
    authHeader ? authHeader.substring(0, 50) + "..." : "undefined"
  );

  // Verifica se o cabeçalho Authorization existe e começa com 'Bearer '.
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn(
      "[AUTH] Acesso não autorizado a API: Token não fornecido ou formato inválido."
    );
    // Retorna 401 para requisições de API (o JS do frontend vai lidar com o redirecionamento para login).
    return res.status(401).json({
      error: "Token de autenticação não fornecido ou formato inválido.",
    });
  }

  const token = authHeader.split(" ")[1]; // Extrai o token após "Bearer "
  console.log(
    "DEBUG AUTH: Token extraído:",
    token ? token.substring(0, 20) + "..." : "Falha na extração!"
  );

  try {
    const decoded = jwt.verify(token, JWT_SECRET); // Verifica a validade do token JWT.
    req.user = decoded; // Anexa os dados decodificados do usuário à requisição.
    console.info(`[AUTH] Token validado para o usuário: ${req.user.username}`);
    next(); // Token válido, continua para a próxima função middleware/rota.
  } catch (error) {
    // Log detalhado do erro de verificação do JWT (ex: TokenExpiredError, JsonWebTokenError).
    console.error(
      `[AUTH] Erro na verificação do token JWT: ${error.name} - ${error.message}`
    );
    // Retorna 403 Forbidden para requisições de API com token inválido ou expirado.
    return res.status(403).json({ error: "Token inválido ou expirado." });
  }
};

module.exports = authenticateAdmin;
