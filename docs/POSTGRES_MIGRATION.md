# Migración progresiva a PostgreSQL

El panel mantiene el frontend actual y usa PostgreSQL como persistencia robusta cuando existe `DATABASE_URL`.

## Activación

1. Copiar `.env.example` a `.env`.
2. Configurar `DATABASE_URL` con la base de datos del entorno.
3. Ejecutar `npm install` y arrancar con `npm start`.

En el arranque se crean las tablas necesarias para conversaciones, mensajes, usuarios, sesiones, tokens OAuth, webhooks y eventos. Si las tablas están vacías y existen archivos JSON, se importan una sola vez como respaldo de transición.

## Sincronización de borrados

`DELETE /api/conversations/:conversationId` marca la conversación como eliminada en PostgreSQL, registra el evento y emite `conversation_deleted` por Socket.IO. El móvil y el panel deben usar el mismo endpoint/evento para que el borrado sea consistente entre dispositivos.

## Alcance de esta primera etapa

- conversaciones y mensajes en PostgreSQL;
- eventos de borrado para auditoría;
- usuarios y sesiones persistentes;
- tokens OAuth y eventos de webhook persistidos;
- sesiones de conversación cargadas desde la base al reiniciar;
- fallback JSON cuando no se configura PostgreSQL;
- frontend existente conservado.

La arquitectura mantiene un único proceso Node/Express y un único pool PostgreSQL. No requiere microservicios ni colas para esta etapa.

Antes de activar producción se requiere provisionar PostgreSQL, realizar backup de los JSON actuales y ejecutar una prueba de restauración.
