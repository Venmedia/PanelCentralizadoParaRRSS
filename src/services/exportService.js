const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/constants');
const { getConversations } = require('./storageService');

function getMetaConversationsAsArray() {
  try {
    if (fs.existsSync(PATHS.META_CONVERSATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PATHS.META_CONVERSATIONS_FILE, 'utf8'));
      if (data && data.chats && typeof data.chats === 'object') {
        return Object.values(data.chats);
      }
    }
  } catch (err) {
    console.error('[ExportService] Error leyendo metaConversations:', err.message);
  }
  return [];
}

function resolveMessageSender(m, conv) {
  const isClient = m.from === 'client' || 
                   m.sender === 'client' || 
                   (m.sender && m.sender !== 'operator' && m.sender !== 'Agropower' && m.sender !== 'Tractopower' && m.sender !== 'bot' && m.sender !== 'scheduled' && !m.operatorName && !m.operatorUser && m.from !== 'operator');

  if (isClient) {
    return {
      direction: '📥 Recibido (Cliente)',
      senderDetailed: 'Cliente',
      isClient: true
    };
  }

  const isScheduled = m.sender === 'scheduled';
  if (isScheduled) {
    return {
      direction: '📤 Enviado',
      senderDetailed: '⏰ Mensaje Programado',
      isClient: false
    };
  }

  const textLower = (m.text || '').toLowerCase();
  const isGreetingText = textLower.includes('saludos de parte del equipo') ||
                         textLower.includes('gracias por escribirnos') ||
                         textLower.includes('cotización de repuestos o maquinaria') ||
                         textLower.includes('cotizacion de repuestos') ||
                         textLower.includes('para orientarte mejor, cuéntanos') ||
                         textLower.includes('para orientarte mejor') ||
                         textLower.includes('escríbenos tu duda y ya te respondemos') ||
                         textLower.includes('escribenos tu duda y ya te respondemos') ||
                         textLower.includes('en un momento un asesor se pondrá en contacto') ||
                         textLower.includes('en un momento un asesor');

  const isAutoGreeting = m.sender === 'bot' || 
                         m.isBot === true ||
                         m.origin === 'bot' ||
                         (m.operatorName && (m.operatorName.includes('Bot') || m.operatorName.includes('bot'))) ||
                         (!m.origin && !m.operatorName && !m.operatorUser && (
                           isGreetingText ||
                           ((!m.text || m.text.trim() === '') && (m.sender === 'Agropower' || m.sender === 'Tractopower'))
                         ));

  if (isAutoGreeting) {
    return {
      direction: '📤 Enviado',
      senderDetailed: '🤖 Bot Programado',
      isClient: false
    };
  }

  const isWeb = m.origin === 'web' ||
                m.operatorUser === 'web' ||
                (m.operatorName && (m.operatorName.includes('Web') || m.operatorName.includes('WhatsApp Web')));

  if (isWeb) {
    return {
      direction: '📤 Enviado',
      senderDetailed: '💻 WhatsApp Web',
      isClient: false
    };
  }

  const isMobile = m.origin !== 'panel' && (
                   m.origin === 'mobile' || 
                   m.operatorUser === 'mobile' || 
                   (m.operatorName && (m.operatorName.includes('Móvil') || m.operatorName.includes('Movil') || m.operatorName.includes('Instagram App'))) || 
                   (m.text && m.text.includes('(Enviado desde el teléfono físico)'))
  );

  if (isMobile) {
    return {
      direction: '📤 Enviado',
      senderDetailed: '📱 Móvil',
      isClient: false
    };
  }

  // Si fue enviado desde el panel (autor inmutable)
  const raw = (m.operatorName || m.operatorUser || '').toLowerCase();
  let advisorLabel = '👤 Asesor';
  if (raw.includes('jesus') || m.operatorUser === 'Jesuse') {
    advisorLabel = '👤 Asesor Jesus';
  } else if (raw.includes('ricardo') || m.operatorUser === 'rcazorla') {
    advisorLabel = '👤 Asesor Ricardo';
  } else if (raw.includes('admin') || m.operatorUser === 'admin') {
    advisorLabel = '🛡️ Administrador';
  } else if (m.operatorName) {
    advisorLabel = m.operatorName.startsWith('Asesor') ? `👤 ${m.operatorName}` : `👤 Asesor ${m.operatorName}`;
  } else if (m.sender === 'Agropower' || m.sender === 'Tractopower') {
    advisorLabel = '📱 Móvil / Cuenta Principal';
  }

  return {
    direction: '📤 Enviado',
    senderDetailed: advisorLabel,
    isClient: false
  };
}

