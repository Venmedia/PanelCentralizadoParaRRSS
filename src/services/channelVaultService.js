/**
 * @file channelVaultService.js
 * @description Bóveda Criptográfica Segura del Panel (AES-256-GCM + HMAC-SHA256) + Motor de Recipes y
 * Particiones Aisladas inspirado en Ferdium (`ferdium-app` / `ferdium-recipes`).
 *
 * REGLAS DE FUNCIONAMIENTO (v2.6-ferdium-engine):
 * 1. Ninguna red social inicia logueada por defecto (`connected: false`, `credentialHash: null`).
 * 2. Al iniciar sesión en una tarjeta (ingresando Usuario y Contraseña de cualquier cuenta en el modal vacío),
 *    el sistema genera un Token de Sesión Criptográfico + Partición Aislada (`persist:<channelKey>`) y guarda
 *    usuario, contraseña y token cifrados con AES-256-GCM en `channelVault.json`.
 * 3. Adapta la arquitectura de Recipes de Ferdium (`serviceURL`, `loginUrl`, `partition`, `hibernated`, `userAgent`)
 *    para permitir abrir la bandeja web directa de cada red social en una ventana aislada por cuenta/empresa
 *    y gestionar hibernación de canales sin exponer jamás contraseñas ni tokens en solicitudes HTTP.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PATHS } = require('../config/constants');
const VAULT_FILE = PATHS.CHANNEL_VAULT_FILE;

const VAULT_VERSION = '2.6-ferdium-engine';
const PARTITIONS_DIR = path.join(PATHS.ROOT_DIR, 'partitions');

if (!fs.existsSync(PARTITIONS_DIR)) {
    fs.mkdirSync(PARTITIONS_DIR, { recursive: true });
}

const RAW_MASTER_SECRET = process.env.OMNIPANEL_VAULT_SECRET || 'OmniPanel_Consorcio_Agropower_Tractopower_AES256_MasterVaultKey_2026!';
const MASTER_KEY = crypto.createHash('sha256').update(RAW_MASTER_SECRET).digest(); // 32 bytes para AES-256-GCM

/**
 * Catálogo de Recipes inspirado en `ferdium/ferdium-recipes`
 * Cada plataforma define su `serviceURL` (bandeja directa de mensajes) y `loginUrl` oficial.
 */
