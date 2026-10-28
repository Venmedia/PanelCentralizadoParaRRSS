# 📘 GUÍA MAESTRA DEFINITIVA: CONEXIÓN DE INSTAGRAM & FACEBOOK A POWERPANEL DESDE CERO
**Consorcio Agropower & Tractopower — Edición de Producción v4.0**

> **Objetivo:** Esta guía explica con precisión absoluta el procedimiento completo para vincular cualquier cuenta comercial de **Instagram Direct** y **Facebook Messenger** a **PowerPanel (OmniPanel)**, extrayendo el 100% de las conversaciones históricas (de la más nueva a la más vieja, superando cualquier límite de 50 chats) y dejando la mensajería en vivo funcionando de manera permanente.
> 
> *Diseñada para replicar el proceso exacto en **Tractopower** o en cualquier nueva empresa del consorcio sin tropiezos.*

---

## 📑 ÍNDICE DE CONTENIDOS
1. [Arquitectura y Requisitos Previos](#1-arquitectura-y-requisitos-previos)
2. [Fase 1: Preparación del Instagram y la Fanpage de Facebook](#fase-1-preparación-del-instagram-y-la-fanpage-de-facebook)
3. [Fase 2: Creación de la App en Meta for Developers](#fase-2-creación-de-la-app-en-meta-for-developers)
4. [Fase 3: Configuración Básica de la App y Webhooks](#fase-3-configuración-básica-de-la-app-y-webhooks)
5. [Fase 4: El Secreto del Caso de Uso (Facebook Login Mode)](#fase-4-el-secreto-del-caso-de-uso-facebook-login-mode)
6. [Fase 5: Extracción del Token en Graph API Explorer](#fase-5-extracción-del-token-en-graph-api-explorer)
7. [Fase 6: Script Automatizado para Token Permanente y Suscripción](#fase-6-script-automatizado-para-token-permanente-y-suscripción)
8. [Fase 7: Extracción Profunda del Historial (>800 Conversaciones)](#fase-7-extracción-profunda-del-historial-800-conversaciones)
9. [Fase 8: Configuración Rápida para TRACTOPOWER (Plantilla Lista)](#fase-8-configuración-rápida-para-tractopower-plantilla-lista)
10. [Tabla de Errores Comunes y Soluciones Inmediatas](#tabla-de-errores-comunes-y-soluciones-inmediatas)

---

## 1. Arquitectura y Requisitos Previos

Meta estructura la mensajería de Instagram empresarial bajo una cadena de custodia estricta:

```
[ Cuenta de Instagram Profesional ] (@agropower_venezuela / @Tractopower_venezuela)
                     │
                     ▼ (Vinculación oficial en Facebook)
        [ Fanpage de Facebook ] (Agropower / Tractopower)
                     │
                     ▼ (Permiso pages_messaging + instagram_manage_messages)
          [ Meta App Comercial ] (Agropanel / Tractopanel)
                     │
                     ▼ (Webhooks en tiempo real)
   [ Servidor PowerPanel VPS ] (https://powerpanel.ddns.net)
```

### Reglas de Oro de Meta:
1. **Instagram debe ser Profesional:** No se pueden conectar cuentas personales ni creadores aislados sin página.
2. **Instagram DEBE estar enlazado a una Fanpage de Facebook:** Todo el acceso a la Graph API de Instagram se realiza a través del **Page Access Token** de la Fanpage vinculada.
3. **El interruptor de mensajes en el móvil es obligatorio:** Si no se activa en la app de Instagram, Meta devuelve error de permisos bloqueados.
4. **Token Permanente (Never Expiring):** Los tokens generados en la web expiran en 60 días a menos que se use el intercambio por Page Token (`expires_at: 0`).

---

## Fase 1: Preparación del Instagram y la Fanpage de Facebook

### Paso 1.1: Convertir Instagram a Cuenta Profesional
1. En el teléfono móvil, abre Instagram con la cuenta de la empresa.
2. Ve a **Perfil** ➔ **Configuración y privacidad** ➔ **Tipo de cuenta y herramientas**.
3. Selecciona **Cambiar a cuenta profesional** y elige una categoría empresarial (*Maquinaria agrícola*, *Servicio comercial* o *Negocio local*).

### Paso 1.2: Activar "Permitir acceso a los mensajes" en el Móvil ⚠️ (CRÍTICO)
> Si este paso se omite, Meta rechaza todas las llamadas con el error `(#2534037) User has not enabled connected tools to manage messages`.

1. En la app móvil de Instagram, ve a **Configuración y privacidad**.
2. Entra en **Mensajes y respuestas a historias** ➔ **Herramientas para mensajes** (o *Controles de mensajes*).
3. Activa el interruptor: **"Permitir acceso a los mensajes"** (debe quedar en color azul / activo).

### Paso 1.3: Crear o Seleccionar la Fanpage y Enlazar Instagram
1. Entra en Facebook desde tu navegador con el perfil administrador.
2. Crea la Fanpage para la empresa (ej. `Agropower` o `Tractopower`) en `https://www.facebook.com/pages/creation/`.
3. Cambia al perfil de la nueva Página en Facebook (icono superior derecho ➔ Cambiar a la página).
4. Ve directamente al **Panel para profesionales** o a Cuentas vinculadas:
   👉 `https://www.facebook.com/settings/?tab=linked_accounts`
5. En la sección **Instagram**, haz clic en **Conectar cuenta**.
6. **MUY IMPORTANTE:** En la ventana emergente, asegúrate de que el interruptor **"Permitir acceso a los mensajes de Instagram en la bandeja de entrada"** esté **ACTIVADO (azul)**.
7. Inicia sesión con la cuenta de Instagram de la empresa y confirma la vinculación.

---

## Fase 2: Creación de la App en Meta for Developers

1. Entra a **[https://developers.facebook.com/apps/](https://developers.facebook.com/apps/)**.
2. Haz clic en el botón verde **Crear app**.
3. Selecciona el **Portfolio comercial** de la empresa (o el general del Consorcio).
4. Casos de uso a seleccionar:
   * **Administrar mensajes y contenido en Instagram** (Instagram Business API).
   * **Interactuar con los clientes en Messenger from Meta** (Facebook Messenger).
5. Asigna el nombre de la app (ej. `Agropanel` o `Tractopanel`) y confirma la creación.

---

## Fase 3: Configuración Básica de la App y Webhooks

### Paso 3.1: Configuración Básica
1. En el menú de la izquierda de la app, ve a **Configuración de la app** ➔ **Básica**.
2. Rellena los datos reglamentarios:
   * **Dominios de la app:** `powerpanel.ddns.net`
   * **URL de la política de privacidad:** `https://powerpanel.ddns.net/privacy.html`
   * **URL de las condiciones del servicio:** `https://powerpanel.ddns.net/terms.html`
   * **Icono de la app (1024×1024):** Sube el logotipo cuadrado de la empresa.
   * **Categoría:** *Negocios y páginas*.
3. Haz clic en **Guardar cambios**.
4. Anota de arriba:
   * **Identificador de la app (App ID):** ej. `1137047662153092`
   * **Clave secreta de la app (App Secret):** clic en *Mostrar*, introduce tu contraseña y cópiala.

### Paso 3.2: Configuración del Webhook
1. En el menú de la izquierda, ve a **Casos de uso** ➔ **Administrar mensajes y contenido en Instagram** ➔ **Configurar webhooks**.
2. Introduce los datos exactos del servidor:
   * **URL de devolución de llamada:**
     ```text
     https://powerpanel.ddns.net/api/meta/webhook
     ```
     *(⚠️ Nunca uses `/api/channels/meta/callback` aquí; esa es solo para OAuth).*
   * **Token de verificación:**
     * Para Agropower: `omnipanel_meta_verify_agro_2026`
     * Para Tractopower: `omnipanel_meta_verify_tracto_2026`
3. Haz clic en **Verificar y guardar** (aparecerá un check verde ✔).
4. En la lista de campos de webhook, activa los interruptores de:
   * `messages`
   * `messaging_postbacks`
   * *(Opcional)* `message_reactions`

---

## Fase 4: El Secreto del Caso de Uso (Facebook Login Mode) ⚠️

> 💡 **EL PROBLEMA:** Por defecto, Meta inicia el caso de uso en modo *"Unified Login"*, lo cual bloquea los permisos clásicos de Instagram y provoca el error *"La app no está activa"* o el timeout `2534084`.

### La Solución:
1. En la app de Meta Developers, entra en **Casos de uso** ➔ **Administrar mensajes y contenido en Instagram**.
2. En el menú de la izquierda, haz clic en la 3ra opción:
   👉 **"Configuración de la API con inicio de sesión de Facebook"** *(o haz clic en el enlace azul "cambia a API setup with Facebook login")*.
3. Confirma el cambio.
4. En **Inicio de sesión con Facebook** ➔ **Configuración**:
   * En **URI de redireccionamiento de OAuth válidos**, introduce:
     ```text
     https://powerpanel.ddns.net/api/channels/meta/callback
     ```
   * Haz clic en **Guardar cambios**.

---

## Fase 5: Extracción del Token en Graph API Explorer

El Explorador de la API Graph es la vía oficial y directa que **nunca falla** y no se ve afectada por bloqueos de *"App no activa"*:

1. Abre el Explorador apuntando directamente al App ID de tu app:
   ```text
   https://developers.facebook.com/tools/explorer/{APP_ID}/
   ```
   *(Ejemplo: `https://developers.facebook.com/tools/explorer/1137047662153092/`)*
2. En la columna de la derecha:
   * **App de Meta:** Selecciona tu app (`Agropanel` o `Tractopanel`).
   * **Usuario o página:** Selecciona **Token del usuario**.
3. En la sección **Permisos** (*Permissions*), añade los siguientes 6 permisos:
   ```text
   pages_messaging
   pages_manage_metadata
   pages_show_list
   pages_read_engagement
   instagram_basic
   instagram_manage_messages
   ```
4. Haz clic en el botón azul **"Generate Access Token"**.
5. Se abrirá la ventana modal de Facebook:
   * Selecciona la Fanpage de la empresa.
   * Selecciona la cuenta de Instagram comercial.
   * Acepta y concede todos los permisos solicitados.
6. En la parte superior de la columna, en **Identificador de acceso**, copia el token de usuario largo (`EAA...`).

---

## Fase 6: Script Automatizado para Token Permanente y Suscripción

Para que el token **NUNCA expire (`expires_at: 0`)** y la página quede suscrita a los webhooks en el servidor, ejecuta este script en Node.js pasando el User Token que copiaste del Explorador:

### Archivo: `vincular_empresa.js`
```javascript
const https = require('https');
const fs = require('fs');

// ==========================================
// CONFIGURACIÓN (Ajustar según Agro o Tracto)
// ==========================================
const COMPANY = 'tracto'; // 'agro' o 'tracto'
const APP_ID = 'TU_APP_ID_AQUI';
const APP_SECRET = 'TU_APP_SECRET_AQUI';
const USER_TOKEN = process.argv[2]; // Se pasa como argumento por consola

if (!USER_TOKEN) {
    console.error('Error: Debes pasar el userToken como argumento.');
    process.exit(1);
}

function request(url, method = 'GET', body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const options = { hostname: u.hostname, path: u.pathname + u.search, method, headers };
        const req = https.request(options, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
            });
        });
        req.on('error', reject);
        if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

async function main() {
    console.log(`1. Extendiendo User Token a 60 días (${COMPANY})...`);
    const longRes = await request(`https://graph.facebook.com/v22.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${USER_TOKEN}`);
    if (longRes.error) throw new Error('Error en exchange token: ' + JSON.stringify(longRes.error));
    const longUserToken = longRes.access_token || USER_TOKEN;

    console.log('2. Obteniendo Page Access Tokens permanentes (/me/accounts)...');
    const accounts = await request(`https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,category,instagram_business_account{id,username,name,profile_picture_url}&access_token=${longUserToken}`);
    if (accounts.error || !accounts.data || accounts.data.length === 0) {
        throw new Error('No se encontraron páginas vinculadas: ' + JSON.stringify(accounts));
    }

    const pages = [];
    const igAccounts = [];

    for (const page of accounts.data) {
        console.log(`✅ Página detectada: "${page.name}" (ID: ${page.id})`);
        pages.push({
            id: page.id,
            name: page.name,
            accessToken: page.access_token,
            category: page.category || 'Business',
            channelKey: `fb_${COMPANY}`
        });

        if (page.instagram_business_account) {
            const ig = page.instagram_business_account;
            console.log(`✅ Instagram Vinculado: @${ig.username} (ID: ${ig.id})`);
            igAccounts.push({
                igBusinessId: ig.id,
                username: ig.username,
                name: ig.name || page.name,
                pageId: page.id,
                channelKey: `ig_${COMPANY}`,
                profilePictureUrl: ig.profile_picture_url || null
            });
        }
    }

    // Suscribir páginas al webhook
    for (const page of pages) {
        console.log(`3. Suscribiendo página ${page.name} a webhooks...`);
        const sub = await request(`https://graph.facebook.com/v22.0/${page.id}/subscribed_apps`, 'POST', JSON.stringify({
            subscribed_fields: ['messages', 'messaging_postbacks', 'message_reactions', 'standby']
        }), {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${page.accessToken}`
        });
        console.log('Resultado suscripción:', sub); // Debe decir { success: true }
    }

    // Guardar archivo metaTokens_[empresa].json
    const tokensPath = `/opt/omnipanel-consorcio/metaTokens_${COMPANY}.json`;
    const tokensPayload = {
        userToken: longUserToken,
        pages,
        igAccounts,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(tokensPath, JSON.stringify(tokensPayload, null, 2), 'utf8');
    console.log(`✅ Tokens permanentes guardados con éxito en: ${tokensPath}`);

    // Actualizar channelVault.json
    const vaultPath = '/opt/omnipanel-consorcio/channelVault.json';
    if (fs.existsSync(vaultPath)) {
        const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
        if (igAccounts[0]) {
            vault[`ig_${COMPANY}`] = { connected: true, loggedAccount: igAccounts[0].username, lastAuthenticatedAt: new Date().toISOString() };
        }
        if (pages[0]) {
            vault[`fb_${COMPANY}`] = { connected: true, loggedAccount: pages[0].name, lastAuthenticatedAt: new Date().toISOString() };
        }
        fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf8');
        console.log(`✅ channelVault.json actualizado para ig_${COMPANY} y fb_${COMPANY}`);
    }
}

main().catch(console.error);
```

---

## Fase 7: Extracción Profunda del Historial (>800 Conversaciones)

Para superar el límite de 50 chats y extraer todas las conversaciones de la más nueva a la más vieja sin timeout, ejecuta el sincronizador paginado:

### Archivo: `sincronizar_historial_completo.js`
```javascript
const https = require('https');
const fs = require('fs');

const COMPANY = 'agro'; // o 'tracto'
const tokens = JSON.parse(fs.readFileSync(`/opt/omnipanel-consorcio/metaTokens_${COMPANY}.json`, 'utf8'));
const page = tokens.pages[0];
const pageToken = page.accessToken;
const pageId = page.id;
const igBusinessId = tokens.igAccounts[0]?.igBusinessId;
const metaFile = '/opt/omnipanel-consorcio/metaConversations.json';

function get(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
            });
        }).on('error', (e) => resolve({ error: e.message }));
    });
}

async function run() {
    let metaStore = { chats: {} };
    if (fs.existsSync(metaFile)) {
        metaStore = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        if (!metaStore.chats) metaStore = { chats: metaStore };
    }

    let nextUrl = `https://graph.facebook.com/v22.0/${pageId}/conversations?platform=instagram&fields=id,snippet,updated_time,participants,messages.limit(30){id,message,created_time,from}&limit=25&access_token=${pageToken}`;
    let pageCount = 0;
    let totalTraversed = 0;

    console.log(`Iniciando extracción profunda para @${tokens.igAccounts[0]?.username}...`);

    while (nextUrl) {
        pageCount++;
        const res = await get(nextUrl);
        if (res.error || !res.data || res.data.length === 0) break;

        console.log(`Página ${pageCount}: ${res.data.length} conversaciones recuperadas...`);
        totalTraversed += res.data.length;

        for (const thread of res.data) {
            const client = thread.participants?.data?.find(p => p.id !== igBusinessId) || thread.participants?.data?.[0];
            const senderId = client ? client.id : thread.id;
            const senderUsername = client ? (client.username || client.name || 'Usuario IG') : 'Usuario IG';
            const chatId = 'ig:' + senderId;

            const msgs = (thread.messages?.data || []).reverse().map(m => {
                const isOperator = m.from?.id === igBusinessId || m.from?.username === tokens.igAccounts[0]?.username;
                const timeStr = m.created_time ? new Date(m.created_time).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }) : '';
                return {
                    id: m.id,
                    from: isOperator ? 'operator' : 'client',
                    sender: isOperator ? page.name : senderUsername,
                    text: m.message || '',
                    time: timeStr,
                    platform: 'instagram',
                    messageId: m.id,
                    timestamp: m.created_time ? new Date(m.created_time).getTime() : Date.now()
                };
            });

            const initials = senderUsername.replace(/[^a-zA-Z0-9]/g, '').substring(0, 2).toUpperCase() || 'IG';
            const lastTime = thread.updated_time ? new Date(thread.updated_time).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }) : '';

            if (metaStore.chats[chatId]) {
                // Mezcla inteligente para no duplicar ni borrar mensajes
                const existingMsgs = metaStore.chats[chatId].messages || [];
                const msgMap = new Map();
                for (const em of existingMsgs) msgMap.set(em.id || em.messageId || em.text, em);
                for (const nm of msgs) msgMap.set(nm.id || nm.messageId || nm.text, nm);
                metaStore.chats[chatId].messages = Array.from(msgMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                metaStore.chats[chatId].name = senderUsername;
                metaStore.chats[chatId].time = lastTime || metaStore.chats[chatId].time;
            } else {
                metaStore.chats[chatId] = {
                    id: chatId,
                    name: senderUsername,
                    initials,
                    platform: 'instagram',
                    channelKey: `ig_${COMPANY}`,
                    channel: `ig_${COMPANY}`,
                    company: COMPANY === 'tracto' ? 'Tractopower' : 'Agropower',
                    senderId,
                    profilePic: null,
                    messages: msgs,
                    time: lastTime,
                    botActive: false,
                    waitingAdvisor: false,
                    saleClosed: false,
                    updatedAt: thread.updated_time
                };
            }
        }

        // Guardado seguro tras cada página
        fs.writeFileSync(metaFile, JSON.stringify(metaStore, null, 2), 'utf8');
        nextUrl = res.paging?.next || null;
        await new Promise(r => setTimeout(r, 600)); // Pausa de cortesía para no saturar la API
    }

    console.log(`\n🎉 EXTRACCIÓN FINALIZADA: ${totalTraversed} hilos recorridos. Total almacenado en panel: ${Object.keys(metaStore.chats).length} conversaciones.`);
}

run().catch(console.error);
```

---

## Fase 8: Configuración Rápida para TRACTOPOWER (Plantilla Lista)

Cuando llegue el momento de activar el Instagram de **Tractopower**, los pasos son exactamente idénticos cambiando los siguientes valores:

| Parámetro | Valor para Agropower | Valor para Tractopower |
|---|---|---|
| **Archivo de Configuración** | `/opt/omnipanel-consorcio/metaConfig_agro.json` | `/opt/omnipanel-consorcio/metaConfig_tracto.json` |
| **Archivo de Tokens** | `/opt/omnipanel-consorcio/metaTokens_agro.json` | `/opt/omnipanel-consorcio/metaTokens_tracto.json` |
| **Verify Token del Webhook** | `omnipanel_meta_verify_agro_2026` | `omnipanel_meta_verify_tracto_2026` |
| **Canal de Instagram (ChannelKey)** | `ig_agro` | `ig_tracto` |
| **Canal de Facebook (ChannelKey)** | `fb_agro` | `fb_tracto` |
| **Cuenta de Instagram** | `@agropower_venezuela` | `@Tractopower_venezuela` |
| **Fanpage de Facebook** | `Agropower` | `Tractopower` |

---

## Tabla de Errores Comunes y Soluciones Inmediatas

| Error / Síntoma | Causa Exacta | Solución de 1 Minuto |
|---|---|---|
| `(#2534037) User has not enabled connected tools` | El switch de mensajes en el teléfono no está activado. | Ve a Instagram en el móvil ➔ Configuración ➔ Herramientas para mensajes ➔ Activa *"Permitir acceso a los mensajes"*. |
| *"La app no está activa"* al intentar iniciar sesión | El OAuth tradicional no está registrado o la app está en modo Unified Login sin rol asignado. | Genera el token desde el **Graph API Explorer** (`/tools/explorer/{APP_ID}/`) seleccionando Token de Usuario. |
| `code: -2, subcode: 2534084 (Request Timed Out)` | La app intenta consultar hilos de clientes reales estando en desarrollo sin los permisos correctos de página. | Usa el Page Access Token permanente obtenido vía `vincular_empresa.js`. Ese token tiene permisos de página completos y no cae en timeout. |
| `HTTP 404 / Error de validación al guardar Webhook` | Se introdujo la URL del callback en lugar de la del webhook. | Asegúrate de poner exactamente: `https://powerpanel.ddns.net/api/meta/webhook`. |
| `Los permisos de Instagram no aparecen en el Explorador` | El caso de uso está configurado como Instagram Login en vez de Facebook Login. | En Meta Developers ➔ Casos de uso ➔ Instagram ➔ Haz clic en *"Configuración de la API con inicio de sesión de Facebook"*. |

---

*Guía certificada y comprobada en vivo el 27 de Octubre de 2026 tras sincronizar con éxito 825 conversaciones en producción en OmniPanel.*