function normalizeChannelLabel(channel, company) {
  const c = String(channel || '').toLowerCase();
  if (c.startsWith('wa_agro') || c === 'wa1') return 'WhatsApp Agropower';
  if (c.startsWith('wa_tracto') || c === 'wa2') return 'WhatsApp Tractopower';
  if (c.startsWith('ig_') || c === 'instagram') return 'Instagram Direct';
  if (c.startsWith('fb_') || c === 'facebook') return 'Facebook Messenger';
  if (c.startsWith('tk_') || c === 'tiktok') return 'TikTok Direct';
  return company ? `${company} (${channel})` : (channel || 'Canal Desconocido');
}

function resolveAssignedAdvisor(conv) {
  if (!conv) return 'Sin Asignar';
  const raw = (conv.attendedByName || conv.attendedBy || '').toLowerCase();
  if (raw.includes('jesus') || conv.attendedBy === 'Jesuse') return 'Asesor Jesus';
  if (raw.includes('ricardo') || conv.attendedBy === 'rcazorla') return 'Asesor Ricardo';
  if (raw.includes('admin') || conv.attendedBy === 'admin') return 'Administrador';
  if (conv.attendedByName) return conv.attendedByName.startsWith('Asesor') ? conv.attendedByName : `Asesor ${conv.attendedByName}`;
  return 'Sin Asignar';
}

function buildExportDataset() {
  const waConvs = getConversations();
  const metaConvs = getMetaConversationsAsArray();

  const allConversations = [];
  const allMessages = [];

  // 1. Procesar WhatsApp
  waConvs.forEach(c => {
    const channelLabel = normalizeChannelLabel(c.channel, c.company);
    const assignedAdvisor = resolveAssignedAdvisor(c);
    const phoneOrUser = c.formattedPhone || c.phone || (c.jid ? c.jid.split('@')[0] : '');

    const convSummary = {
      id: String(c.id),
      channel: channelLabel,
      company: c.company || 'Consorcio',
      clientName: c.name || 'Cliente WhatsApp',
      clientContact: phoneOrUser,
      assignedAdvisor: assignedAdvisor,
      totalMessages: (c.messages || []).length,
      lastInteraction: c.time || ''
    };
    allConversations.push(convSummary);

    (c.messages || []).forEach((m, idx) => {
      const senderInfo = resolveMessageSender(m, c);
      let cleanText = (m.text || '').replace(/\(Enviado desde el teléfono físico\)/gi, '').trim();
      const media = m.mediaLabel || m.attachment || (m.mediaUrl ? `[Multimedia: ${m.mediaType || 'Archivo'}]` : '');

      allMessages.push({
        idConversacion: String(c.id),
        canal: channelLabel,
        empresa: c.company || 'Consorcio',
        clienteNombre: c.name || 'Cliente WhatsApp',
        clienteContacto: phoneOrUser,
        fechaHora: m.time || c.time || '',
        direccion: senderInfo.direction,
        remitenteOrigen: senderInfo.senderDetailed,
        asesorAsignado: assignedAdvisor,
        mensaje: cleanText,
        adjuntoMultimedia: media,
        ordenMensaje: idx + 1
      });
    });
  });

  // 2. Procesar Meta (Instagram / Facebook)
  metaConvs.forEach(c => {
    const company = c.channelKey?.includes('tracto') ? 'Tractopower' : 'Agropower';
    const channelLabel = normalizeChannelLabel(c.channelKey || c.platform, company);
    const assignedAdvisor = resolveAssignedAdvisor(c);
    const contact = c.senderUsername ? `@${c.senderUsername}` : (c.senderId || '');

    const convSummary = {
      id: String(c.id),
      channel: channelLabel,
      company: company,
      clientName: c.name || c.senderUsername || 'Usuario Meta',
      clientContact: contact,
      assignedAdvisor: assignedAdvisor,
      totalMessages: (c.messages || []).length,
      lastInteraction: c.time || ''
    };
    allConversations.push(convSummary);

    (c.messages || []).forEach((m, idx) => {
      const senderInfo = resolveMessageSender(m, c);
      let cleanText = (m.text || '').replace(/\(Enviado desde el teléfono físico\)/gi, '').trim();
      const media = m.mediaLabel || m.attachment || (m.mediaUrl ? `[Multimedia: ${m.mediaType || 'Archivo'}]` : '');

      allMessages.push({
        idConversacion: String(c.id),
        canal: channelLabel,
        empresa: company,
        clienteNombre: c.name || c.senderUsername || 'Usuario Meta',
        clienteContacto: contact,
        fechaHora: m.time || c.time || '',
        direccion: senderInfo.direction,
        remitenteOrigen: senderInfo.senderDetailed,
        asesorAsignado: assignedAdvisor,
        mensaje: cleanText,
        adjuntoMultimedia: media,
        ordenMensaje: idx + 1
      });
    });
  });

  return {
    conversations: allConversations,
    messages: allMessages,
    stats: {
      totalConversations: allConversations.length,
      totalMessages: allMessages.length,
      clientMessages: allMessages.filter(m => m.direccion.includes('Recibido')).length,
      sentMessages: allMessages.filter(m => m.direccion.includes('Enviado')).length,
      exportedAt: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })
    }
  };
}

