-- El chat con el agente en el catalogo publico es opcional y lo decide el
-- anfitrion. Apagado por defecto: abrir un chat a cualquiera que visite el
-- catalogo no puede pasar sin que el anfitrion lo haya pedido.
ALTER TABLE "AiAgent" ADD COLUMN "mostrarEnCatalogo" BOOLEAN NOT NULL DEFAULT false;
