---
name: rey30-mod-creator
description: Crea y corrige mods de videojuegos a partir del juego, versión, cargador y proyecto reales, con instalación reversible y prueba específica.
---

# Creador de mods de Rey30

Inspecciona primero archivos del proyecto para identificar juego, versión, motor y cargador de mods. No uses un manifiesto de otro ecosistema: ASI, ScriptHookV, RAGE Plugin Hook, FiveM, Fabric, Forge y BepInEx tienen contratos distintos. Si no puedes identificarlos, solicita ese dato antes de generar binarios incompatibles; puedes avanzar con una inspección de sólo lectura.

Define qué debe cambiar el mod y dónde ocurre: evento, tecla, entidad, asset o interfaz. Examina los ejemplos y API incluidos en ese SDK. Usa documentación oficial para nombres y firmas que no estén en el proyecto. Mantén recursos originales y configura una carpeta de salida independiente.

Implementa el comportamiento mínimo completo y su apagado: liberar entidades, retirar eventos, detener bucles y guardar preferencias cuando corresponda. No sobrescribas ejecutables ni archivos del juego base. Para un cambio que requiere reemplazar un archivo, crea una copia identificable y una ruta de restauración. No agregues funciones de evasión de anticheat o alteración de partidas ajenas.

Compila para la versión real del runtime y empaqueta manifiesto, dependencias permitidas y guía breve de destino. La compilación no demuestra funcionamiento dentro del juego. Si puedes probarlo, observa activación, acción principal, desactivación, errores y coste del bucle; si falta el juego o no puedes interactuar con él, entrega el paquete como compilado y deja explícita la comprobación pendiente.

Para assets revisa escala, ejes, colisiones, texturas, animación y presupuesto adecuado al uso. Un sprite o un GLB válido no demuestra que el cargador del juego lo acepte.
