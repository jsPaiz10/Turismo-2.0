# Turismo Escondido · El Salvador

Web de turismo salvadoreña con video, animación, relieve 3D, destinos y recorridos personalizados. **Edición 5.1 para GitHub y servidor público.**

## Ejecutar en tu computadora

Instala **Node.js 24.19 de la rama 24** y ejecuta en esta carpeta:

```sh
npm ci --ignore-scripts
npm start
```

Abre **http://localhost:3000**. En Windows también puedes abrir `INICIAR.cmd`.

## Publicar la web completa

Sigue [la guía de GitHub y publicación](docs/PUBLICAR-EN-GITHUB.md). El repositorio conserva el código; el sitio con cuentas y base de datos se ejecuta en un servidor Node.js con HTTPS y disco persistente. GitHub Pages no ejecuta este backend.

**No subas solamente el ZIP al repositorio.** Descomprímelo y sube el contenido con GitHub Desktop o Git. El video principal supera el límite de carga por archivo de la interfaz web de GitHub, pero todos los archivos están por debajo del límite de Git normal.

La raíz debe contener `package.json`, `package-lock.json`, `server.mjs`, `public/` y `src/`.

## Funciones

- Destinos, filtros, mapa 3D, videos y escenas culturales de El Salvador.
- Registro e inicio de sesión; contraseñas protegidas con scrypt.
- Favoritos y un recorrido guardado por persona.
- Nombre del recorrido, fecha, notas y destino de cada día.
- Panel privado `/control` para usuarios y recorridos.
- Excel automático: Usuarios, Recorridos, Paradas y Favoritos.

La base y el Excel se crean al arrancar. Esta entrega **no contiene usuarios, contraseñas, sesiones ni reportes de la instalación original**. No hay administrador predeterminado.

## Administrador

Registra tu cuenta en tu propia web e inicia sesión para comprobar que la controlas. Después, desde la consola del servidor:

```sh
node scripts/admin.mjs tu-correo@ejemplo.com
```

El permiso se otorga a esa cuenta existente, conservando su contraseña. No se otorgan permisos al primer visitante ni por un correo escrito en el código. Consulta [la explicación de la base y el Excel](docs/BASE-DE-DATOS-Y-EXCEL.md).

## Configuración

Para desarrollo, copia `.env.example` a `.env` y ejecuta `npm run start:local`. Nunca publiques `.env` ni `data/`.

| Variable | Local | Servidor público |
|---|---|---|
| `HOST` | `127.0.0.1` | `0.0.0.0` |
| `PORT` | `3000` | Puerto asignado por el proveedor |
| `NODE_ENV` | `development` | `production` |
| `PUBLIC_ORIGIN` | `http://localhost:3000` | Dirección HTTPS exacta sin ruta |
| `DATA_DIR` | `./data` | Ruta del disco persistente |
| `EXCEL_ENABLED` | `true` | `true` |

En Render se utiliza automáticamente `RENDER_EXTERNAL_URL` si no defines `PUBLIC_ORIGIN`. Para un dominio propio, define `PUBLIC_ORIGIN` con ese dominio. El proxy debe conservar el Host y terminar HTTPS. No publiques directamente el backend por HTTP en producción.

## Pruebas

```sh
npm test
```

GitHub Actions ejecuta las pruebas con cada cambio y solicitud de incorporación. Las pruebas usan bases temporales y no modifican registros reales. Se comprueba también un XLSX real y que los textos de usuarios no se conviertan en fórmulas.

## Estructura

- `server.mjs`: servidor HTTP y API.
- `src/`: catálogo, vistas, seguridad, base y generador de Excel.
- `public/`: imágenes, videos, modelos y estilos.
- `scripts/`: reporte y herramienta administrativa.
- `test/`: pruebas de integración y seguridad.
- `docs/`: publicación, arquitectura y fuentes de medios.
- `Dockerfile`: alternativa para servidores con contenedores.

## Datos y respaldo

Usa una sola instancia del servidor. Mantén `DATA_DIR` en disco persistente y configura respaldos privados del proveedor. Excel es un reporte, no un respaldo de la base. Ninguno de estos archivos debe subirse a GitHub. El reporte se actualiza mientras el servidor está funcionando; las copias descargadas reflejan ese momento.

## Fuentes y derechos

Las fuentes de fotografías, videos, modelos y tipografías están en `/creditos`, `docs/` y los avisos de `public/vendor/`. Publicar el código no cambia las licencias de esos recursos. Esta entrega no concede una licencia nueva sobre la marca ni sobre material de terceros.
