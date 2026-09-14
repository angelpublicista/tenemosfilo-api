// Arranque del API bajo PM2.
//
// Vive en el repo para que el despliegue sea reproducible: no hay
// configuracion suelta en el servidor.
const RAIZ = '/srv/tenemosfilo-api';

module.exports = {
  apps: [
    {
      name: 'filo-api',
      script: 'dist/server.js',

      // `current` es un enlace al despliegue activo. Al publicar una version
      // nueva se mueve el enlace y se recarga: si algo sale mal, volver atras
      // es apuntarlo al anterior.
      //
      // El cwd no es cosmetico: /docs lee process.cwd()/docs/openapi.yaml y
      // dotenv busca el .env en el directorio de trabajo. Por eso cada
      // despliegue lleva su propio docs/ y un enlace al .env de la instancia.
      cwd: `${RAIZ}/current`,

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
