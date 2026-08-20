# Consejo local

Aplicación privada para gestionar las reuniones de Consejo local.

Incluye:

- Login local y acceso con Google cuando se configuran credenciales OAuth.
- Dos reuniones independientes: San Miguel y San Rafael.
- Lista de usuarios autorizados editable por la administración de cada reunión.
- Dashboard con enlaces frecuentes editables.
- Tabla de asuntos para la próxima reunión con estado, descripción y documentos/enlaces adjuntos.
- Tabla de acuerdos.
- Creacion de tablas personalizadas con campos definidos por el usuario.

## Configuracion

Copiar `.env.example` a `.env` en producción y cambiar `SESSION_SECRET`, `ADMIN_EMAILS` y, si procede, las credenciales de Google.

La cuenta `gabriel.bailly@gmail.com` es administradora inicial de ambas reuniones y no tiene contraseña predefinida. Debe usar «Olvidé mi contraseña» para establecerla. La recuperación requiere configurar `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` globales.

Cada administrador puede añadir usuarios y otorgarles acceso solamente a su reunión desde Administración. Los usuarios pueden restablecer su propia contraseña con el mismo enlace de acceso.

El callback de Google para producción es:

`https://consejo.gecoas.es/auth/google/callback`

Reuniones configuradas:

- San Miguel
- San Rafael

## Desarrollo

```bash
npm install
npm run build
npm start
```
