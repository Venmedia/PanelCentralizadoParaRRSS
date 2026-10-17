# AGROPANEL CENTRALIZADO DE REDES SOCIALES
### 1 WhatsApp Normal (por QR) + 2 Cuentas de Instagram + 2 Cuentas de TikTok
### Motor de Bot Interactivo de 6 Opciones con Envío Automático de PDF y Handoff a Asesor

---

## 📌 ¿Cómo se resolvió el reto de WhatsApp Normal (Sin API ni Business)?

Meta bloquea los botones comerciales tradicionales (`buttonsMessage`) en WhatsApp Normal si no se paga la API Oficial. Para resolverlo de forma 100% gratuita y sin riesgo de incompatibilidad en iPhones o WhatsApp Web, implementamos la **Estrategia Híbrida Triple**:

1. **Reconocimiento por Número (1 al 6):** El cliente solo escribe `1`, `2`, `3`, `4`, `5` o `6`.
2. **Reconocimiento por Palabras Clave y Frases Naturales (Fuzzy NLP):**
   - Si el cliente escribe *"precio"*, *"cuánto cuesta"* o *"valor"* ➡️ Dispara la **Opción 1: Precios**.
   - Si el cliente escribe *"financiamiento"*, *"crédito"* o *"cuotas"* ➡️ Dispara la **Opción 2: Financiamiento**.
   - Si el cliente escribe *"programada"*, *"pedido"* o *"reserva"* ➡️ Dispara la **Opción 3: Compras programadas**.
   - Si el cliente escribe *"garantía"*, *"repuestos"* o *"taller"* ➡️ Dispara la **Opción 4: Garantía y repuestos**.
   - Si el cliente escribe *"catálogo"*, *"pdf"* o *"ficha"* ➡️ Dispara la **Opción 5: Ver catálogo** y **envía el archivo PDF automáticamente** mediante `sendMedia` de Evolution API.
   - Si el cliente escribe *"asesor"*, *"humano"*, *"persona"* o *"vendedor"* ➡️ Dispara la **Opción 6: Hablar con un asesor**, **pausa el bot de inmediato** y activa una alerta visual y sonora en el panel para el operador.
3. **Encuestas Nativas Clicables (`sendPoll`):** Las encuestas de WhatsApp son 100% nativas y gratuitas en WhatsApp Normal. El cliente puede simplemente tocar con el dedo el botón redondo de la opción deseada y el sistema lo detecta como evento instantáneo.

> **¡Bonus Clave!** Este mismo menú de 6 opciones funciona de forma unificada para los **2 Instagrams** y los **2 TikToks**.

---

## 🚀 Puesta en Marcha Rápida (Local o VPS)

### Opción A: Con Node.js directo
```bash
cd C:\Users\USER\.gemini\antigravity\scratch\omnipanel-consorcio
npm install
npm start
```
Abre tu navegador en: `http://localhost:3000`

### Opción B: Con Docker Compose (Listo para Producción)
```bash
docker-compose up -d
```
Esto levantará:
- **OmniPanel** en el puerto `3000`
- **Evolution API v2** en el puerto `8080` (conecta el WhatsApp Normal escaneando el código QR)
- **Redis** para deduplicación y almacenamiento de sesiones
