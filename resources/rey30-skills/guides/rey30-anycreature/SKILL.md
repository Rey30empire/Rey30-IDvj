---
name: rey30-anycreature
description: Prepara criaturas procedurales y comprueba sus contratos geométricos y de exportación, usando AnyCreature sólo cuando su motor esté disponible.
license: Apache-2.0
---

# AnyCreature — guía propia de producción

Fuente: [Ariescar/anyCreature](https://github.com/Ariescar/anyCreature). Su motor procedural y validadores Node/Python son programas externos; instalar esta habilidad no añade esos ejecutables ni demuestra renderizado AMD.

Identifica el destino del asset: motor, formato, escala, ejes, presupuesto, articulaciones y animaciones necesarias. Revisa la versión y manual del motor disponible, sus entradas y ejemplos. No inventes nombres de funciones o un formato de configuración a partir del título del proyecto.

Si AnyCreature está instalado, inspecciona su entorno y usa el procedimiento documentado para generar una criatura pequeña en una salida separada. No ejecutes `setup.ps1` ni descargues dependencias durante una revisión estática. Si no está disponible, prepara la especificación geométrica y utiliza una herramienta 3D ya conectada únicamente si satisface el encargo; informa qué herramienta produjo el resultado.

Comprueba estructura del archivo, mallas, normales, materiales, escala, articulaciones y animaciones relevantes. Inspecciona un render y después la importación en el motor objetivo cuando exista esa posibilidad. Un GLB válido o una métrica de topología no demuestra anatomía, movimiento ni calidad visual. Conserva licencias de recursos y distingue archivo exportado, revisión visual e integración real.
