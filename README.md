<p align="center">
  <img src="src-tauri/icons/128x128.png" width="128" height="128" alt="Comparetica Logo" />
</p>

# Comparetica

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
</p>

> [!NOTE]
> **Estado del proyecto**: Este proyecto se encuentra en **pleno desarrollo** y es una **versión beta**. Algunas características y funcionalidades podrían cambiar o refinarse en futuras actualizaciones.

**Comparetica** es una aplicación de escritorio B2B diseñada para consultores y asesores energéticos en España. Permite realizar estudios comparativos detallados de facturas de luz (tarifa 2.0TD) y gas (tarifa RL.1) de manera offline y local, identificando oportunidades de ahorro y gestionando las comisiones del asesor de forma profesional y discreta.

---

## 🚀 Características Principales

- **Comparador y Motor de Cálculo**: Proyecta consumos y calcula el gasto anualizado estimado del cliente (incluyendo alquiler de contador, impuestos y cargos regulados) frente a las tarifas disponibles en el mercado.
- **Precisión de hasta 6 Decimales**: Soporte completo para introducir precios de potencia (€/kW/año) y energía (€/kWh) con una precisión de hasta 6 decimales. Si no se especifican todos, los dígitos restantes se rellenan automáticamente con ceros (ej. `0.15` se calcula y muestra como `0.150000`).
- **Precios de la Energía Regulada (PVPC) en Tiempo Real**: Pantalla de inicio que consulta directamente a la API oficial de Red Eléctrica de España (REE) para mostrar el precio medio diario del PVPC, el precio del mercado pool diario (OMIE) y el desglose de precios regulados por horas en formato visual e interactivo.
- **Gestión de Tarifas (CRUD)**: Panel interno para registrar, editar y dar de baja comercializadoras y tarifas de luz o gas.
- **Modo Privado (Confidencialidad)**: Interruptor en la barra lateral que oculta visualmente (difumina) las comisiones del asesor de cara al cliente en todas las vistas de la aplicación durante presentaciones en vivo.
- **Seguridad y Cifrado Local Zero-Plaintext**: Base de datos SQLite cifrada en reposo mediante ChaCha20-Poly1305 con derivación de clave por Argon2id (`vault.json`). Operaciones de descifrado y guardado 100% en memoria (`rusqlite::serialize`/`deserialize`) sin persistir ficheros de base de datos planos en disco. Persistencia atómica (`fs::rename` con sincronización física) para máxima tolerancia a fallos ante caídas o apagados inesperados.
- **Gestión Integral de Cartera y Renovaciones**: Módulos completos para administración de clientes, agentes comerciales, panel de alertas de vencimiento de contratos y asistente guiado (*wizard*) para nuevos estudios.
- **Reportes Ejecutivos en PDF**:
  - **Previsualización en Pantalla**: Permite ver el diseño del reporte en tiempo real en un visor integrado sin necesidad de guardarlo en disco.
  - **Exportación Local**: Generación nativa de un PDF estético y estructurado con el desglose de conceptos para entregar al cliente.
- **Copias de Seguridad (Backups)**:
  - **Manuales**: Posibilidad de exportar e importar la base de datos de forma segura en cualquier ruta del equipo.
  - **Automáticas**: Copia de seguridad generada automáticamente en el directorio `home` (o ruta personalizada definida por el usuario) al cerrar la aplicación.
  - **Política de Retención**: Limpieza automática de copias de seguridad antiguas basada en el número de días definidos por el usuario (por defecto, 7 días).

---

## 🛠️ Requisitos e Instalación

### Requisitos del Sistema
Para compilar y ejecutar el proyecto desde el código fuente, necesitas:
- **Node.js** (versiones LTS actualmente soportadas) y **pnpm** (versión 11 o superior).
- **Rust** (entorno de compilación cargo) y herramientas de compilación de C++ (requerido por Tauri).

### Instalación de Dependencias
Ejecuta el siguiente comando en la raíz del proyecto para descargar las librerías necesarias:
```bash
pnpm install
```

### Ejecutar en Desarrollo
Para iniciar la aplicación de escritorio en modo de desarrollo local:
```bash
pnpm tauri dev
```

### Ejecutar Pruebas Automatizadas
El proyecto incluye suites de pruebas unitarias y de integración tanto para el frontend como para el backend nativo:

- **Pruebas de Frontend (JavaScript)**: Ejecutadas con el test runner nativo de Node.js, sin dependencias externas pesadas:
  ```bash
  pnpm test
  # o directamente: node --test
  ```