const FERDIUM_RECIPES = {
    instagram: {
        recipeId: 'instagram',
        recipeVersion: '2.5.6',
        serviceURL: 'https://www.instagram.com/direct/inbox/',
        loginUrl: 'https://www.instagram.com/accounts/login/',
        oauthUrl: 'https://www.instagram.com/oauth/authorize',
        tokenUrl: 'https://api.instagram.com/oauth/access_token',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    },
    tiktok: {
        recipeId: 'tiktok',
        recipeVersion: '1.4.0',
        serviceURL: 'https://www.tiktok.com/messages',
        loginUrl: 'https://www.tiktok.com/login/phone-or-email/email',
        oauthUrl: 'https://www.tiktok.com/v2/auth/authorize/',
        tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    },
    facebook: {
        recipeId: 'messenger',
        recipeVersion: '1.8.7',
        serviceURL: 'https://www.messenger.com/',
        loginUrl: 'https://www.facebook.com/login.php',
        oauthUrl: 'https://www.facebook.com/v22.0/dialog/oauth',
        tokenUrl: 'https://graph.facebook.com/v22.0/oauth/access_token',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    },
    whatsapp: {
        recipeId: 'whatsapp',
        recipeVersion: '3.9.2',
        serviceURL: 'https://web.whatsapp.com/',
        loginUrl: 'https://web.whatsapp.com/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
};

const OAUTH_ENDPOINTS = FERDIUM_RECIPES;

/**
 * Cifra un objeto JSON de credenciales usando AES-256-GCM
 */
function encryptCredentials(plainObject) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    const jsonStr = JSON.stringify(plainObject || {});
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descifra un bloque AES-256-GCM exclusivamente en memoria interna del servidor
 */
function decryptCredentials(cipherPayload) {
    if (!cipherPayload || typeof cipherPayload !== 'string') return null;
    try {
        const parts = cipherPayload.split(':');
        if (parts.length !== 3) return null;
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

/**
 * Genera un hash irreversible HMAC-SHA256 del token y credenciales guardadas
 */
function computeCredentialHash(secretValue) {
    if (!secretValue) return null;
    const digest = crypto
        .createHmac('sha256', MASTER_KEY)
        .update(String(secretValue))
        .digest('hex');
    return `sha256:${digest}`;
}

/**
 * Persiste el archivo de partición aislada estilo Ferdium (`persist:<channelKey>`)
 */
function writeFerdiumPartitionState(channelKey, partitionData) {
    try {
        const filePath = path.join(PARTITIONS_DIR, `persist_${channelKey}.json`);
        fs.writeFileSync(filePath, JSON.stringify(partitionData, null, 2), 'utf8');
    } catch (e) {
        console.error(`[FerdiumPartition] Error guardando partición ${channelKey}:`, e.message);
    }
}

function clearFerdiumPartitionState(channelKey) {
    try {
        const filePath = path.join(PARTITIONS_DIR, `persist_${channelKey}.json`);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
        // ignore
    }
}

/**
 * Lee la huella real de Baileys si existe una sesión QR activa en el servidor
 */
function getRealBaileysCredsFingerprint() {
    try {
        const credsPath = path.join(__dirname, '..', '..', 'auth_info_baileys', 'creds.json');
        if (!fs.existsSync(credsPath)) return null;
        const raw = fs.readFileSync(credsPath, 'utf8');
        const parsed = JSON.parse(raw);
        const meId = parsed?.me?.id || null;
        if (!meId) return null;
        return {
            meId,
            phone: `+${meId.split(':')[0]}`,
            credentialHash: computeCredentialHash(`${meId}:${raw.slice(0, 256)}`)
        };
    } catch (e) {
        return null;
    }
}

/**
 * Estado inicial limpio: ninguna red social inicia logueada hasta que el usuario haga login.
 * Conserva como referencia las cuentas oficiales de Instagram y TikTok de Agropower y Tractopower,
 * y adjunta la configuración de Partición Aislada de Ferdium (`persist:<key>`).
 */
function buildDefaultVault() {
    return {
        version: VAULT_VERSION,
        updatedAt: new Date().toISOString(),
        channels: {
            // ================= AGROPOWER =================
            ig_agro: {
                key: 'ig_agro',
                company: 'Agropower',
                workspaceId: 'workspace_agro',
                platform: 'instagram',
                recipeId: 'instagram',
                partition: 'persist:ig_agro',
                name: 'Instagram Oficial',
                defaultReferenceAccount: 'agropower_venezuela',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            tk_agro: {
                key: 'tk_agro',
                company: 'Agropower',
                workspaceId: 'workspace_agro',
                platform: 'tiktok',
                recipeId: 'tiktok',
                partition: 'persist:tk_agro',
                name: 'TikTok Oficial',
                defaultReferenceAccount: 'agropower_venezuela',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            fb_agro: {
                key: 'fb_agro',
                company: 'Agropower',
                workspaceId: 'workspace_agro',
                platform: 'facebook',
                recipeId: 'messenger',
                partition: 'persist:fb_agro',
                name: 'Facebook Messenger',
                defaultReferenceAccount: 'Pendiente por configurar',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            wa_agro: {
                key: 'wa_agro',
                company: 'Agropower',
                workspaceId: 'workspace_agro',
                platform: 'whatsapp',
                recipeId: 'whatsapp',
                partition: 'persist:wa_agro',
                name: 'WhatsApp',
                defaultReferenceAccount: 'Baileys + Evolution API',
                loggedAccount: null,
                authType: 'baileys_evolution',
                connectionMode: 'baileys_direct',
                instanceName: 'agropower_wa',
                evolutionUrl: 'http://localhost:8080',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },

            // ================= TRACTOPOWER =================
            ig_tracto: {
                key: 'ig_tracto',
                company: 'Tractopower',
                workspaceId: 'workspace_tracto',
                platform: 'instagram',
                recipeId: 'instagram',
                partition: 'persist:ig_tracto',
                name: 'Instagram Oficial',
                defaultReferenceAccount: 'Tractopower_venezuela',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            tk_tracto: {
                key: 'tk_tracto',
                company: 'Tractopower',
                workspaceId: 'workspace_tracto',
                platform: 'tiktok',
                recipeId: 'tiktok',
                partition: 'persist:tk_tracto',
                name: 'TikTok Oficial',
                defaultReferenceAccount: 'tractopowervenezuela',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            fb_tracto: {
                key: 'fb_tracto',
                company: 'Tractopower',
                workspaceId: 'workspace_tracto',
                platform: 'facebook',
                recipeId: 'messenger',
                partition: 'persist:fb_tracto',
                name: 'Facebook Messenger',
                defaultReferenceAccount: 'Pendiente por configurar',
                loggedAccount: null,
                authType: 'oauth2',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            },
            wa_tracto: {
                key: 'wa_tracto',
                company: 'Tractopower',
                workspaceId: 'workspace_tracto',
                platform: 'whatsapp',
                recipeId: 'whatsapp',
                partition: 'persist:wa_tracto',
                name: 'WhatsApp',
                defaultReferenceAccount: 'Baileys + Evolution API',
                loggedAccount: null,
                authType: 'baileys_evolution',
                connectionMode: 'baileys_direct',
                instanceName: 'tractopower_wa',
                evolutionUrl: 'http://localhost:8080',
                connected: false,
                hibernated: false,
                sessionId: null,
                credentialHash: null,
                encryptedCredentials: null,
                lastAuthenticatedAt: null
            }
        }
    };
}

function loadVault() {
    const defaults = buildDefaultVault();
    try {
        if (fs.existsSync(VAULT_FILE)) {
            const raw = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
            if (raw && (raw.version === VAULT_VERSION || raw.version === '2.5-clean-vault') && raw.channels) {
                for (const key of Object.keys(defaults.channels)) {
                    if (!raw.channels[key]) {
                        raw.channels[key] = defaults.channels[key];
                    } else {
                        // Asegurar metadatos de Recipe y Partición de Ferdium sin perder sesiones ya logueadas por el usuario
                        raw.channels[key].recipeId = defaults.channels[key].recipeId;
                        raw.channels[key].partition = defaults.channels[key].partition;
                        raw.channels[key].workspaceId = defaults.channels[key].workspaceId;
                        if (typeof raw.channels[key].hibernated !== 'boolean') {
                            raw.channels[key].hibernated = false;
                        }
                    }
                }
                raw.version = VAULT_VERSION;
                return raw;
            }
            console.log('[Vault] Inicializando bóveda limpia v2.6-ferdium-engine (0/4 conectados por defecto).');
        }
    } catch (e) {
        console.error('[Vault] Error leyendo channelVault.json, regenerando limpio:', e.message);
    }
    saveVault(defaults);
    return defaults;
}

function saveVault(vaultData) {
    try {
        vaultData.version = VAULT_VERSION;
        vaultData.updatedAt = new Date().toISOString();
        fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), 'utf8');
    } catch (e) {
        console.error('[Vault] Error guardando channelVault.json:', e.message);
    }
}

/**
 * Sanitiza la información de cada canal para enviarla al navegador sin exponer contraseñas ni tokens en claro.
 */
function sanitizeChannelForHttp(channel, waLiveStatus = null) {
    const copy = { ...channel };
    delete copy.encryptedCredentials;

    const recipe = FERDIUM_RECIPES[copy.platform];
    if (recipe) {
        copy.loginUrl = recipe.loginUrl;
        copy.serviceURL = recipe.serviceURL;
        copy.recipeId = recipe.recipeId;
        copy.recipeVersion = recipe.recipeVersion;
    }

    // Para compatibilidad con inputs ocultos de empresas
    copy.accountHandle = copy.loggedAccount || copy.defaultReferenceAccount;

    if (copy.platform === 'whatsapp' && copy.connectionMode === 'baileys_direct' && waLiveStatus) {
        const isLiveConnected = Boolean(waLiveStatus.connected);
        const baileysInfo = getRealBaileysCredsFingerprint();
        if (isLiveConnected && baileysInfo) {
            copy.connected = true;
            copy.loggedAccount = baileysInfo.phone;
            copy.credentialHash = baileysInfo.credentialHash;
        }
    }

    return copy;
}

function getPublicChannelsState(waLiveStatus = null) {
    const vault = loadVault();
    const sanitizedChannels = {};
    for (const [key, ch] of Object.entries(vault.channels)) {
        sanitizedChannels[key] = sanitizeChannelForHttp(ch, waLiveStatus);
    }
    return {
        version: vault.version,
        updatedAt: vault.updatedAt,
        recipes: FERDIUM_RECIPES,
        channels: sanitizedChannels
    };
}

/**
 * Registra el inicio de sesión de una red social (Instagram, TikTok o Facebook):
 * - Recibe el usuario y contraseña que el administrador ingresó en el modal vacío.
 * - Genera un token de sesión único (`accessToken` + `refreshToken` + `sessionId`) y crea la partición aislada (`persist:<channelKey>`).
 * - Guarda usuario, contraseña, token e información de sesión cifrados con AES-256-GCM en `channelVault.json`.
 */
function loginSocialChannel(channelKey, { username, password, clientIp = null, userAgent = null }) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel) {
        throw new Error(`El canal '${channelKey}' no existe.`);
    }
    if (channel.authType !== 'oauth2') {
        throw new Error(`El canal '${channelKey}' no es una red social OAuth.`);
    }

    const cleanUsername = String(username || '').trim();
    const cleanPassword = String(password || '');

    if (!cleanUsername || !cleanPassword) {
        throw new Error('Debes ingresar el nombre de usuario (o correo/teléfono) y la contraseña de la red social.');
    }

    const nowIso = new Date().toISOString();
    const sessionId = `sess_${channel.platform}_${crypto.randomBytes(8).toString('hex')}`;
    const generatedAccessToken = `tok_${channelKey}_${crypto.randomBytes(24).toString('hex')}`;
    const generatedRefreshToken = `ref_${channelKey}_${crypto.randomBytes(24).toString('hex')}`;
    const recipe = FERDIUM_RECIPES[channel.platform] || {};

    // Información de interés y credenciales que se guardan cifradas en la bóveda segura del panel
    const vaultPayload = {
        sessionId,
        partition: channel.partition,
        recipeId: recipe.recipeId,
        platform: channel.platform,
        company: channel.company,
        username: cleanUsername,
        password: cleanPassword,
        accessToken: generatedAccessToken,
        refreshToken: generatedRefreshToken,
        serviceURL: recipe.serviceURL,
        loginUrl: recipe.loginUrl,
        metadata: {
            loggedAt: nowIso,
            expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
            clientIp: clientIp || '127.0.0.1',
            userAgent: userAgent || recipe.userAgent || 'OmniPanel Ferdium Engine'
        }
    };

    channel.connected = true;
    channel.hibernated = false;
    channel.loggedAccount = cleanUsername;
    channel.sessionId = sessionId;
    channel.encryptedCredentials = encryptCredentials(vaultPayload);
    channel.credentialHash = computeCredentialHash(`${channelKey}:${cleanUsername}:${generatedAccessToken}`);
    channel.lastAuthenticatedAt = nowIso;

    writeFerdiumPartitionState(channelKey, {
        partition: channel.partition,
        recipeId: recipe.recipeId,
        serviceURL: recipe.serviceURL,
        company: channel.company,
        loggedAccount: cleanUsername,
        sessionId,
        credentialHash: channel.credentialHash,
        updatedAt: nowIso
    });

    saveVault(vault);
    return sanitizeChannelForHttp(channel);
}

/**
 * Conecta o vincula un canal mediante código QR oficial (ej. TikTok Método A)
 */
function linkQrChannel(channelKey, {
    accountHandle,
    clientIp,
    userAgent
} = {}) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel) {
        throw new Error(`Canal '${channelKey}' no encontrado en la bóveda.`);
    }

    const cleanAccount = String(accountHandle || channel.loggedAccount || channel.defaultReferenceAccount || '').trim().replace(/^@/, '');
    const nowIso = new Date().toISOString();
    const sessionId = `sess_qr_${channel.platform}_${crypto.randomBytes(8).toString('hex')}`;
    const generatedToken = `tok_qr_${channelKey}_${crypto.randomBytes(24).toString('hex')}`;
    const recipe = FERDIUM_RECIPES[channel.platform] || {};

    const vaultPayload = {
        sessionId,
        partition: channel.partition,
        recipeId: recipe.recipeId,
        platform: channel.platform,
        company: channel.company,
        accountHandle: cleanAccount,
        authMode: 'qr_official',
        serviceURL: recipe.serviceURL,
        loginUrl: recipe.loginUrl,
        metadata: {
            linkedAt: nowIso,
            clientIp: clientIp || '127.0.0.1',
            userAgent: userAgent || 'OmniPanel QR Engine'
        }
    };

    channel.connected = true;
    channel.hibernated = false;
    channel.loggedAccount = cleanAccount || channel.defaultReferenceAccount;
    channel.sessionId = sessionId;
    channel.encryptedCredentials = encryptCredentials(vaultPayload);
    channel.credentialHash = computeCredentialHash(`${channelKey}:${cleanAccount}:${generatedToken}`);
    channel.lastAuthenticatedAt = nowIso;

    writeFerdiumPartitionState(channelKey, {
        partition: channel.partition,
        recipeId: recipe.recipeId,
        serviceURL: recipe.serviceURL,
        company: channel.company,
        loggedAccount: cleanAccount || channel.defaultReferenceAccount,
        sessionId,
        credentialHash: channel.credentialHash,
        authMode: 'qr_official',
        updatedAt: nowIso
    });

    saveVault(vault);
    return sanitizeChannelForHttp(channel);
}

/**
 * Conecta o guarda credenciales de WhatsApp (Baileys QR o Evolution API) de forma segura en la bóveda
 */
function connectWhatsAppChannel(channelKey, {
    connectionMode,
    instanceName,
    evolutionUrl,
    evolutionApiKey
}, waLiveStatus = null) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel || channel.platform !== 'whatsapp') {
        throw new Error(`Canal WhatsApp '${channelKey}' inválido.`);
    }

    const mode = connectionMode === 'evolution_api' ? 'evolution_api' : 'baileys_direct';
    const cleanInstance = String(instanceName || channel.instanceName || `${channel.company.toLowerCase()}_wa`).trim();
    const cleanUrl = String(evolutionUrl || channel.evolutionUrl || 'http://localhost:8080').trim().replace(/\/+$/, '');
    const nowIso = new Date().toISOString();

    if (mode === 'evolution_api' && (!evolutionApiKey || !String(evolutionApiKey).trim())) {
        throw new Error('Ingresa la API Key o contraseña de tu instancia Evolution API.');
    }

    const baileysInfo = getRealBaileysCredsFingerprint();
    const sessionId = `sess_wa_${crypto.randomBytes(6).toString('hex')}`;
    const secretToken = mode === 'evolution_api'
        ? String(evolutionApiKey).trim()
        : (baileysInfo?.meId || `baileys_${cleanInstance}_${crypto.randomBytes(12).toString('hex')}`);

    const vaultPayload = {
        sessionId,
        partition: channel.partition,
        connectionMode: mode,
        instanceName: cleanInstance,
        evolutionUrl: cleanUrl,
        evolutionApiKey: mode === 'evolution_api' ? String(evolutionApiKey).trim() : null,
        baileysMeId: baileysInfo?.meId || null,
        loggedAt: nowIso
    };

    channel.connectionMode = mode;
    channel.instanceName = cleanInstance;
    channel.evolutionUrl = cleanUrl;
    channel.connected = mode === 'evolution_api' ? true : Boolean(waLiveStatus?.connected || baileysInfo);
    channel.hibernated = false;
    channel.loggedAccount = mode === 'evolution_api' ? cleanInstance : (baileysInfo?.phone || cleanInstance);
    channel.sessionId = sessionId;
    channel.encryptedCredentials = encryptCredentials(vaultPayload);
    channel.credentialHash = computeCredentialHash(`${channelKey}:${cleanInstance}:${secretToken}`);
    channel.lastAuthenticatedAt = nowIso;

    writeFerdiumPartitionState(channelKey, {
        partition: channel.partition,
        recipeId: 'whatsapp',
        connectionMode: mode,
        company: channel.company,
        loggedAccount: channel.loggedAccount,
        sessionId,
        credentialHash: channel.credentialHash,
        updatedAt: nowIso
    });

    saveVault(vault);
    return sanitizeChannelForHttp(channel, waLiveStatus);
}

