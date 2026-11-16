# Catálogo de guías

`apps/frontend/app/components/GuideCatalog.vue` contiene la navegación por categorías, el buscador local y las listas. No conoce el 112, primeros auxilios ni el formato de almacenamiento de las guías.

Cada módulo adapta sus datos a `GuideEntry` (`app/utils/guides.ts`):

```ts
{ id: 'radio', title: 'Reparación de una radio', category: 'Reparación', href: '/manuales/radio', keywords: 'electrónica' }
```

La ruta debe apuntar a un lector real del módulo; el catálogo no crea lectores ni descarga contenido. Las categorías y los contadores se calculan con los documentos recibidos. Una categoría nueva aparece automáticamente con un icono de libro y el color neutro. El módulo puede aportar `categoryLooks` para personalizar sus iconos y colores.

Se pasan `title` y `searchLabel` traducidos, y opcionalmente se enlazan los modelos `query` y `category`. La búsqueda combina todas las palabras introducidas con la categoría seleccionada, sin distinguir mayúsculas ni tildes. No hace peticiones de red.

Los slots `featured`, `sidebar` y `footer` permiten añadir accesos rápidos, ayuda y avisos propios de cada módulo. Los destacados se ocultan al buscar o elegir categoría. Por defecto las listas muestran todas las guías. La opción `overview` permite definir, por categoría, los ids que aparecen en el resumen y el rótulo del botón para abrir la categoría completa. Al buscar o elegir una categoría se muestran todas sus coincidencias. Los contadores siempre reflejan el catálogo completo o el filtro activo.

Emergencias utiliza este componente con los protocolos ya instalados. Solo su página decide los seis accesos urgentes, el resumen de ocho guías de primeros auxilios, el recordatorio del 112 y el enlace PAS. El aviso sanitario permanece fijo sobre la navegación inferior. La composición usa la paleta y las proporciones de la propuesta, mediante `guideCatalog: true` en los metadatos de la página; los demás módulos conservan su presentación. Las fuentes y fechas de revisión permanecen en el lector de cada protocolo.

## Pantallas pequeñas

La página ocupa el espacio entre las barras de estado y acciones. El buscador permanece visible; las listas y el lateral se desplazan por separado. Por debajo de 680 px el lateral se sustituye por un selector de categorías. Las listas y accesos rápidos adaptan sus columnas al ancho disponible y al tamaño de letra. Los botones principales tienen un mínimo de 48 px y las filas de lectura de 44 px.

Validación de navegador (requiere Chrome y la app con su biblioteca local en marcha):

```sh
node tests/e2e/guides.mjs http://127.0.0.1:3000
```

`GUIDE_SHOTS=/ruta/de/capturas` guarda las pantallas. `CHROME_PATH` permite elegir el ejecutable. Las pruebas incluyen las resoluciones 800×480, 1024×600, 390×844 y 1440×900, los cuatro idiomas, texto grande, filtros y regreso del lector. Las respuestas simuladas para probar categorías adicionales y errores de biblioteca se interceptan solo en el navegador de pruebas; no cambian el contenido instalado.
