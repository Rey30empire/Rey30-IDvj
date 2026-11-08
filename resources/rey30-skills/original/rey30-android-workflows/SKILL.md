---
name: rey30-android-workflows
description: Diagnostica flujos Android y la viabilidad de Waydroid según plataforma; prepara una alternativa compatible sin alterar el sistema anfitrión.
---

# Flujos Android de Rey30

La petición original escribió «waidroit»; este procedimiento propio cubre el caso probable de Waydroid sin afirmar que sea el mismo producto. Comprueba la plataforma y el propósito: probar una APK, desarrollar una app, ejecutar una interfaz o conectar un dispositivo.

Waydroid necesita un anfitrión Linux compatible, contenedores y una sesión gráfica adecuada. En Windows no lo presentes como aplicación nativa instalada por añadir esta habilidad. Consulta la documentación vigente de [Waydroid](https://docs.waydro.id/) para requisitos concretos. No actives virtualización, cambies kernel ni prepares WSL silenciosamente.

En un proyecto Android existente inspecciona Gradle, SDK y dispositivos mediante las herramientas disponibles. Usa un dispositivo ya conectado o un emulador ya instalado cuando la tarea lo permita. Identifica destino antes de instalar una APK; conserva datos y aplicaciones del usuario. Si falta SDK, dispositivo o autorización, informa el requisito y prepara la compilación o revisión que pueda hacerse sin él.

Para una integración de escritorio usa ADB u otra herramienta sólo si está realmente disponible y autorizada para ese dispositivo. No inventes pantallas, permisos concedidos ni pruebas de ejecución. Registra artefacto, versión, destino y qué comportamiento se observó.
