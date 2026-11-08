# REINIER TAMAYO — INFORME TÉCNICO DE CODEX

**PROYECTO:** Rey30 IDvj  
**MÓDULO:** Integración de personajes en Asistentes y orbe de voz · 2026-11-04  
**ESTADO:** COMPLETADO CON LIMITACIONES. Release 0.9.3 compilada, preparada y abierta en el perfil habitual; selector y orbe verificados con interacción nativa tras las correcciones U+2019 y de apilamiento. Suite final: 4913 pruebas en 379 archivos aprobadas. Los cinco E2E de Debug pertenecen a la cohorte anterior a ambas correcciones y se conservan por separado. No se probó micrófono físico ni se iniciaron inferencias de Jan por el agente. La entrega se registra también en [PROJECT_STATUS.md](../PROJECT_STATUS.md).

## 1. Objetivo

Integrar seis personajes en Asistentes y en el selector superior de asistente/modelo, conservando el asistente original, Solo modelo y las conversaciones existentes. La interfaz elegida por el propietario es un orbe con aro de colores en una esquina del chat, inicio de voz explícito y retorno a Solo chat.

## 2. Trabajo realizado

Se integraron listado, edición, modelo asociado, selección por hilo, memoria voluntaria y controles de voz/indicador/animación. Se retiró la tarjeta fija central. El propietario descartó los candidatos de personajes 3D y pantalla completa; sus borradores se conservaron en QA y no forman parte del producto actual.

Las fuentes principales son `DropdownModelProvider.tsx`, `CharacterPanel.tsx`, `VoiceOrbDock.tsx` y su CSS, `useAvailableAssistants.ts`, `useCharacterStore.ts`, `assistant-integration.ts`, `useThreads.ts` y `custom-chat-transport.ts`. La corrección posterior de apilamiento afecta solo cuatro clases de `routes/index.tsx`. Este alcance añadió el spec `e2e/specs/characters-preferences.e2e.ts` y actualizó [la guía](REY30_USER_GUIDE.md), conservando los casos de restablecimiento y MCP.

## 3. Arquitectura

Los personajes se presentan como asistentes `character:<id>`. Perfil y notas permanecen en su almacén; no se duplican las instrucciones en otro archivo. La selección valida proveedor/modelo y guarda asistente y modelo del hilo en una operación. El modelo usa `{id,provider}` en memoria y `{id,engine}` en el registro nativo. El contexto se deriva del asistente del hilo; asistente normal y Solo modelo no heredan un personaje global.

El orbe reutiliza la sesión y el motor local de audio. Abrir opciones o seleccionar un personaje no autoriza el micrófono: Iniciar voz es una acción explícita. MCP conserva su integración existente; esta QA solo interceptó metadatos del catálogo y no conectó servicios.

## 4. Análisis profesional

La integración corrige la separación anterior entre un almacén de personajes y el listado/selector de asistentes. Mantener un perfil canónico reduce divergencias entre editor, modelo y conversación. El indicador compacto responde a la elección actual del propietario y conserva la navegación y la paleta.

Los metadatos permiten verificar asociaciones y persistencia sin cargar pesos. Su límite es que no prueban calidad de respuesta, personalidad ni conversación de voz real. La entrega no afirma equivalencia de motor, recursos o calidad con Grok o Jarvis.

## 5. Comprensión profunda

Asignar un modelo no significa cargarlo ni ejecutar inferencia. La prueba seleccionó Kairo en un hilo, Nara en Inicio y volvió al hilo: Kairo y su modelo permanecieron después de recargar. También se comprobaron asistente normal y Solo modelo.

El restablecimiento modifica preferencias admitidas, no recursos: sin punto recupera predeterminados en español; con punto recupera ese punto y permite deshacer. Los hashes de personajes, proveedor y MCP se conservaron. Iniciar voz autoriza envío automático de frases reconocidas; para decidir el envío de texto se utiliza el chat con la sesión de voz pausada.

## 6. Bloqueos detectados

La causa inicial quedó comprobada: `CharacterPanel` utilizaba su almacén propio mientras la página y el selector enumeraban otros asistentes. El spec anterior esperaba `modelBinding:null` y no demostraba integración superior ni persistencia de la combinación por hilo. La nueva implementación y los cinco casos nativos cubren esa brecha.

**Diferencia posterior a los cinco E2E:** una captura mostró la descripción heredada en inglés. El comparador de `useAssistant.ts` no reconocía U+2019 en una de las copias conocidas. La corrección normaliza ese carácter al comparar únicamente las descripciones predefinidas; conserva descripciones personalizadas, instrucciones y parámetros. Su recibo registra **38/38 pruebas en 3 archivos**, lint y formato con salida 0, cero escrituras de perfiles y cero peticiones de modelos (`legacy-description-fix-receipt.json`). Ese cambio es posterior al Debug probado: sus comprobaciones pertenecen a una cohorte propia y no se le atribuyen los cinco E2E.