function escapeCsvField(field) {
  if (field === null || field === undefined) return '""';
  const str = String(field).replace(/"/g, '""');
  return `"${str}"`;
}

function generateCsvExport() {
  const data = buildExportDataset();
  const headers = [
    'ID_Conversacion',
    'Canal',
    'Empresa',
    'Cliente_Nombre',
    'Cliente_Contacto',
    'Fecha_Hora',
    'Direccion',
    'Remitente_Origen',
    'Asesor_Asignado',
    'Mensaje',
    'Adjunto_Multimedia',
    'Orden_Mensaje'
  ];

  const csvRows = [headers.join(',')];

  data.messages.forEach(m => {
    const row = [
      escapeCsvField(m.idConversacion),
      escapeCsvField(m.canal),
      escapeCsvField(m.empresa),
      escapeCsvField(m.clienteNombre),
      escapeCsvField(m.clienteContacto),
      escapeCsvField(m.fechaHora),
      escapeCsvField(m.direccion),
      escapeCsvField(m.remitenteOrigen),
      escapeCsvField(m.asesorAsignado),
      escapeCsvField(m.mensaje),
      escapeCsvField(m.adjuntoMultimedia),
      m.ordenMensaje
    ];
    csvRows.push(row.join(','));
  });

  // UTF-8 BOM (\uFEFF) para apertura nativa e impecable en Excel
  return '\uFEFF' + csvRows.join('\r\n');
}

function generateJsonExport() {
  return buildExportDataset();
}

function saveStaticExports() {
  const exportsDir = path.join(PATHS.PUBLIC_DIR, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const csvContent = generateCsvExport();
  const csvPath = path.join(exportsDir, 'conversaciones_exhaustivas_bidireccionales.csv');
  fs.writeFileSync(csvPath, csvContent, 'utf8');

  const jsonData = generateJsonExport();
  const jsonPath = path.join(exportsDir, 'conversaciones_exhaustivas_bidireccionales.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');

  console.log(`[ExportService] ✅ Exportaciones guardadas en ${exportsDir}:`);
  console.log(`   - Conversaciones: ${jsonData.stats.totalConversations}`);
  console.log(`   - Mensajes Bidireccionales: ${jsonData.stats.totalMessages}`);
  console.log(`   - Recibidos (Clientes): ${jsonData.stats.clientMessages}`);
  console.log(`   - Enviados (Móvil/Asesores/Bot): ${jsonData.stats.sentMessages}`);

  return {
    csvPath,
    jsonPath,
    stats: jsonData.stats
  };
}

module.exports = {
  buildExportDataset,
  generateCsvExport,
  generateJsonExport,
  saveStaticExports,
  resolveMessageSender
};
