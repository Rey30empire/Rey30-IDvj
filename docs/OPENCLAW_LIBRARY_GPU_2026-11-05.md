# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

**Proyecto** Rey30 IDvj  
**Módulo** OpenClaw, asistentes Trama y Pluma, biblioteca local y detección de GPU  
**Estado** COMPLETADO CON LIMITACIONES. Release 0.9.7 preparada para Windows x64. El Gateway local y el puente MCP están verificados. Se comprobó la biblioteca real, la protección local del historial y la identificación de la AMD seleccionada.

## 1. Objetivo

Dejar listo el puente MCP de OpenClaw. Incorporar un perfil de ingeniería full-stack y un asistente literario híbrido que consulte `D:\Libreria General`. Corregir la lectura de la GPU activa y copiar los agentes y asistentes faltantes a una carpeta separada del gestor.

## 2. Trabajo realizado

**Trama** abarca diseño técnico, frontend, backend, datos, depuración, pruebas y despliegue con los permisos de la sesión. **Pluma** analiza y escribe a partir de pasajes de la biblioteca tanto en chat como en voz. El editor de Pluma ofrece **Actualizar índice** y muestra el recuento de documentos leídos y omitidos. [Perfiles](../web-app/src/lib/characters/profiles.ts) · [Editor](../web-app/src/containers/characters/CharacterPanel.tsx)