**Segunda diferencia posterior: bloqueo de clic real.** La Release preparada con SHA-256 `204158e4fe03507d044ae2480088c5bfb368a31f660f48d0070097359560126b` se abrió, pero Sky confirmó que el selector superior no respondía ni recibía foco; el perfil y las rutas de ajustes sí respondían. El `isolate` de Inicio creaba un contexto de apilamiento en nivel 0: el área global de arrastre de `__root.tsx`, con `z-20`, quedaba por encima del encabezado aunque este tuviera un nivel superior dentro del contexto aislado. Ese candidato y sus recibos se conservaron en `artifacts/qa/assistants-integration-20261104/before-native-hit-test-fix/`.

El arreglo en fuente modifica exactamente cuatro clases de `web-app/src/routes/index.tsx`:

- Contenedor de Inicio: elimina `isolate` y conserva `relative`.
- Fondo decorativo: cambia `-z-10` por `z-0`, conservando `pointer-events-none`.
- Contenedor `home-welcome`: añade `relative`.
- Contenedor `home-composer-shell`: añade `relative`.

La causa de la brecha de QA también quedó identificada: `e2e/helpers/interactions.ts` documenta que el driver implementa el clic mediante `el.scrollIntoView(); el.click(); el.focus()` dentro de la página, sin comprobar el objetivo físico con `elementFromPoint`. Por ello los cinco casos podían pasar aun con una capa de arrastre sobre el botón. Los 11 focales comprueban contratos de renderizado/ruta con componentes simulados; no ejecutan hit-test CSS real. **Bloqueo resuelto en la Release final:** el coordinador abrió el selector mediante Sky y alternó Milo → Kairo → Milo; también abrió las opciones del orbe. Esta evidencia posterior acredita la interacción corregida, sin atribuírsela a los cinco E2E anteriores.

## 7. Pruebas y evidencias

- **Nativo Debug 0.9.3: 5/5 PASS**, primer intento, 20,5 s de pruebas y 25 s totales, salida 0. Recibo [run-cSSLGF/receipt.json](../artifacts/qa/characters-preferences-e2e/run-cSSLGF/receipt.json), SHA-256 `A266D657E3395B850350929D190A4592C87B0988AA83FE58BD47A6A8BC112063`. Binario probado: `5d6e455955598b8ea86102e56c3f263f9c152b3ea599f9bbb8a45af5d932d449`. Log: `artifacts/qa/assistants-integration-20261104/test-native-orb-attempt-1.log`.
- Cubrió seis personajes más el asistente original, modelos registrados de la fixture, selector, volumen editable persistido, orbe, hilo tras recarga, asistente normal/Solo modelo, restablecimiento sin/con punto y deshacer, y categorías MCP. El inicio de voz estaba habilitado y no se pulsó. Se escribió y borró un borrador sin enviarlo.
- **Cohorte web anterior a U+2019: 4911/379 PASS**, conservada en `artifacts/qa/assistants-integration-20261104/test-web-before-spanish-normalization.log`, SHA-256 `338BA69573420F22A0A4576C2FB1A8B89008E1E933BB7CE7DCDD4657A15E8B3B`. Los focales de 176/13 (`assistant-orb-final-tests.log`) y 33/4 (`orb-final-unit.log`) son subconjuntos; no se suman como pruebas únicas adicionales.
- **Corrección de copia: 38/3 PASS**, evidencia en `artifacts/qa/assistants-integration-20261104/legacy-description-fix-receipt.json` y `legacy-description-tests.log`. **Suite posterior a U+2019 y anterior al arreglo de apilamiento: 4913 pruebas en 379 archivos, PASS y salida 0**, conservada en `before-native-hit-test-fix/test-web-accepted.log` (135,29 s). No se presenta como suite de la fuente posterior ni se reutiliza el recibo de cinco E2E para las dos correcciones.
- **Arreglo de apilamiento: 11/11 focales en un archivo**, log real `artifacts/qa/characters-20261104/index-stacking-tests.log`; lint con salida 0 y sin diagnósticos en `index-stacking-lint.log`, en la misma carpeta. No son pruebas de interacción física; esa comprobación pertenece a la posterior inspección de la Release mediante Sky.
- **Fuente final, posterior a ambas correcciones: 4913/379 PASS, salida 0**, en `artifacts/qa/assistants-integration-20261104/test-web-accepted.log` (209,03 s). Build web aceptado con salida 0, Vite en 2 min 7 s (`build-web-accepted.log`). No se suman los focales como pruebas únicas adicionales a la suite global.
- **Release final 0.9.3:** compilación con salida 0 en 11 min 15 s; 61.601.792 bytes, SHA-256 `d5ba68c83019b7bd12e0422811d576ccfa5e5e6be21aab83a3117996c2493902`. `release-build-receipt.json` y `staging-receipt.json`, en la misma carpeta, vinculan `src-tauri/target/release/Rey30-IDvj.exe` y `artifacts/desktop/Rey30-IDvj.exe`. Freeze de 2311 archivos con cero diferencias, SHA-256 `fdf8dfec4d60e5fe0216c04d2d8087facb3ce0ea24f5a3ead1f87835db22d545` (`production-freeze.json` y `production-freeze-check.json`).
- **Interacción nativa de esa Release:** `habitual-ui-093.json` registra el mismo SHA-256, apertura mediante Sky del `.exe`, selector funcional, Milo → Kairo → Milo, orbe de 64 píxeles en la esquina y opciones con «Micrófono apagado» y Solo chat. Se observaron seis personajes más el asistente base, referencias al modelo Jan instalado y descripción base en español. `BAT -Check` terminó con salida 0; la apertura comprobada fue del ejecutable mediante Sky, no una ejecución del BAT.
- **Tipos E2E: salida 0**, log `artifacts/qa/product-20261104/assistants-integration/typecheck-e2e-orb-session.log`. Los guards tienen 6 comprobaciones de datos y 4 de medios aprobadas, con funciones extraídas del spec y métodos sintéticos en Node. Sus recibos están en la misma carpeta. El sondeo posterior del transporte nativo también pasó.

