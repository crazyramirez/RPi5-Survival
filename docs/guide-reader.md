# Lector de guías

`GuideReader.vue` aplica un lenguaje visual común y conserva la estructura de cada documento. Recibe HTML del renderizador seguro de `library`, título y metadatos opcionales. Sus slots de navegación y acciones permiten integrarlo fuera de Emergencias sin añadir teléfono ni avisos sanitarios por defecto.

## Integridad y navegación

`buildGuideDocument` separa los encabezados h2–h4 emitidos por el renderizador; conserva los fragmentos restantes sin reescribirlos. El índice reproduce sus títulos y su orden. Los subapartados mantienen niveles de encabezado reales. Las fuentes aparecen como apartado de navegación únicamente si existen en los metadatos.

En escritorio el índice y la procedencia se muestran en el lateral. En pantallas compactas se utilizan pestañas para índices cortos y un selector para títulos largos o numerosos. El cuerpo se lee de forma continua; seleccionar una sección desplaza la lectura y mueve el foco a su encabezado.

## Presentación editorial

`protocol-reader.ts` contiene los tratamientos revisados de las 41 fichas: prosa, secuencias, condiciones, métodos, inventarios, fases, recetas y advertencias. Una ficha puede combinarlos. Una lista numerada no se interpreta automáticamente como una secuencia de actuación.

Los perfiles están asociados a los índices revisados en los cuatro idiomas. Si se modifica o reordena un apartado, el lector conserva el contenido en presentación neutral hasta revisar el perfil; nunca mantiene silenciosamente una clasificación de acciones que pueda ser incorrecta. Las fichas nuevas sin perfil se leen como prosa y listas originales y no necesitan clasificarse para incorporarse.

Los PDF, páginas HTML y artículos de Kiwix conservan sus lectores y su contenido nativo. Comparten el marco visual, sin convertirse en tarjetas ni perder páginas, tablas o imágenes.

## Verificación

`apps/frontend/test/guide-reader.test.ts` compara texto, orden y listas de todas las fichas y traducciones contra el HTML anterior, además de las estructuras mixtas y la incorporación de guías nuevas.

Con la vista previa y la biblioteca local en marcha:

```sh
READER_SHOTS=/ruta/de/capturas node tests/e2e/reader.mjs http://127.0.0.1:3100
```

La prueba recorre las 41 fichas, tamaños compactos y de escritorio, cuatro idiomas y texto grande; comprueba el índice, cantidades, foco y fuentes. Las fichas adicionales y documentos nativos de prueba se interceptan exclusivamente en el navegador, sin añadir ni modificar contenido instalado.
