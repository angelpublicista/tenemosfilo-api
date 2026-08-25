// Arranque del API bajo PM2.
//
// Vive en el repo para que el despliegue sea reproducible: la instancia solo
// hace `git pull` y `pm2 reload`, sin configuracion suelta en el servidor.
module.exports = {
  apps: [
    {
      name: 'filo-api',
      script: 'dist/server.js',

      // Obligatorio, no es cosmetico: /docs lee process.cwd()/docs/openapi.yaml
      // y dotenv busca el .env en el directorio de trabajo. Arrancar desde
      // otro sitio deja la documentacion rota y el servidor sin configuracion.
      cwd: '/srv/tenemosfilo-api',

      // Una sola instancia a proposito. Los contadores del limite de
      // peticiones viven en memoria del proceso: con varias, cada una
      // contaria por su cuenta y el limite real seria N veces mayor.
      // Para escalar hace falta antes un store compartido.
      instances: 1,
      exec_mode: 'fork',

      env: { NODE_ENV: 'production' },

      // La instancia tiene menos de 1 GB. Si algo se desboca, mejor que PM2
      // reinicie el proceso a que el kernel elija la victima y se lleve por
      // delante a Nginx o a la propia sesion SSH.
      max_memory_restart: '350M',

      autorestart: true,
      max_restarts: 10,
      merge_logs: true,
      time: true,
    },
  ],
};
