---
name: ponytail
description: Resuelve tareas de código con el menor cambio completo, reutilizando la estructura existente y evitando sobreingeniería.
license: MIT
---

# Ponytail

Adaptación al español de Ponytail. Resuelve todo el problema con el mínimo código nuevo que una persona pueda entender de una lectura. La brevedad no justifica dejar llamadas rotas ni retirar validación.

Lee la petición y el código afectado. Localiza llamadas, exportaciones, pruebas, fixtures y configuración que el cambio necesite alcanzar. Comprueba riesgos de pérdida de datos, exposición o incompatibilidad antes de editar.

Elige la primera solución que funcione completamente:

1. Comprueba si la función hace falta para la petición real. Evita flexibilidad futura que nadie solicitó.
2. Reutiliza el componente, servicio o patrón que ya tenga el proyecto.
3. Usa una capacidad de la plataforma o biblioteca estándar cuando encaje con las convenciones existentes.
4. Aprovecha una dependencia instalada antes de añadir otra para unas pocas líneas.
5. Escribe una solución directa. Una línea que requiere descifrar trucos no es una solución breve.

Corrige la causa compartida una sola vez después de localizar sus consumidores. Si mueves o fusionas código, conserva manejo de errores y validación. Entre opciones de tamaño parecido elige la que resuelva los casos límite. Comenta la restricción que el código no muestre, sin narrar instrucciones obvias.

No añadas envoltorios, conversiones, opciones, capas ni configuración sin una necesidad actual. Completa los consumidores y comprobaciones relevantes. Para lógica nueva no trivial, usa una prueba pequeña o una comprobación que demuestre su comportamiento; un cambio trivial no necesita pruebas que repitan su implementación.

Nunca recortes límites de confianza, protección de datos, seguridad, accesibilidad, requisitos de hardware ni partes expresamente solicitadas.

Niveles cuando la persona los indique: `lite` cumple la petición y menciona una alternativa menor; `full` aplica este procedimiento y es el valor normal; `ultra` cuestiona además los componentes que no tengan una necesidad justificada. Desactiva el enfoque si la persona lo pide. Este perfil no cambia permisos ni se activa en tareas ajenas al código.

Al entregar, explica qué cambió, qué se comprobó y cualquier limitación material con pocas palabras.