El spec previo y los candidatos descartados permanecen identificados como históricos/no ejecutados. La edición previa de este informe se conserva en `artifacts/qa/product-20261104/assistants-integration/report-before-r20-and-copy-followup.md`.

## 8. Control de calidad

**Funcionalidad e integración:** la primera cohorte aprobó cinco casos y produjo nueve PNG reales inspeccionados. Ventanas solicitadas de 1200×800 y 900×650; viewports de 1184×791 y 884×641. Esfera de 64×64, dock de 100×64 a 64 píxeles del borde superior, sin cubrir escritura o envío. Selector, editor con cabecera/cierre, recuperación y catálogo resultaron legibles en las capturas. Esa inspección estática no detectó el bloqueo del clic; Sky lo confirmó posteriormente y, tras el arreglo y la nueva compilación, comprobó el selector funcional en la Release final. Las evidencias de cada etapa permanecen separadas.

**Seguridad de los cinco E2E:** perfil temporal `rey30-idvj-e2e-oa5TGR`; único hilo vacío `17986d18-872b-4789-9761-29e2ca2ee79f`; solo una consulta `GET /v1/models`. Cero intentos de micrófono, síntesis o transcripción, sin cargas/descargas de pesos, conexiones MCP ni apertura del perfil habitual durante ese spec. Al terminar no quedó un proceso del binario Debug de la prueba.

**Conservación y uso habitual:** durante la preparación se verificaron 459 archivos de runtime sin cambios, tamaño/mtime de los pesos y hashes protegidos conservados, sin leer los pesos. La Release final quedó abierta, PID 11060 iniciado a las 00:38:24 UTC del 5 de noviembre, y se volvió a la conversación que el usuario estaba utilizando, sin copiar su contenido ni enviar mensajes del agente. El recibo registra cero peticiones de inferencia iniciadas por el agente; la actividad independiente del usuario durante la compilación está excluida de esa cuenta.

**Mantenibilidad y accesibilidad:** perfil canónico, estados textuales y controles existentes. Los cinco colores, temas y movimiento se comprobaron mediante clones DOM ocultos del CSS real, sin fingir una escucha. Se verificaron `data-motion=0` y la regla de reducción de movimiento; no se cambió la preferencia del sistema. **Rendimiento:** no se midió latencia del motor de voz. Los builds web, Debug y Release indicados terminaron correctamente; no se afirma ausencia de advertencias.

## 9. Limitaciones

El agente no inició inferencias de Jan ni probó micrófono físico, calidad de personalidad o valoración acústica. La actividad independiente del usuario no se atribuye a la auditoría. La geometría, las capturas y el clic DOM del driver no equivalen a una conversación de voz física de extremo a extremo; la comprobación posterior de Sky acredita el selector y las opciones, no el hardware de audio. MCP usó metadatos declarados, no el registro externo real. Los cinco E2E preceden U+2019 y el arreglo de apilamiento; la fuente y la Release posteriores cuentan con sus pruebas y recibos propios, no con una repetición de esos cinco casos.

## 10. Siguiente paso

La compilación, preparación y comprobación nativa de la Release están cerradas. El siguiente paso lógico, cuando el propietario autorice el uso de hardware, es validar la conversación de voz con su dispositivo de entrada y valorar el sonido. Ese uso resolverá la limitación pendiente sin requerir otra compilación para este cierre. No se amplían funciones ni se autorizan pruebas de modelos mediante este informe.

## 11. Recomendación personalizada

Reinier Tamayo: utilizaría la Release ya abierta, manteniendo el orbe compacto y la selección por hilo. La próxima comprobación útil es el audio con tu dispositivo cuando decidas activarlo; la selección y el indicador ya tienen evidencia nativa propia. Conservaría los recibos separados para distinguir QA técnica, interacción efectiva y aceptación del sonido.
