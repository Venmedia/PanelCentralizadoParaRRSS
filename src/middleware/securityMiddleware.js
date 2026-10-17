const { SECURITY_CONFIG } = require('../config/constants');

const apiRateMap = new Map();
const loginRateMap = new Map();

// 1. Cabeceras de Seguridad HTTP (Equivalente a Helmet)
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'self'; base-uri 'self'; form-action 'self';"
  );
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}

// 2. Sanitización profunda contra Prototype Pollution, XSS, Inyección HTTP / NoSQL / Script Malicioso
const DANGEROUS_PATTERNS = [
  /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
  /<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gi,
  /<object\b[^>]*>([\s\S]*?)<\/object>/gi,
  /<embed\b[^>]*>/gi,
  /javascript\s*:/gi,
  /vbscript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  /\bon(error|load|click|mouseover|focus|blur|submit|change|keyup|keydown)\s*=/gi,
  /\beval\s*\(/gi,
  /document\.cookie/gi
];

function sanitizeString(val, skipBase64 = false) {
  if (typeof val !== 'string') return val;
  if (skipBase64 && val.length > 1000) return val; // No alterar binarios PDF en base64
  let clean = val.replace(/\0/g, ''); // Eliminar null bytes
  for (const pattern of DANGEROUS_PATTERNS) {
    clean = clean.replace(pattern, '[BLOQUEADO]');
  }
  return clean;
}

function deepSanitizeObject(obj, parentKey = '') {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return sanitizeString(obj, parentKey === 'fileBase64');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => deepSanitizeObject(item, parentKey));
  }
  if (typeof obj === 'object') {
    const cleaned = {};
    for (const key of Object.keys(obj)) {
      if (
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype' ||
        key.startsWith('$')
      ) {
        console.warn(`[Seguridad 🛡️] Intento de inyección de propiedad bloqueado: "${key}"`);
        continue;
      }
      cleaned[key] = deepSanitizeObject(obj[key], key);
    }
    return cleaned;
  }
  return obj;
}

function sanitizeRequest(req, res, next) {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = deepSanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = deepSanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = deepSanitizeObject(req.params);
    }
  } catch (e) {
    return res.status(400).json({ error: 'Solicitud malformada o bloqueada por seguridad' });
  }
  next();
}

// 3. Rate Limiter Global para API y Utilidades de IP
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket?.remoteAddress || '127.0.0.1';
  return raw.replace(/[\r\n]/g, '');
}

function apiRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  let record = apiRateMap.get(ip);
  if (!record || now - record.start > SECURITY_CONFIG.API_WINDOW_MS) {
    record = { start: now, count: 0 };
  }
  record.count++;
  apiRateMap.set(ip, record);

  if (record.count > SECURITY_CONFIG.API_MAX_REQ) {
    return res.status(429).json({
      error: 'Límite de peticiones excedido (Rate Limit). Por favor espera unos segundos.'
    });
  }
  next();
}

module.exports = {
  securityHeaders,
  sanitizeRequest,
  apiRateLimiter,
  getClientIp,
  loginRateMap
};