OpenClaw 2026.11.1 se instaló en un prefijo privado de usuario. Su Gateway `rey30-idvj` usa `127.0.0.1:18809` y autenticación. La instalación de Windows registró el inicio al entrar en la sesión de usuario. El MCP **OpenClaw** quedó activo en la configuración habitual, con las seis entradas anteriores preservadas. El Gateway y el puente usan una copia de Node 24.22.2 verificada por SHA-256. [Instalación nativa](https://docs.openclaw.ai/platforms/windows) · [Configuración final](../artifacts/qa/openclaw-gateway-20261105/habitual-mcp-patched-runtime-receipt.json)

## 3. Arquitectura

Pluma se vincula a un motor local administrado. El backend Windows limita la lectura a la carpeta local autorizada, indexa texto en memoria y devuelve hasta cinco pasajes con su ruta y línea extraída. El chat conserva una marca de biblioteca en sus metadatos y se mantiene local al cambiar de asistente. El texto de referencia se agrega a la petición actual. [Índice](../src-tauri/src/core/literary_library.rs) · [Transporte](../web-app/src/lib/custom-chat-transport.ts) · [Persistencia](../src-tauri/src/core/threads/commands.rs)

El índice admite TXT, Markdown, PDF con texto extraíble, HTML, DOCX, PPTX y CSV. También lee entradas de texto compatibles dentro de ZIP sin extraerlas al disco. Las referencias de archivo comprimido usan `archivo.zip::miembro`. Los límites de lectura, profundidad y expansión acotan el trabajo.

## 4. Análisis profesional

La consulta por pasajes conserva el texto de las obras en su carpeta y permite citar la fuente. La búsqueda léxica usa nombres y términos españoles. Un resultado con coincidencias aporta evidencia para esa consulta. Una ausencia de coincidencias limita las afirmaciones que se pueden hacer sobre las obras.

## 5. Comprensión profunda

El chat de biblioteca usa el modelo local para responder y conserva las instrucciones editoriales o habladas según el canal real del turno. La sesión desactiva herramientas, conectores y carga de adjuntos remotos. Las respuestas se presentan como texto para evitar que una cita o imagen generada active una solicitud web. El Gateway MCP se administra por separado y expone operaciones sobre las conversaciones de sus canales vinculados. [Servidor MCP oficial](https://docs.openclaw.ai/cli/mcp/serve)

## 6. Bloqueos detectados

El sistema y Vulkan enumeraron las tarjetas AMD y NVIDIA. El panel de compatibilidad deducía el motor a partir del primer dispositivo disponible, aunque el ajuste seleccionaba `Vulkan1` en AMD. La pantalla de hardware también dependía de la lista del motor para mostrar las tarjetas. La corrección distingue detección de hardware y adaptador seleccionado.

El puente OpenClaw se probó con el nuevo perfil de Gateway y con autenticación. La prueba de un token incorrecto devolvió rechazo. La auditoría oficial del Gateway con el runtime final informó cero críticos, cero advertencias y una nota informativa. El Gateway local aún carece de canales de mensajería vinculados. [Estado final del Gateway](../artifacts/qa/openclaw-gateway-20261105/gateway-patched-health.json)

## 7. Pruebas y evidencias

- El escritorio Debug 0.9.6 activó el puente por el IPC real de Rey30, enumeró nueve herramientas y ejecutó `conversations_list` con cero conversaciones. La prueba se realizó en un perfil aislado, sin ejecutar inferencia ni enviar mensajes. [Verificación MCP](../artifacts/qa/openclaw-gateway-20261105/native-mcp-receipt.json)
- Con Node 24.22.2 se repitió el intercambio stdio con el Gateway operativo. Anunció las mismas nueve herramientas y `conversations_list` devolvió cero. [Recibo del puente final](../artifacts/qa/openclaw-gateway-20261105/patched-stdio-receipt.json)
- Las pruebas focales de catálogo aprobaron 99 casos. El transporte cubre texto y voz, el rechazo de un modelo remoto tras cambiar de asistente y la presentación inerte de citas. [Catálogo](../artifacts/qa/openclaw-library-20261105/assistant-catalog-tests.log) · [Privacidad](../artifacts/qa/openclaw-library-20261105/privacy-tests.log)
- La prueba nativa de la biblioteca indexó 7.690 fuentes de 8.131, incluidas 538 dentro de un ZIP. Omitió 396 elementos de formato incompatible y 45 vacíos o ilegibles. El índice Debug tardó 55,8 s en frío y devolvió cinco pasajes para cada consulta de novela, carta y poema en 42 a 50 ms. Pasaron cuatro casos sintéticos y una regresión de persistencia de privacidad. [Recibo de biblioteca](../artifacts/qa/literary-library-20261105/receipt.json)
- El inventario físico y los registros del motor mostraron AMD Radeon AI PRO R9700 en `Vulkan1` y NVIDIA por separado. Pasaron 128 pruebas web y 128 de la extensión sobre selección, detección y avisos de GPU. [Inventario físico](../artifacts/qa/openclaw-library-20261105/gpu-host-inventory.json) · [Web](../artifacts/qa/openclaw-library-20261105/gpu-readiness-web-tests.log) · [Extensión](../artifacts/qa/openclaw-library-20261105/gpu-readiness-extension-tests.log)
- El gestor recibió 26 fichas y agentes en su carpeta de ampliación separada. La verificación cotejó 31 archivos con cero errores. Incluye asistentes integrados, agentes Orquesta y subagentes nativos. [Índice del gestor](<C:/Users/rey30/Projects/Agentes y Habilidades de IA Rey30/Ampliaciones verificadas/Rey30 IDvj 2026-11-05/INDICE_AGENTES.md>) · [Verificación](<C:/Users/rey30/Projects/Agentes y Habilidades de IA Rey30/Ampliaciones verificadas/Rey30 IDvj 2026-11-05/VERIFICACION.json>)
- La suite web final pasó 4.995 pruebas en 386 archivos. El primer intento detectó dos claves nuevas de GPU que la prueba de traducciones no reconocía como dinámicas. Se registraron esas claves en el control y se repitió la suite. [Suite web](../artifacts/qa/openclaw-library-20261105/test-web.log)
- El escritorio Debug 0.9.7 pasó cinco casos en 24,8 s. Se comprobó que Pluma muestra la ruta de biblioteca, restringe su selector a motores locales y conserva la protección al recibir una actualización de chat que omite la marca. El perfil aislado usó metadatos y bloqueó las descargas externas. [Registro E2E](../artifacts/qa/openclaw-library-20261105/e2e.log) · [Recibo nativo](../artifacts/qa/openclaw-library-20261105/native-e2e-receipt.json)
- Release Windows 0.9.7 se compiló en 9 min 46 s. El ejecutable preparado mide 61.865.472 bytes y coincide con SHA-256 `0cfeeca2dd05269661f426f2c555237445c2c9de08ab4358051b53b1d7e50a25`. El lanzador pasó `-Check`. [Compilación](../artifacts/qa/openclaw-library-20261105/release-build-receipt.json) · [Preparación](../artifacts/qa/openclaw-library-20261105/staging-receipt.json) · [Lanzador](../artifacts/qa/openclaw-library-20261105/launcher-check.log)

## 8. Control de calidad

La verificación de la biblioteca utiliza conteos y metadatos. Las pruebas de búsqueda emplean archivos de prueba o consultas de lectura sin reproducir pasajes del corpus en los registros. Los modelos instalados y la selección de AMD se comprueban a través de sus metadatos y ajustes. La preparación verificó 2.316 archivos de fuente, el ejecutable y otros 459 archivos de runtime. Los metadatos de los pesos del modelo local de 4B y el hash de los ajustes del motor coincidieron con el punto anterior.

## 9. Limitaciones

La búsqueda depende del texto extraíble de cada formato. El asistente muestra un recuento de omitidos. Las pruebas separan la extracción y recuperación, el envío a un modelo simulado y la comprobación de audio físico. OpenClaw conecta al Gateway local. Las acciones sobre servicios externos requieren un canal que ya esté configurado y sus permisos correspondientes.

El cálculo de memoria disponible para modelos sigue siendo agregado. El inventario identifica la GPU seleccionada y las tarjetas detectadas. La capacidad de un modelo concreto en la AMD requiere una medición de ejecución.

## 10. Siguiente paso

El índice se reconstruye desde la configuración de Pluma al agregar o corregir documentos. La ruta del panel muestra el origen que consulta el asistente.

## 11. Recomendación personalizada

Reinier Tamayo puede usar **Trama** para una tarea técnica y **Pluma** para comparar una novela, carta o poema. Para comprobar una cita de Pluma, la referencia de ruta y línea permite volver al texto de origen.
