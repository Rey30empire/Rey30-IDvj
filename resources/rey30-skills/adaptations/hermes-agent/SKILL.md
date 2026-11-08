---
name: hermes-agent
description: "Orientar el uso, diagnóstico y configuración segura de Hermes Agent, distinguiendo la guía disponible de un runtime instalado y respetando perfiles, permisos y secretos."
license: MIT
metadata:
  translation-role: "adaptación al runtime Rey30 en español; no equivalencia CLI"
---

# Hermes Agent

Guía en español basada en la habilidad oficial Hermes Agent 3.3.0. Hermes es un marco externo con CLI, interfaces y servicios propios. Esta habilidad aporta instrucciones y referencias; no lo instala, no convierte los agentes Rey30 en procesos Hermes y no demuestra que sus herramientas estén disponibles.

## Verificar antes de actuar

1. Identifica la tarea y si el usuario pide información, diagnóstico o una modificación real. Para orientar o preparar un plan no hace falta instalar el programa.
2. Comprueba con las herramientas del anfitrión si existe un ejecutable Hermes real y registra versión/ruta sin alterar PATH global. Solo entonces consulta `hermes --help` y la ayuda del subcomando pertinente. Un nombre de habilidad no acredita instalación.
3. Revisa las instrucciones del proyecto y las rutas del perfil activo. Usa `$HERMES_HOME` cuando esté definido; no supongas que todo reside en `~/.hermes`. No leas ni copies credenciales para demostrar disponibilidad.
4. Si falta el programa, informa «Guía disponible; runtime Hermes pendiente». Puedes explicar requisitos y preparar configuración redactada. No ejecutes instaladores remotos ni crees cuentas automáticamente.

La documentación oficial es la autoridad para capacidades actuales: https://hermes-agent.nousresearch.com/docs/llms.txt y https://hermes-agent.nousresearch.com/docs/user-guide/features/skills. Consulta el índice para preguntas concretas. No concluyas que una función no existe porque esta guía no la mencione; si no puedes consultar la fuente, indícalo.

## Rutas y seguridad

La distribución documenta `config.yaml` para configuración y `.env` para secretos; `auth.json` contiene OAuth y pools de credenciales. Bajo el perfil activo también puede haber skills, sesiones, memoria, skins, widgets, mascotas e integraciones. Los perfiles pueden usar `~/.hermes/profiles/<nombre>/`; resuelve el hogar real del proceso antes de acceder.

- No imprimas tokens, API keys, cookies, contraseñas ni archivos de autenticación. No solicites su pegado en el chat. Usa los mecanismos oficiales del proveedor y la persona autoriza en el navegador.
- No desactives redacción de secretos. La fuente documenta `hermes config set security.redact_secrets true`; algunos ajustes solo se leen al arrancar, por lo que requieren una sesión nueva. Un cambio de variable desde una herramienta no debe usarse para saltarse esa protección.
- Cambia configuración con el CLI real, por ejemplo `hermes config set KEY VAL` tras verificar clave y valor; no edites a mano un config.yaml vivo. Nunca mezcles ajustes no secretos en .env ni secretos en documentación.
- Permisos de comandos, redacción de secretos y privacidad de mensajes son controles distintos. Desactivar un prompt de aprobación no crea un sandbox. No relajes ninguno para hacer pasar una prueba.
- En código Hermes usa su resolvedor `get_hermes_home()`; en una sesión respeta HERMES_HOME. No toques perfiles ajenos, datos existentes ni rutas de usuario durante QA.
- Mantén las invariantes del historial: alternancia de roles salvo resultados tool y contexto pasado estable para caché de prompts; no cambies herramientas o mensaje de sistema a mitad de conversación fuera de una compresión prevista.

## Uso y diagnóstico con runtime comprobado

1. Ejecuta un diagnóstico propio de Hermes como `hermes doctor` solo con el programa disponible y el entorno autorizado. Revisa salida sin secretos y separa fallo de proveedor, herramienta, gateway y modelo.
2. Antes de cambiar modelo/proveedor consulta la configuración activa y la documentación correspondiente. Conserva la GPU/backend elegidos por la persona; tener una habilidad NVIDIA no autoriza cambiar AMD.
3. Para conversación interactiva, la fuente documenta `hermes`; para consulta aislada, `hermes chat -q "<consulta>"`. Ambos pueden invocar un modelo y consumir cuota: requieren una tarea que lo autorice. Esta preparación no los ha ejecutado.
4. Para retomar sesiones, verifica los identificadores reales y la ayuda de `--continue` o `--resume`; no fabriques IDs ni edites la base de sesiones.
5. Para memoria, cron, gateway, webhook, mensajería o MCP, identifica alcance, credenciales, permisos y exposición de red. No actives servicios persistentes por una pregunta informativa. Usa pruebas locales propias y un perfil aislado cuando proceda.

## Delegación y coordinación

Prefiere la delegación nativa de Hermes para subtareas breves cuando exista realmente. No confundas una función llamada delegate_task con la herramienta del anfitrión Rey30.

Si la tarea autorizada exige varias instancias, define objetivos, propiedad de archivos, entradas/salidas y cómo se revisarán. Conserva perfiles aislados; si se modifica código, usa el modo worktree `hermes -w` cuando su ayuda instalada lo confirme. Pon límites de tiempo y conserva logs depurados. tmux es una opción del original, no un requisito ni una herramienta implícita en Windows. Si no hay PTY/tmux compatible, no inventes una sesión interactiva; entrega el plan o usa un modo no interactivo admitido.

Una cifra de concurrencia requiere evidencia del runtime y configuración; no atribuyas a Hermes un límite deducido del comportamiento del modelo. Tareas programadas usan su mecanismo de cron cuando esté instalado, no procesos abandonados.

## Guía de referencias

El núcleo anterior permite orientar de forma autónoma. Si hay lector de archivos, consulta la referencia antes de detallar el tema:

- CLI y slash commands: [cli-reference](references/cli-reference.md), [slash-commands](references/slash-commands.md).
- Proveedores/OAuth: [providers-and-models](references/providers-and-models.md); suscripción Portal en otra app: [portal-auth-for-third-party-apps](references/portal-auth-for-third-party-apps.md). No supongas que una sesión da derecho de API a otra aplicación.
- Configuración y seguridad: [configuration](references/configuration.md), [security-privacy](references/security-privacy.md), [project-context-files](references/project-context-files.md).
- MCP y trabajo en segundo plano: [native-mcp](references/native-mcp.md), [background-systems](references/background-systems.md), [webhooks](references/webhooks.md).
- Perfiles/proyectos y Windows: [projects-and-folders](references/projects-and-folders.md), [windows-quirks](references/windows-quirks.md), [troubleshooting](references/troubleshooting.md).
- Extensiones visuales: [themes](references/themes.md), [desktop-plugins](references/desktop-plugins.md), [tui-widgets](references/tui-widgets.md), [petdex](references/petdex.md).

Plantillas JS/YAML, código de extensiones y el runtime no se incluyen aquí. No informes una extensión instalada si solo existe su descripción.

## Resultado y procedencia

Explica qué se observó, qué se cambió, qué se probó y qué falta. Distingue comando disponible, autenticación, servicio iniciado, modelo invocado y resultado aceptado. Conserva LICENSE/SOURCE.json y el original en `references/upstream-SKILL.md`.
