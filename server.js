// Forzar zona horaria oficial del Consorcio a nivel de proceso Node.js (Venezuela / America/Caracas = UTC-4)
process.env.TZ = 'America/Caracas';
require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const whatsappService = require('./whatsappService');
const { PATHS } = require('./src/config/constants');
const { loadBotConfig } = require('./src/services/storageService');
const { evaluateSchedule } = require('./src/services/scheduleService');
const { initWhatsAppHandler } = require('./src/services/whatsappHandler');
const {
  securityHeaders,
  sanitizeRequest,
  apiRateLimiter
} = require('./src/middleware/securityMiddleware');

const createAuthRouter = require('./src/routes/authRoutes');
const createWhatsAppRouter = require('./src/routes/whatsappRoutes');
const createConversationRouter = require('./src/routes/conversationRoutes');
const createConfigRouter = require('./src/routes/configRoutes');
const createUserRouter = require('./src/routes/userRoutes');
const createAnalyticsRouter = require('./src/routes/analyticsRoutes');
const createChannelAuthRouter = require('./src/routes/channelAuthRoutes');
const createMetaWebhookRouter = require('./src/routes/metaWebhookRoutes');
const { startInstagramAutoSync } = require('./src/services/metaApiService');
const { initializeMetaConversationPersistence } = require('./src/services/metaApiService');
const { initializePostgres } = require('./src/db');
const analyticsService = require('./src/services/analyticsService');

// Inicializar servicio de analíticas (migración legacy, purga, directorio)
analyticsService.initialize();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Desactivar cabecera X-Powered-By y habilitar confianza en Reverse Proxy (Nginx / powerpanel.ddns.net)
app.disable('x-powered-by');
app.set('trust proxy', 1);

// 1. Capa de Seguridad Modular (Cabeceras HTTP, CORS, Sanitización Anti-XSS/Inyección, Rate Limit)
app.use(securityHeaders);
app.use(compression({ threshold: 1024 }));
const allowedOrigins = String(process.env.CORS_ORIGINS || 'https://powerpanel.ddns.net,http://localhost:3000')
  .split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => (!origin || allowedOrigins.includes(origin))
    ? callback(null, true)
    : callback(new Error('Origen no permitido por CORS')),
  credentials: true
}));
app.use(express.json({ limit: '35mb', strict: true }));
app.use(sanitizeRequest);
app.use('/api/', apiRateLimiter);

const persistenceReady = initializePostgres()
  .then(() => initializeMetaConversationPersistence())
  .catch(error => {
    console.error('[Persistence] PostgreSQL no disponible:', error.message);
  });

// 2. Servir Archivos Estáticos y Vista de Login
app.get('/login', (req, res) => {
  res.sendFile(path.join(PATHS.PUBLIC_DIR, 'index.html'));
});
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); next(); });
app.use(express.static(PATHS.PUBLIC_DIR));

// 3. Inicializar Manejador Modular de WhatsApp en Tiempo Real
initWhatsAppHandler(io);

// 4. Montar Rutas Modulares de la API
app.use('/api/auth', createAuthRouter(io));
app.use('/api/whatsapp', createWhatsAppRouter(io));
app.use('/api', createConversationRouter(io));
app.use('/api/config', createConfigRouter(io));
app.use('/api/users', createUserRouter(io));
app.use('/api/analytics', createAnalyticsRouter());
app.use('/api/channels', createChannelAuthRouter(io, whatsappService));
app.use('/api/meta', createMetaWebhookRouter(io));

// 5. Iniciar Servidor HTTP + WebSocket
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  await persistenceReady;
  const config = loadBotConfig();
  const sched = evaluateSchedule(config.schedule, config);
  console.log(`================================================================`);
  console.log(`🚀 OMNIPANEL MODULAR SEGURO EN VIVO: http://localhost:${PORT}`);
  console.log(`🧩 Arquitectura: Modular (src/config, src/middleware, src/services, src/routes)`);
  console.log(`🔒 Seguridad Activa: Cabeceras HTTP, Rate-Limit, Anti-XSS/Inyección y Sesiones Criptográficas`);
  console.log(`📱 Motor WhatsApp: ${whatsappService.engineMode} (Listo para escanear QR)`);
  console.log(`🕒 Horario Laboral: ${sched.workStart} a ${sched.workEnd} (${sched.isInsideWorkHours ? 'DENTRO de horario laboral' : 'FUERA de horario laboral'})`);
  console.log(`🤖 Auto-Respuesta: ${sched.shouldAutoReply ? 'ACTIVA (Fuera de horario)' : 'EN PAUSA (Dentro de horario laboral)'}`);
  console.log(`📸 Meta Graph API: Webhook en /api/meta/webhook | OAuth en /api/channels/meta/oauth/:key`);
  console.log(`================================================================`);
  // Iniciar sincronización periódica continua de Instagram (cada 45 segundos)
  startInstagramAutoSync(io, 45000);
});
