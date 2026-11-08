---
name: rey30-openclaw
description: Prepara una integración OpenClaw o importa una habilidad específica conservando credenciales, permisos y límites de los canales.
license: Apache-2.0
---

# OpenClaw — guía propia de integración

Referencia probable de «open clau»: [openclaw/openclaw](https://github.com/openclaw/openclaw). Su gateway y canales son software externo. Esta habilidad no inicia el gateway, instala dependencias ni autentica servicios.

Inspecciona la versión instalada, manifiesto y documentación de inicio. Los requisitos de Node cambian entre versiones; usa los del `package.json` que vas a ejecutar, sin actualizar globalmente el entorno de otros proyectos.

Decide si hace falta conectar el gateway o sólo importar una habilidad. Para importar, revisa `SKILL.md`, referencias, licencia, comandos y acceso a datos; selecciona el recurso concreto mediante el importador existente. Los hooks, permisos y herramientas de OpenClaw no se transfieren automáticamente.

Para una instancia real identifica su transporte documentado, URL, autenticación y canal. Conserva credenciales en el mecanismo del servicio y usa alcances mínimos. El consentimiento del proveedor corresponde a su flujo de navegador; no inventes un inicio Google o contraseña donde no exista.

No envíes mensajes ni conectes cuentas personales como prueba automática de instalación. Valida descubrimiento y una operación autorizada. Si el usuario requiere privacidad local, revisa los destinos: un gateway local puede llamar a la nube o a servicios de mensajería. Un paquete preparado y un canal operativo son estados distintos.
