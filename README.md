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

## Configuración local

Copiar `.env.example` a `.env`, definir como mínimo `SESSION_SECRET` y usar:

```bash
npm install
npm run build
npm start
```

Sin `DATABASE_URL`, el modo local conserva los datos y los adjuntos en `data/consejo.json` y `data/uploads`. No es un modo válido para Vercel.

La cuenta `gabriel.bailly@gmail.com` es administradora inicial de San Miguel y San Rafael y no tiene contraseña inicial en una instalación nueva. Debe usar «Olvidé mi contraseña» para establecerla. La recuperación requiere `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM` globales.

Cada administrador puede añadir usuarios y otorgarles acceso solamente a su reunión desde Administración. Los usuarios pueden restablecer su propia contraseña con el mismo enlace de acceso.

## Despliegue en Vercel

1. Crea una base de datos Neon y copia su cadena de conexión SSL en `DATABASE_URL`. Para conservar datos de `data/consejo.json`, ejecuta una vez `npm run migrate:data` con esa variable configurada antes del primer despliegue. La importación sólo escribe en una Neon vacía y no sobrescribe datos existentes.
2. Crea un almacén Vercel Blob y añade su token de lectura/escritura como `BLOB_READ_WRITE_TOKEN`.
3. Importa el repositorio en Vercel. Las rutas API las atiende `api/[...path].js` y Vercel sirve directamente los recursos estáticos de `public`.
4. En Production y Preview configura `SESSION_SECRET` aleatorio, `APP_URL=https://tu-proyecto.vercel.app`, `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET` aleatorio. Vercel usa PostgreSQL para las sesiones, el estado, los usuarios y los tokens de recuperación. No se escribe en el sistema de archivos de Vercel.
5. Para Google OAuth configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL=https://tu-proyecto.vercel.app/api/auth/google/callback`. Añade exactamente esa URL a los URI de redirección autorizados de Google. El frontend usa `/api/auth/google`.
6. Para recuperación y recordatorios configura `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `SMTP_FROM`. Para push configura `ONESIGNAL_APP_ID` y `ONESIGNAL_REST_API_KEY`; la configuración existente de OneSignal del navegador se mantiene.

La primera conexión a Neon crea `consejo_state` y las dos reuniones iniciales. El estado completo se almacena como JSONB y cada escritura usa una revisión optimista: si dos cambios coinciden, uno recibe HTTP 409 para que se recargue la página en vez de sobrescribir el otro. `connect-pg-simple` crea y utiliza la tabla `user_sessions`.

Los adjuntos se suben con memoria a Vercel Blob y en los datos sólo se entrega la URL autenticada `/api/uploads/...`. El endpoint comprueba la sesión y el acceso a la reunión antes de redirigir a Blob. Vercel Blob de este tipo es público por diseño: quien conserve la URL final de Blob podrá abrirla, por lo que no se debe compartir y no se persiste ni se muestra como enlace directo en la aplicación.

### Recordatorios en Vercel

El intervalo en memoria sólo se ejecuta en local. En Vercel, el cron llama a `GET /api/cron/reminders` y Vercel envía `Authorization: Bearer $CRON_SECRET`; el endpoint rechaza peticiones sin ese secreto. El cron está configurado cada minuto para poder respetar la hora y el día elegidos en la aplicación. Los cron de un minuto requieren un plan de Vercel que los admita; en Hobby el mínimo es diario y entonces no se pueden garantizar horas configurables ni precisión al minuto. La comparación se realiza en UTC en Vercel y el envío puede retrasarse unos minutos por la plataforma.

Reuniones configuradas:

- San Miguel
- San Rafael

## Variables de entorno

Consulta `.env.example` para la lista completa. No subas `.env` ni tokens. `ADMIN_EMAILS` puede añadir administradores globales separados por comas; el administrador inicial siempre es `gabriel.bailly@gmail.com`.
