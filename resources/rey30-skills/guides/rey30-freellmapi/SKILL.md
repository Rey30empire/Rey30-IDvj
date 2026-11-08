---
name: rey30-freellmapi
description: Conecta un FreeLLMAPI existente como proveedor OpenAI compatible y revisa cuotas, datos y credenciales sin cambiar el modelo local predeterminado.
license: Apache-2.0
---

# FreeLLMAPI — guía propia de integración

Fuente: [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi). Es un programa externo que reúne proveedores detrás de una API; instalar esta habilidad no instala ese programa ni concede créditos o claves.

Comprueba si existe una instancia local o remota autorizada y consulta su versión y documentación. El proyecto tiene aplicación Windows y opciones Node/Docker. No ejecutes el instalador remoto ni cambies configuraciones de otros editores para realizar el descubrimiento.

Para agregarlo a Rey30 IDvj utiliza un proveedor OpenAI compatible con la URL base de esa instancia, su clave unificada y un identificador obtenido de su catálogo real. El ejemplo loopback documentado es `http://localhost:3001/v1`; úsalo sólo si la instancia realmente escucha allí. No supongas que `auto` u otro alias exista. Un resultado de `/v1/models` demuestra descubrimiento, no una inferencia.

Conserva Jan 4B y AMD como configuración local. El enrutador puede reenviar prompts a otros proveedores: que la dirección sea local no implica que el procesamiento sea local o privado. Informa destino, política del proveedor, límites y posibles costes antes de enviar contenido. No acumules cuentas ni eludas cuotas.

Guarda claves en el flujo de credenciales del proveedor; evita incluirlas en ejemplos, historiales o informes. Los planes gratuitos cambian y no constituyen disponibilidad garantizada. Si faltan claves, instancia o autorización, identifica ese requisito y deja la configuración preparada sin afirmar funcionamiento remoto.
