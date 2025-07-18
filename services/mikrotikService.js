// services/mikrotikService.js
const { RouterOSAPI } = require("node-routeros");

const mikrotikConfig = {
  host: process.env.MIKROTIK_HOST,
  user: process.env.MIKROTIK_API_USER, // Certifique-se que as variáveis de ambiente estão corretas
  password: process.env.MIKROTIK_API_PASSWORD,
};

async function executeMikrotikCommand(apiCallFn) {
  let client;
  try {
    client = new RouterOSAPI(mikrotikConfig);
    await client.connect();
    return await apiCallFn(client);
  } catch (err) {
    console.error(
      "[ERRO][MIKROTIK SERVICE] Falha na comunicação ou operação:",
      err
    );
    throw err;
  } finally {
    if (client && client.connected) {
      await client.close();
    }
  }
}

async function manageHotspotProfile(profileData, isUpdate = false) {
  const {
    name,
    rateLimit = "",
    sessionTimeout = "",
    comment = "",
  } = profileData;
  console.info(
    `[MIKROTIK SERVICE] Tentando ${
      isUpdate ? "atualizar" : "criar"
    } perfil Hotspot: ${name}`
  );

  return executeMikrotikCommand(async (client) => {
    const existingProfiles = await client.write(
      "/ip/hotspot/user/profile/print",
      [`?name=${name}`]
    );
    const commands = [`=name=${name}`];

    if (rateLimit) {
      commands.push(`=rate-limit=${rateLimit}`);
    }
    if (sessionTimeout) {
      // CORREÇÃO: Usamos a string 'sessionTimeout' diretamente.
      commands.push(`=session-timeout=${sessionTimeout}`);
      console.info(
        `[MIKROTIK SERVICE] session-timeout definido como: ${sessionTimeout}`
      );
    }
    // O campo 'comment' não existe no perfil de usuário, apenas no usuário.

    if (existingProfiles.length > 0) {
      const profileId = existingProfiles[0][".id"];
      await client.write([
        "/ip/hotspot/user/profile/set",
        `=.id=${profileId}`,
        ...commands,
      ]);
      console.info(`[MIKROTIK SERVICE] Perfil '${name}' atualizado.`);
    } else if (!isUpdate) {
      await client.write(["/ip/hotspot/user/profile/add", ...commands]);
      console.info(`[MIKROTIK SERVICE] Perfil '${name}' criado.`);
    } else {
      throw new Error(`Perfil '${name}' não encontrado para atualização.`);
    }
    return true;
  });
}

async function releaseUserOnMikrotik(userData) {
  const { user_mac_address, profile, mikrotik_login_url, duration_hours } =
    userData;
  console.info(
    `[MIKROTIK SERVICE] Liberando MAC: ${user_mac_address} com perfil: ${profile}`
  );
  if (!profile) throw new Error("Nome do perfil Mikrotik não fornecido.");

  return executeMikrotikCommand(async (client) => {
    const username = user_mac_address;
    const password = Math.random().toString(36).substring(2, 8);

    let limitUptime = "";
    if (duration_hours) {
      limitUptime = `${parseInt(duration_hours, 10)}h`; // Formato correto para limit-uptime
    }

    const activeUsers = await client.write("/ip/hotspot/active/print", [
      `?mac-address=${user_mac_address}`,
    ]);
    for (const user of activeUsers) {
      await client.write(["/ip/hotspot/active/remove", `=.id=${user[".id"]}`]);
    }

    const userCommands = [
      `=name=${username}`,
      `=password=${password}`,
      `=profile=${profile}`,
      `=comment=Liberado_pelo_portal_MAC:${user_mac_address}`,
    ];
    if (limitUptime) {
      userCommands.push(`=limit-uptime=${limitUptime}`);
    }

    const existingUsers = await client.write("/ip/hotspot/user/print", [
      `?name=${username}`,
    ]);
    if (existingUsers.length > 0) {
      await client.write([
        "/ip/hotspot/user/set",
        `=.id=${existingUsers[0][".id"]}`,
        ...userCommands,
      ]);
    } else {
      await client.write(["/ip/hotspot/user/add", ...userCommands]);
    }

    return `${mikrotik_login_url}?username=${encodeURIComponent(
      username
    )}&password=${encodeURIComponent(password)}`;
  });
}

async function removeHotspotProfile(profileName) {
  return executeMikrotikCommand(async (client) => {
    const existingProfiles = await client.write(
      "/ip/hotspot/user/profile/print",
      [`?name=${profileName}`]
    );
    if (existingProfiles.length > 0) {
      await client.write([
        "/ip/hotspot/user/profile/remove",
        `=.id=${existingProfiles[0][".id"]}`,
      ]);
      console.info(
        `[MIKROTIK SERVICE] Perfil Hotspot '${profileName}' removido.`
      );
      return true;
    }
    return false;
  });
}

async function generateVouchersOnMikrotik(
  profileName,
  quantity,
  duration_hours
) {
  console.info(
    `[MIKROTIK SERVICE] Gerando ${quantity} vouchers para o perfil: ${profileName} com duração de ${duration_hours}h`
  );

  return executeMikrotikCommand(async (client) => {
    const generatedVouchers = [];
    // Formata a duração para o formato que o MikroTik entende (ex: "24h")
    const limitUptime = `${parseInt(duration_hours, 10)}h`;

    for (let i = 0; i < quantity; i++) {
      const username = String(Math.floor(10000 + Math.random() * 90000));
      const password = username; // Para simplicidade, a senha é igual ao usuário

      // Monta o comando de criação do usuário
      const userCommands = [
        "/ip/hotspot/user/add",
        `=name=${username}`,
        `=password=${password}`,
        `=profile=${profileName}`,
        `=comment=Voucher_Gerado_Em_${new Date().toISOString()}`,
        // --- MUDANÇA AQUI: Adiciona o limit-uptime ao comando ---
        `=limit-uptime=${limitUptime}`,
      ];

      await client.write(userCommands);

      generatedVouchers.push({ username, password, profile: profileName });
    }
    console.info(
      `[MIKROTIK SERVICE] ${quantity} vouchers criados no Mikrotik com limit-uptime de ${limitUptime}.`
    );
    return generatedVouchers;
  });
}

module.exports = {
  releaseUserOnMikrotik,
  manageHotspotProfile,
  removeHotspotProfile,
  generateVouchersOnMikrotik,
};
