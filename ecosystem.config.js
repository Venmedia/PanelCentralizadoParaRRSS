/**
 * @file ecosystem.config.js
 * @description Configuración oficial de PM2 para desplegar OmniPanel en el VPS (173.224.115.126)
 */
module.exports = {
  apps: [
    {
      name: 'omnipanel-consorcio',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        OMNIPANEL_VAULT_SECRET: 'OmniPanel_Consorcio_Agropower_Tractopower_AES256_MasterVaultKey_2026!'
      }
    }
  ]
};
