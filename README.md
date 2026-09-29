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
- **Precisión de hasta 10 Decimales**: Los precios de potencia (€/kW/año) y energía (€/kWh) se muestran con hasta 10 decimales cuando hacen falta, con un mínimo de 2 y sin ceros finales redundantes (por ejemplo, `0.15` se muestra como `0.15`).
- **Precios de la Energía Regulada (PVPC)**: La pantalla de inicio consulta la API oficial de Red Eléctrica de España (REE) para mostrar el precio medio diario del PVPC y el desglose por horas. También muestra el precio medio mayorista cuando REE facilita ese indicador; en caso contrario indica «No disponible».
- **Gestión de Tarifas (CRUD)**: Panel interno para registrar, editar y dar de baja comercializadoras y tarifas de luz o gas.
- **Modo Privado (Confidencialidad)**: Interruptor en la barra lateral que oculta visualmente (difumina) las comisiones del asesor de cara al cliente en todas las vistas de la aplicación durante presentaciones en vivo.
- **Seguridad y Cifrado Local**: Base de datos SQLite cifrada en reposo mediante AES-256-GCM, con derivación de claves por Argon2id y metadatos de bóveda en `vault.json`. Las operaciones habituales de descifrado y guardado usan memoria (`rusqlite::serialize`/`deserialize`); el archivo cifrado se escribe primero en un temporal sincronizado y después se sustituye mediante `fs::rename`.
- **Gestión Integral de Cartera y Renovaciones**: Módulos completos para administración de clientes, agentes comerciales, panel de alertas de vencimiento de contratos y asistente guiado (*wizard*) para nuevos estudios.
- **Reportes Ejecutivos en PDF**:
  - **Previsualización en Pantalla**: Permite ver el diseño del reporte en tiempo real en un visor integrado sin necesidad de guardarlo en disco.
  - **Exportación Local**: Generación nativa de un PDF estético y estructurado con el desglose de conceptos para entregar al cliente.
- **Copias de Seguridad (Backups)**:
  - **Manuales**: Exportación de copias cifradas `.bak` e importación con verificación de la contraseña y del contenido antes de sustituir los datos actuales. También se pueden importar bases SQLite antiguas `.db` sin cifrar.
  - **Automáticas**: Copia `.bak` generada al cerrar la aplicación en `Comparetica_backups` dentro del directorio personal (o en la ruta personalizada definida por el usuario).
  - **Política de Retención**: Limpieza automática de copias de seguridad antiguas basada en el número de días definidos por el usuario (por defecto, 7 días).

---

## 🛠️ Requisitos e Instalación

### Configuración Automática en Windows (Recomendado)
Si estás preparando un equipo nuevo o formateado con Windows 10/11, puedes instalar y configurar automáticamente todas las herramientas necesarias ejecutando el script desatendido incluido en el repositorio desde una consola de PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Este script se encarga de:
1. Comprobar y solicitar permisos de Administrador automáticamente si es necesario (conservando la ruta de trabajo actual).
2. Instalar o verificar **Git**, **Node.js LTS**, **pnpm** y **Microsoft Edge WebView2 Runtime** mediante `winget`.
3. Detectar e instalar **Visual Studio Build Tools con C++ (MSVC)** si aún no están presentes en el sistema.
4. Instalar y configurar **Rustup** con la toolchain `stable-x86_64-pc-windows-msvc` de forma desatendida.
5. Refrescar el `PATH` de la sesión e inicializar las dependencias del proyecto (`pnpm install`) y hooks locales de Git (`.githooks`).

---

### Configuración Manual
Si prefieres configurar tu entorno manualmente o trabajas en otro sistema operativo:

#### Requisitos del Sistema
Para compilar y ejecutar el proyecto desde el código fuente, necesitas:
- **Node.js** (versiones LTS actualmente soportadas) y **pnpm** (versión 11 o superior).
- **Rust** (entorno de compilación cargo) y herramientas de compilación de C++ (requerido por Tauri).
- **Microsoft Edge WebView2 Runtime** (en Windows).

#### Instalación de Dependencias
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

El frontend usa módulos de JavaScript y estilos CSS; Tauri conecta la interfaz con el backend nativo en Rust. Estos son los directorios y archivos principales:

```
├── src/                               # Interfaz de la aplicación
│   ├── index.html                     # Navegación, vistas y diálogos
│   ├── styles/
│   │   ├── main.css                   # Estilos globales y variables de diseño
│   │   └── components.css             # Componentes y estados visuales
│   ├── assets/                        # Imágenes y biblioteca jsPDF incluida
│   └── js/
│       ├── app.js                     # Inicio de la aplicación y navegación entre vistas
│       ├── auth.js                    # Acceso con contraseña maestra y recuperación
│       ├── db.js                      # Acceso a datos mediante comandos nativos
│       ├── ipc.js                     # Puente de llamadas y eventos de Tauri
│       ├── events.js                  # Eventos internos de la interfaz
│       ├── ui.js                      # Notificaciones y diálogos comunes
│       ├── calculator.js              # Cálculos de facturación de luz y gas
│       ├── pdf.js                     # Generación y vista previa de PDF con jsPDF
│       ├── csv_importer.js            # Importación CSV de clientes y renovaciones
│       ├── utils/validators.js        # Validación de DNI, CIF, NIE y CUPS
│       ├── components/date_range_picker.js
│       └── views/                     # Controladores de cada pantalla
│           ├── home.js                # Precios PVPC y mayoristas
│           ├── calculator_view.js     # Comparador de tarifas
│           ├── wizard.js              # Configuración inicial guiada
│           ├── history.js             # Historial de comparativas
│           ├── tariffs.js             # Comercializadoras y tarifas
│           ├── clients.js             # Clientes y puntos de suministro
│           ├── agents.js              # Agentes comerciales
│           ├── renewals.js            # Renovaciones y calendario
│           ├── settings.js            # Ajustes y datos de la consultora
│           └── backup.js              # Pantalla de copias de seguridad
│
├── src-tauri/                         # Backend nativo
│   ├── Cargo.toml                     # Dependencias Rust, entre ellas rusqlite, aes-gcm y argon2
│   ├── build.rs                       # Preparación de la compilación Tauri
│   ├── tauri.conf.json                # Ventana, empaquetado, actualizaciones y CSP
│   ├── capabilities/default.json      # Permisos de la ventana principal
│   ├── icons/                         # Iconos para los instaladores
│   └── src/
│       ├── main.rs                    # Punto de entrada de escritorio
│       ├── lib.rs                     # Comandos Tauri, archivos y copias de seguridad
│       ├── csv_files.rs               # Lectura de CSV/TXT limitada a archivos arrastrados
│       └── db.rs                      # SQLite en memoria, cifrado, bóveda y restauración
│
├── test/                              # Pruebas de JavaScript con node --test
│   ├── auth_alert_html.test.js        # Texto seguro en avisos de autenticación
│   ├── calculator.test.js             # Facturación y formato de precios
│   ├── client_lifecycle.test.js       # Estados y ciclo de vida de clientes
│   ├── csv_encoding.test.js           # Codificación de archivos seleccionados y arrastrados
│   ├── csv_mapping.test.js            # Asociación automática de columnas del CSV
│   ├── csv_parser.test.js             # Separadores, comillas y campos con saltos de línea
│   ├── cups_validation.test.js        # Identificadores y CUPS
│   ├── fixtures/                      # Archivos de ejemplo utilizados por las pruebas
│   ├── home_market.test.js            # Precios del panel de Inicio
│   ├── ipc_and_ui.test.js             # IPC, eventos y componentes comunes
│   ├── renewals_calendar.test.js      # Navegación del calendario
│   ├── renewals_html.test.js          # Texto seguro en renovaciones
│   ├── settings_dom.test.js           # Estructura y comportamiento del DOM
│   ├── settings_logo_html.test.js     # Vista previa segura del logo de empresa
│   ├── settings_logo_save.test.js     # Guardado del logo y conservación ante errores
│   └── wizard_steps.test.js           # Asistente inicial
│
├── scripts/                           # Preparación y distribución
│   ├── build.js                       # Compilación y copia del instalador MSI
│   ├── setup-windows.ps1              # Preparación del entorno en Windows
│   └── update-latest-json.js          # Metadatos de actualización
│
├── docs/superpowers/                 # Diseños y planes de desarrollo
├── updates/                          # Metadatos de versiones publicadas
├── .githooks/pre-push                # Comprobaciones antes de subir cambios
├── package.json                      # Comandos y dependencias de JavaScript
└── pnpm-lock.yaml                     # Versiones fijadas de dependencias
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