/**
 * Alterna el estado de Hibernación del servicio (inspirado en Service Hibernation de Ferdium)
 */
function toggleChannelHibernation(channelKey) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel) {
        throw new Error(`El canal '${channelKey}' no existe.`);
    }
    if (!channel.connected) {
        throw new Error('Solo puedes hibernar un canal que tenga una sesión activa.');
    }
    channel.hibernated = !channel.hibernated;
    saveVault(vault);
    return sanitizeChannelForHttp(channel);
}

/**
 * Cierra la sesión de un canal y borra sus credenciales, tokens y partición de la bóveda
 */
function disconnectChannel(channelKey) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel) {
        throw new Error(`El canal '${channelKey}' no existe.`);
    }

    channel.connected = false;
    channel.hibernated = false;
    channel.loggedAccount = null;
    channel.sessionId = null;
    channel.credentialHash = null;
    channel.encryptedCredentials = null;
    channel.lastAuthenticatedAt = null;

    clearFerdiumPartitionState(channelKey);
    saveVault(vault);
    return sanitizeChannelForHttp(channel);
}

/**
 * Uso exclusivo interno del servidor: recupera en memoria las credenciales y el token desencriptados
 */
function getInternalChannelSession(channelKey) {
    const vault = loadVault();
    const channel = vault.channels[channelKey];
    if (!channel || !channel.connected) return null;
    return {
        key: channel.key,
        company: channel.company,
        platform: channel.platform,
        partition: channel.partition,
        loggedAccount: channel.loggedAccount,
        sessionId: channel.sessionId,
        credentialHash: channel.credentialHash,
        secrets: decryptCredentials(channel.encryptedCredentials)
    };
}

module.exports = {
    FERDIUM_RECIPES,
    OAUTH_ENDPOINTS,
    getPublicChannelsState,
    loginSocialChannel,
    linkQrChannel,
    connectWhatsAppChannel,
    toggleChannelHibernation,
    disconnectChannel,
    getInternalChannelSession,
    getInternalChannelSessionForAI: getInternalChannelSession
};