- **Pruebas de Backend (Rust)**: Verifican la persistencia atómica, el ciclo de vida del almacén seguro (`vault`) y las operaciones criptográficas en memoria:
  ```bash
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

---

## 📦 Compilación y Distribución

Para generar un instalador optimizado de producción para Windows (.MSI):
```bash
pnpm tauri build
```

> [!WARNING]
> ### ⚠️ Advertencia de Seguridad de Windows al Instalar
> Al instalar la aplicación en un equipo nuevo a través del archivo `.msi`, es muy probable que el sistema operativo o el filtro SmartScreen de Windows muestren una alerta de seguridad de tipo **"Editor no reconocido"** o **"Windows protegió su PC"**.
> 
> **¿Por qué ocurre esto?**
> Esto se debe a que el instalador ejecutable generado no está firmado digitalmente con un certificado de firma de código válido emitido por una autoridad certificadora oficial (como DigiCert o Sectigo). 
> 
> **Solución a futuro:**
> La firma del código es un tema planificado para resolverse en el futuro. Mientras tanto, puedes instalar y ejecutar la aplicación de forma segura haciendo clic en **"Más información"** en el cuadro de diálogo de Windows y posteriormente seleccionando el botón **"Ejecutar de todas formas"**.

---

## 📂 Estructura del Código

La aplicación sigue una arquitectura desacoplada, reactiva y modular, dividida entre el frontend en ES Modules (vanilla JavaScript con Material Design 3) y el backend nativo en Rust orquestado por Tauri:

```
├── src/                               # Frontend de la aplicación (Webview)
│   ├── index.html                     # Contenedor principal, navegación y plantillas de modales M3
│   ├── css/                           # Estilos globales y variables de diseño Material Design 3
│   └── js/
│       ├── app.js                     # Ciclo de vida, router SPA y listeners globales
│       ├── ipc.js                     # Capa de abstracción centralizada para IPC con Tauri (v1 y v2)
│       ├── events.js                  # Catálogo inmutable (APP_EVENTS) y bus de eventos desacoplado
│       ├── ui.js                      # Sistema de notificaciones toast y diálogo modal interactivo
│       ├── db.js                      # Capa de acceso a datos SQLite cifrados y tabla ajustes
│       ├── auth.js                    # Autenticación, control de sesión maestra y agente activo
│       ├── calculator.js              # Motor matemático de facturación (2.0TD, 3.0TD, gas, autoconsumo)
│       ├── pdf.js                     # Generación nativa y previsualizador dinámico de reportes PDF
│       ├── csv_importer.js            # Importación y normalización masiva de tarifas desde CSV
│       ├── components/                # Componentes reutilizables de UI
│       │   └── date_range_picker.js   # Selector de rangos de fechas interactivo
│       └── views/                     # Controladores de vista modulares e independientes
│           ├── home.js                # Precios PVPC y mercado mayorista (OMIE) en tiempo real
│           ├── calculator_view.js     # Comparador dinámico de ofertas y estudios energéticos
│           ├── wizard.js              # Asistente guiado paso a paso para nuevos estudios
│           ├── history.js             # Historial, filtrado y gestión de comparativas guardadas
│           ├── tariffs.js             # Catálogo y mantenimiento de comercializadoras y tarifas (CRUD)
│           ├── clients.js             # Gestión de la cartera de clientes y contratos asociados
│           ├── agents.js              # Gestión y asignación de agentes comerciales
│           ├── renewals.js            # Panel de alertas y control de vencimientos de contratos
│           ├── settings.js            # Configuración de empresa, logotipo y umbrales de alerta
│           └── backup.js              # Gestión de copias de seguridad manuales y programadas
│
├── src-tauri/                         # Backend nativo en Rust (Tauri)
│   ├── Cargo.toml                     # Dependencias nativas (rusqlite, chacha20poly1305, argon2, etc.)
│   ├── tauri.conf.json                # Configuración de ventana, capacidades y CSP estricta
│   └── src/
│       ├── main.rs                    # Punto de entrada y runtime nativo de Tauri
│       ├── lib.rs                     # Registro de comandos IPC, diálogos y eventos de la aplicación
│       └── db.rs                      # Persistencia SQLite cifrada en memoria (serialize/deserialize),
│                                      # escrituras atómicas (fs::rename), vault y copias de seguridad
│
├── test/                              # Suite de pruebas automatizadas (Node.js test runner)
│   ├── calculator.test.js             # Verificación del motor de facturación (luz, gas, autoconsumo, bono)
│   ├── ipc_and_ui.test.js             # Verificación de capa IPC, bus de eventos y notificaciones UI
│   └── settings_dom.test.js           # Verificación de integridad del DOM y selectores personalizados
│
└── docs/                              # Especificaciones de diseño, arquitectura y planes de ejecución
```

---

## ⚖️ Descargo de Responsabilidad (Disclaimer)

Esta aplicación es una herramienta de simulación y estimación de ofertas energéticas para consultores profesionales. Al utilizar este software, aceptas las siguientes condiciones:

1. **Sin Garantías**: El software se proporciona "tal cual" (*as is*), sin garantías de ningún tipo, explícitas o implícitas, sobre la precisión, exhaustividad, vigencia o ausencia de errores en las fórmulas de cálculo o tarifas cargadas.
2. **Exención de Responsabilidad**: En ningún caso el autor del software (MrTech0) será responsable por reclamaciones, pérdidas de datos, perjuicios comerciales, pérdidas de clientes o cualquier otro daño directo, indirecto o accidental derivado del uso o de la imposibilidad de uso de esta herramienta.
3. **Responsabilidad del Usuario**: Es responsabilidad exclusiva del usuario (consultor o asesor) verificar la validez, vigencia y exactitud de todas las tarifas y términos de facturación directamente con las comercializadoras antes de formalizar cualquier contrato o emitir ofertas comerciales definitivas a clientes externos.
 
---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **GNU Affero General Public License v3.0** ([AGPL-3.0-or-later](LICENSE)).

Eres libre de usar, estudiar, modificar y compartir este software. De acuerdo con los términos de la licencia AGPLv3, cualquier modificación o trabajo derivado que se distribuya o se ponga a disposición de usuarios a través de una red o servicio debe publicarse bajo esta misma licencia y con su código fuente completo accesible a la comunidad. Para más detalles, consulta el archivo [LICENSE](LICENSE).

