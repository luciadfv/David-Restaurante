# POS Tu negocio — MVP 0.1

Sistema de punto de venta offline-first, en español, pensado como primera versión para un pequeño restaurante o puesto de comida en Perú.

## Incluye

- Configuración inicial con nombre del negocio, teléfono y número de mesas.
- Almacenamiento local con IndexedDB.
- PWA instalable (icono propio) y archivos de la interfaz cacheados para abrir sin conexión después de instalar/cargar la aplicación.
- Mesas con pedidos que permanecen guardados al cerrar o recargar la aplicación.
- Delivery identificado por cliente/referencia.
- Flujo de menú completo: primero se indica la cantidad y luego se registran entrada, segundo y refresco por cada menú.
- Precio editable del menú completo; empieza en S/ 10.
- Catálogo de bebidas con precios configurables.
- Ventas rápidas de menú o bebidas.
- Cierre de venta con método de pago, historial, reporte por canal y exportación CSV.
- Ticket de control interno mediante el diálogo de impresión del navegador.
- Copia de seguridad JSON y restauración del archivo.

## Importante: límites de esta versión

Esta es una versión MVP para pruebas, no un producto listo para operar como único registro comercial de un negocio.

- Las ventas y la configuración permanecen en la base local del navegador de esa tablet. Si pierdes o dañas la tablet y no conservas una copia fuera del dispositivo, puedes perder los datos.
- Las copias JSON de esta versión no están cifradas. Guárdalas en un lugar privado y seguro.
- La restauración reemplaza los datos existentes; exporta una copia actual antes de restaurar.
- No hay sincronización automática en la nube, múltiples usuarios ni PIN de administrador en esta versión.
- La impresión usa el diálogo de impresión de Android/Chrome. La impresión térmica directa depende del modelo de ticketera, el método de conexión y el servicio/controlador disponible. Se debe probar antes de comprar hardware.
- El ticket está rotulado como control interno y no es un comprobante de pago electrónico autorizado por SUNAT.
- No gestiona inventario, cuentas por cobrar, cierre de caja detallado, IGV ni emisión tributaria electrónica.

## Cómo probar en un ordenador

1. Descomprime la carpeta.
2. Abre una terminal dentro de `pos_tu_negocio`.
3. Ejecuta `python -m http.server 8000`.
4. En Chrome abre `http://localhost:8000`.
5. Configura un nombre de negocio, abre una mesa y registra pedidos de prueba.

Abrir `index.html` haciendo doble clic (`file://`) no es el método recomendado: la instalación PWA y el service worker requieren HTTPS o localhost. No uses datos de clientes reales durante las primeras pruebas.

## Cómo instalar en la tablet Android

La PWA debe estar publicada en una dirección HTTPS para poder instalarse correctamente.

1. Sube los archivos de esta carpeta a un servicio de alojamiento estático HTTPS de confianza.
2. Abre la dirección de tu POS en Chrome desde la tablet.
3. Espera a que la página cargue completamente mientras hay conexión.
4. Abre el menú de Chrome (⋮) y selecciona **Instalar aplicación** o **Añadir a pantalla de inicio**.
5. Abre la aplicación desde el icono creado y realiza pruebas sin internet.
6. Crea una copia de seguridad y verifica que puedas restaurarla antes de registrar ventas reales.

No compartas públicamente la URL si en el futuro incorporas funciones remotas o datos privados; esta versión guarda los datos de negocio localmente en el navegador de cada instalación.

## Prueba de aceptación mínima

- [ ] Registrar una venta de prueba.
- [ ] Cerrar Chrome completamente y volver a abrir el POS; confirmar que la venta continúa en Reportes.
- [ ] Crear un pedido en una mesa, recargar, volver a la mesa y confirmar que el pedido sigue abierto.
- [ ] Desactivar internet con la aplicación ya instalada; navegar entre pantallas y registrar una venta.
- [ ] Exportar una copia JSON y guardarla fuera de la tablet.
- [ ] Restaurar esa copia en una instalación de prueba y verificar que coincidan ventas y totales.
- [ ] Imprimir tickets con la ticketera exacta que se planea comprar y probar qué ocurre al desconectarla.

## Archivos

- `index.html`: estructura principal.
- `styles.css`: interfaz adaptable a tablet y móvil.
- `app.js`: lógica de ventas, base de datos local, reportes y respaldos.
- `manifest.webmanifest`: metadatos de instalación de la PWA.
- `sw.js`: caché de recursos de aplicación.
- `icons/`: iconos de instalación.
