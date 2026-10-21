# Arquitectura técnica — POS Tu negocio

## Decisión para el MVP

- **Cliente:** PWA estática (HTML/CSS/JavaScript), servida por HTTPS.
- **Datos primarios:** IndexedDB en la tablet Android.
- **Trabajo offline:** manifiesto + service worker para la shell de la app; operaciones de lectura/escritura sobre IndexedDB sin llamadas de red.
- **Respaldo inicial:** exportación manual de JSON y restauración validada.
- **Impresión inicial:** vista de ticket optimizada para ancho térmico y `window.print()`; adaptador ESC/POS o integración específica se decide después de escoger hardware.

## Almacenes IndexedDB

- `settings`: identidad del negocio, opciones del menú y metadatos de respaldo.
- `products`: catálogo de bebidas y precio actual.
- `carts`: pedidos abiertos de mesas, delivery y ventas rápidas.
- `sales`: ventas cerradas con líneas y precios históricos.

El cierre de una venta crea el registro en `sales` y elimina el pedido abierto en una sola transacción, reduciendo el riesgo de un estado parcialmente actualizado.

## Seguridad y durabilidad

IndexedDB no equivale a respaldo. La app solicita al navegador almacenamiento persistente cuando la función existe, pero esa solicitud puede ser denegada y no protege contra pérdida/avería de la tablet, borrado manual del almacenamiento ni daño del dispositivo. La política inicial es exportar periódicamente fuera de la tablet y practicar la restauración.

Los archivos de respaldo contienen datos en JSON legible y no están cifrados. Mantenerlos privados. Un siguiente incremento puede cifrar el archivo con una contraseña elegida por el dueño, después de revisar bien la gestión de claves y el flujo de recuperación.

No se almacenan claves de nube en el JavaScript y este MVP no se conecta a una base remota. Si se agregara sincronización en otra etapa, debe incluir autenticación, aislamiento de datos por negocio, colas idempotentes, manejo de conflictos y control de respaldos.

## Impresión

`window.print()` abre el diálogo que el navegador y Android tengan configurado. Eso permite probar muchas configuraciones, pero no garantiza compatibilidad con toda ticketera. Antes de comercializar, validar modelo, USB/Bluetooth/Wi-Fi, ancho del papel, caracteres peruanos, cortes, reimpresión y desconexiones.

## Próximos hitos recomendados

1. Probar durabilidad local y recuperación en la tablet objetivo.
2. Definir integración exacta con el modelo de impresora que se vaya a vender.
3. Añadir bloqueo/PIN administrativo y protección de exportaciones si el riesgo del negocio lo requiere.
4. Implementar copia externa automática opcional si los comerciantes la valoran.
5. Probar piloto acompañado en un negocio antes de depender de este sistema en operaciones diarias.
